import { DAILY_CHOICE_COUNT, DAILY_ROUNDS, DailySet, isAnswerMode, LeaderboardRow, Period } from "../../app/src/net/protocol";
import { MAX_GUESSES } from "../../app/src/game/types";
import { CATEGORIES, findCategory } from "./categories";
import { cleanName, cleanUserId, sanitizeChoices, sanitizeTracks } from "./validate";

export { Room } from "./room";

export interface Env {
  DB: D1Database;
  ROOM: DurableObjectNamespace<import("./room").Room>;
}

// Spotify 客戶端的網頁來源是 xpui.app.spotify.com；不帶 cookie，所以開放所有來源也沒關係
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
const fail = (message: string, status = 400) => json({ error: message }, status);

// ───────── 日期（一律用台灣時間切日） ─────────

const TZ_OFFSET_MS = 8 * 3600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const taipeiNow = () => new Date(Date.now() + TZ_OFFSET_MS);
export const today = () => ymd(taipeiNow());
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 期間範圍（含頭尾）：週從星期一開始 */
function periodRange(period: Period, date: string): [string, string] {
  const d = new Date(`${date}T00:00:00Z`);
  if (period === "day") return [date, date];
  if (period === "week") {
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return [ymd(monday), ymd(sunday)];
  }
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return [ymd(first), ymd(last)];
}

// ───────── 房號 ─────────

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

// ───────── 路由 ─────────

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function getDaily(env: Env, category: string, date: string): Promise<DailySet | null> {
  const row = await env.DB.prepare("SELECT tracks, choices FROM daily_sets WHERE category = ? AND date = ?")
    .bind(category, date)
    .first<{ tracks: string; choices: string | null }>();
  return row ? { category, date, tracks: JSON.parse(row.tracks), choices: row.choices ? JSON.parse(row.choices) : null } : null;
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return fail("not found", 404);
  const [, resource, id, sub] = parts;

  if (resource === "health") return json({ ok: true, today: today() });

  if (resource === "categories" && req.method === "GET") return json({ today: today(), categories: CATEGORIES });

  // GET /api/daily/:category → 今天的題目（還沒人產生就是 null）
  // POST /api/daily/:category {userId, tracks, choices?} → 題目和選擇題選項都是第一個送上來的為準，回傳實際採用的那組
  if (resource === "daily" && id) {
    if (!findCategory(id)) return fail("unknown category", 404);
    const date = today();
    if (req.method === "GET") return json({ today: date, set: await getDaily(env, id, date) });
    if (req.method === "POST") {
      const body = await readJson(req);
      const userId = cleanUserId(body?.userId);
      const tracks = sanitizeTracks(body?.tracks, DAILY_ROUNDS);
      if (!userId || tracks.length !== DAILY_ROUNDS) return fail("invalid daily set");
      await env.DB.prepare(
        "INSERT OR IGNORE INTO daily_sets (category, date, tracks, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(id, date, JSON.stringify(tracks), userId, Date.now())
        .run();
      let set = (await getDaily(env, id, date))!;
      // 選項要對得上實際採用的題目（不一定是這次送的那組）
      if (!set.choices && body?.choices !== undefined) {
        const choices = sanitizeChoices(body.choices, set.tracks, DAILY_CHOICE_COUNT);
        if (!choices) return fail("invalid choices");
        await env.DB.prepare("UPDATE daily_sets SET choices = ? WHERE category = ? AND date = ? AND choices IS NULL")
          .bind(JSON.stringify(choices), id, date)
          .run();
        set = (await getDaily(env, id, date))!;
      }
      return json({ today: date, set });
    }
  }

  // POST /api/scores：每人每天每分類只收第一次（重玩、或換另一種作答方式都不算）
  if (resource === "scores" && req.method === "POST") {
    const body = await readJson(req);
    const userId = cleanUserId(body?.userId);
    const name = cleanName(body?.name);
    const category = typeof body?.category === "string" ? body.category : "";
    const date = body?.date;
    // 舊版客戶端沒有送 mode，當成自由輸入
    const mode = body?.mode ?? "free";
    const max = DAILY_ROUNDS * MAX_GUESSES;
    const score = body?.score;
    const solvedAt = body?.solvedAt;
    if (!userId || !name || !findCategory(category) || !isDate(date) || !isAnswerMode(mode)) return fail("invalid score");
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > max) return fail("invalid score");
    if (!Array.isArray(solvedAt) || solvedAt.length !== DAILY_ROUNDS) return fail("invalid score");
    // 分數要跟每題猜中的次數對得上
    const expected = solvedAt.reduce((s: number, i: unknown) => s + (typeof i === "number" && i >= 0 && i < MAX_GUESSES ? MAX_GUESSES - i : 0), 0);
    if (expected !== score) return fail("score mismatch");
    // 跨午夜才玩完的，允許交昨天的
    const yesterday = ymd(new Date(taipeiNow().getTime() - 86400_000));
    if (date !== today() && date !== yesterday) return fail("too late");
    const set = await getDaily(env, category, date);
    if (!set) return fail("no daily set", 404);
    if (mode === "choice" && !set.choices) return fail("no choices for this set");
    const r = await env.DB.prepare(
      "INSERT OR IGNORE INTO scores (user_id, name, category, date, mode, score, max, solved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(userId, name, category, date, mode, score, max, JSON.stringify(solvedAt), Date.now())
      .run();
    return json({ accepted: r.meta.changes > 0 });
  }

  // GET /api/leaderboard?period=day|week|month&category=all|<id>&mode=free|choice&date=YYYY-MM-DD
  if (resource === "leaderboard" && req.method === "GET") {
    const period = (url.searchParams.get("period") ?? "day") as Period;
    if (!["day", "week", "month"].includes(period)) return fail("invalid period");
    const date = url.searchParams.get("date") ?? today();
    if (!isDate(date)) return fail("invalid date");
    const category = url.searchParams.get("category") ?? "all";
    if (category !== "all" && !findCategory(category)) return fail("unknown category", 404);
    const mode = url.searchParams.get("mode") ?? "free";
    if (!isAnswerMode(mode)) return fail("invalid mode");
    const [from, to] = periodRange(period, date);
    const where = category === "all" ? "" : "AND category = ?";
    const binds: unknown[] = category === "all" ? [from, to, mode] : [from, to, mode, category];
    const { results } = await env.DB.prepare(
      `SELECT user_id AS userId, MAX(name) AS name, SUM(score) AS score, SUM(max) AS max, COUNT(*) AS games
       FROM scores WHERE date BETWEEN ? AND ? AND mode = ? ${where}
       GROUP BY user_id ORDER BY score DESC, max ASC, MIN(created_at) ASC LIMIT 50`,
    )
      .bind(...binds)
      .all<LeaderboardRow>();
    return json({ period, category, mode, from, to, rows: results });
  }

  // POST /api/rooms → 新房號；GET /api/rooms/:code/ws → 連進房間
  if (resource === "rooms") {
    if (!id && req.method === "POST") return json({ code: newCode() });
    if (id && sub === "ws") {
      if (!CODE_RE.test(id)) return fail("invalid room code");
      if (req.headers.get("Upgrade") !== "websocket") return fail("expected websocket", 426);
      return env.ROOM.getByName(id).fetch(req);
    }
  }

  return fail("not found", 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    try {
      return await handle(req, env);
    } catch (e) {
      console.error(e);
      return fail("server error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
