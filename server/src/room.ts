import { DurableObject } from "cloudflare:workers";
import { applyGuess, buildChoices, isOver, newRound, pickTracks, roundScore, sameArtistTracks } from "../../app/src/game/engine";
import { Round, Track } from "../../app/src/game/types";
import {
  ClientMsg,
  DEFAULT_ROOM_SETTINGS,
  MAX_POOL_PER_PLAYER,
  PlayerView,
  POOL_CHUNK,
  RoomSettings,
  RoomView,
  ServerMsg,
} from "../../app/src/net/protocol";
import type { Env } from "./index";
import { cleanName, cleanUserId, sanitizeTrack, sanitizeTracks } from "./validate";

const MAX_PLAYERS = 8;
// 可播放檢查最多等多久（有人沒回就當作都能播）
const CHECK_MS = 15_000;
// 每題多給一點準備片段的時間
const PREP_MS = 3_000;
// 揭曉畫面停留多久後自動下一題
const REVEAL_MS = 12_000;
// 結束後多久清掉房間資料
const CLEANUP_MS = 2 * 3600_000;

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  score: number;
  poolSize: number;
}

interface State {
  code: string;
  phase: RoomView["phase"];
  settings: RoomSettings;
  players: Player[];
  /** 這局的答案（依題號） */
  tracks: Track[];
  round: number;
  deadline: number | null;
  /** 目前這題每位玩家各自的回合（選項被替換、猜測都是各自的） */
  rounds: Record<string, Round>;
  check: { candidates: Track[]; pending: string[]; unplayable: string[] } | null;
}

interface Attachment {
  playerId: string | null;
}

const marksOf = (r: Round | undefined): PlayerView["marks"] =>
  (r?.guesses ?? []).map((g) => (g.kind === "correct" ? "correct" : g.kind === "skip" ? "skip" : g.artistMatch ? "artist" : "wrong"));

/**
 * 一個房間一個 Durable Object。玩家用 WebSocket 連進來（休眠 API），
 * 狀態整包存在 storage 的 "state"，題庫存在 SQL 表 pool（可能上千首）。
 * 判定、計分、選項替換都在伺服器跑（共用客戶端的 engine.ts），客戶端只負責播放。
 */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS pool (owner TEXT NOT NULL, uri TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (owner, uri))",
      );
    });
  }

  async fetch(req: Request): Promise<Response> {
    const code = new URL(req.url).pathname.split("/")[3] ?? "";
    const state = await this.load();
    if (!state.code) {
      state.code = code;
      await this.save(state);
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ───────── 儲存 ─────────

  private async load(): Promise<State> {
    return (
      (await this.ctx.storage.get<State>("state")) ?? {
        code: "",
        phase: "lobby",
        settings: DEFAULT_ROOM_SETTINGS,
        players: [],
        tracks: [],
        round: -1,
        deadline: null,
        rounds: {},
        check: null,
      }
    );
  }

  private save(s: State) {
    return this.ctx.storage.put("state", s);
  }

  private poolOf(owner?: string): Track[] {
    const rows = owner
      ? this.ctx.storage.sql.exec<{ json: string }>("SELECT json FROM pool WHERE owner = ?", owner).toArray()
      : this.ctx.storage.sql.exec<{ json: string }>("SELECT json FROM pool").toArray();
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const r of rows) {
      const t = JSON.parse(r.json) as Track;
      if (seen.has(t.uri)) continue;
      seen.add(t.uri);
      out.push(t);
    }
    return out;
  }

  // ───────── 連線與廣播 ─────────

  private connectedIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.playerId) ids.add(a.playerId);
    }
    return ids;
  }

  /** 房主：最早加入且還連著的人（原房主斷線就自動交給下一位） */
  private hostId(s: State): string | null {
    const online = this.connectedIds();
    return [...s.players].sort((a, b) => a.joinedAt - b.joinedAt).find((p) => online.has(p.id))?.id ?? null;
  }

  private view(s: State, playerId: string | null): RoomView {
    const online = this.connectedIds();
    const host = this.hostId(s);
    const revealed = s.phase === "reveal" || s.phase === "final" ? s.round + 1 : Math.max(0, s.round);
    const mine = playerId ? s.rounds[playerId] : undefined;
    return {
      code: s.code,
      phase: s.phase,
      settings: s.settings,
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        host: p.id === host,
        connected: online.has(p.id),
        score: p.score,
        poolSize: p.poolSize,
        marks: marksOf(s.rounds[p.id]),
        done: !!s.rounds[p.id] && isOver(s.rounds[p.id]),
        blurCount: s.rounds[p.id]?.blurCount ?? 0,
      })),
      round: s.round,
      total: s.tracks.length,
      deadline: s.deadline,
      me:
        mine && (s.phase === "round" || s.phase === "reveal")
          ? {
              index: s.round,
              uri: mine.track.uri,
              startMs: mine.startMs,
              guesses: mine.guesses,
              choices: mine.choices,
              done: isOver(mine),
            }
          : null,
      answers: s.tracks.slice(0, revealed),
    };
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 連線已斷
    }
  }

  private broadcast(s: State) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      this.send(ws, { t: "state", room: this.view(s, a?.playerId ?? null) });
    }
  }

  // ───────── 訊息 ─────────

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { t: "error", message: "訊息格式錯誤" });
    }
    const s = await this.load();
    const att = ws.deserializeAttachment() as Attachment | null;
    const me = att?.playerId ?? null;

    if (msg.t === "hello") {
      const id = cleanUserId(msg.userId);
      const name = cleanName(msg.name);
      if (!id || !name) return this.send(ws, { t: "error", message: "缺少使用者資訊" });
      let p = s.players.find((x) => x.id === id);
      if (!p) {
        if (s.players.length >= MAX_PLAYERS) return this.send(ws, { t: "error", message: `房間已滿（最多 ${MAX_PLAYERS} 人）` });
        p = { id, name, joinedAt: Date.now(), score: 0, poolSize: 0 };
        s.players.push(p);
      }
      p.name = name;
      // 同一個人重複連線：關掉舊的
      for (const other of this.ctx.getWebSockets()) {
        const a = other.deserializeAttachment() as Attachment | null;
        if (other !== ws && a?.playerId === id) other.close(4000, "replaced");
      }
      ws.serializeAttachment({ playerId: id } satisfies Attachment);
      await this.save(s);
      this.broadcast(s);
      if (s.phase === "checking" && s.check) this.send(ws, { t: "check", uris: s.check.candidates.map((t) => t.uri) });
      return;
    }

    if (!me) return this.send(ws, { t: "error", message: "請先加入房間" });
    const isHost = this.hostId(s) === me;

    switch (msg.t) {
      case "settings": {
        if (!isHost || s.phase !== "lobby") return;
        s.settings = cleanSettings(msg.settings);
        break;
      }
      case "pool": {
        if (s.phase !== "lobby") return;
        const tracks = sanitizeTracks(msg.tracks, POOL_CHUNK);
        const sql = this.ctx.storage.sql;
        if (msg.reset) sql.exec("DELETE FROM pool WHERE owner = ?", me);
        let count = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM pool WHERE owner = ?", me).one().n;
        for (const t of tracks) {
          if (count >= MAX_POOL_PER_PLAYER) break;
          const r = sql.exec("INSERT OR IGNORE INTO pool (owner, uri, json) VALUES (?, ?, ?)", me, t.uri, JSON.stringify(t));
          count += r.rowsWritten > 0 ? 1 : 0;
        }
        const p = s.players.find((x) => x.id === me);
        if (p) p.poolSize = count;
        break;
      }
      case "start": {
        if (!isHost || s.phase !== "lobby") return;
        const pool = s.settings.poolMode === "host" ? this.poolOf(me) : this.poolOf();
        if (!pool.length) return this.send(ws, { t: "error", message: "題庫是空的，先加入一些歌" });
        if (s.settings.answerMode === "choice" && pool.length < s.settings.choiceCount)
          return this.send(ws, { t: "error", message: `選擇題至少要有 ${s.settings.choiceCount} 首歌` });
        // 多抽一倍，讓每個人的客戶端檢查能不能播（地區、下架），刪掉任何人不能播的
        const candidates = pickTracks(pool, Math.min(pool.length, s.settings.rounds * 2));
        s.check = { candidates, pending: [...this.connectedIds()], unplayable: [] };
        s.phase = "checking";
        s.players.forEach((p) => (p.score = 0));
        s.tracks = [];
        s.round = -1;
        s.rounds = {};
        await this.save(s);
        await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
        this.broadcast(s);
        for (const w of this.ctx.getWebSockets()) this.send(w, { t: "check", uris: candidates.map((t) => t.uri) });
        return;
      }
      case "check": {
        if (s.phase !== "checking" || !s.check) return;
        s.check.pending = s.check.pending.filter((id) => id !== me);
        if (Array.isArray(msg.unplayable)) s.check.unplayable.push(...msg.unplayable.filter((u) => typeof u === "string").slice(0, 200));
        if (!s.check.pending.length) return this.beginGame(s);
        break;
      }
      case "guess": {
        const r = s.rounds[me];
        if (s.phase !== "round" || msg.round !== s.round || !r || isOver(r)) return;
        const track = msg.track === null ? null : sanitizeTrack(msg.track);
        if (msg.track !== null && !track) return;
        s.rounds[me] = applyGuess(r, track);
        if (this.allDone(s)) return this.endRound(s);
        break;
      }
      case "blur": {
        const r = s.rounds[me];
        if (s.phase !== "round" || msg.round !== s.round || !r || isOver(r)) return;
        r.blurCount++;
        break;
      }
      case "next": {
        if (!isHost || s.phase !== "reveal") return;
        return this.nextRound(s);
      }
      case "again": {
        if (!isHost || s.phase !== "final") return;
        s.phase = "lobby";
        s.tracks = [];
        s.round = -1;
        s.rounds = {};
        s.deadline = null;
        await this.ctx.storage.deleteAlarm();
        break;
      }
      default:
        return;
    }
    await this.save(s);
    this.broadcast(s);
  }

  async webSocketClose(ws: WebSocket) {
    ws.serializeAttachment({ playerId: null } satisfies Attachment);
    const s = await this.load();
    // 斷線的人不用等：如果剩下的人都答完了就直接揭曉；檢查階段也不等他
    if (s.phase === "round" && this.allDone(s)) return this.endRound(s);
    if (s.phase === "checking" && s.check) {
      const online = this.connectedIds();
      s.check.pending = s.check.pending.filter((id) => online.has(id));
      if (!s.check.pending.length) return this.beginGame(s);
    }
    this.broadcast(s);
  }

  async alarm() {
    const s = await this.load();
    if (s.phase === "checking") return this.beginGame(s);
    if (s.phase === "round") return this.endRound(s);
    if (s.phase === "reveal") return this.nextRound(s);
    if (s.phase === "final" || s.phase === "lobby") {
      // 結束很久或沒人在：清掉房間
      if (!this.ctx.getWebSockets().length) await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm(Date.now() + CLEANUP_MS);
    }
  }

  // ───────── 流程 ─────────

  private allDone(s: State) {
    const online = this.connectedIds();
    const active = Object.entries(s.rounds).filter(([id]) => online.has(id));
    return active.every(([, r]) => isOver(r));
  }

  private async beginGame(s: State) {
    const bad = new Set(s.check?.unplayable ?? []);
    s.tracks = (s.check?.candidates ?? []).filter((t) => !bad.has(t.uri)).slice(0, s.settings.rounds);
    s.check = null;
    if (!s.tracks.length) {
      s.phase = "lobby";
      await this.save(s);
      for (const w of this.ctx.getWebSockets()) this.send(w, { t: "error", message: "抽到的歌都不能播放，換個題庫再試" });
      this.broadcast(s);
      return;
    }
    return this.nextRound(s);
  }

  private async nextRound(s: State) {
    s.round++;
    if (s.round >= s.tracks.length) {
      s.phase = "final";
      s.deadline = null;
      s.rounds = {};
      await this.save(s);
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_MS);
      this.broadcast(s);
      return;
    }
    const answer = s.tracks[s.round];
    // 同一題大家的起點與初始選項都一樣，之後的選項替換各自獨立
    const base = newRound(answer, s.settings.startMode);
    let choices: Track[] | undefined;
    let reserve: Track[] | undefined;
    if (s.settings.answerMode === "choice") {
      const pool = s.settings.poolMode === "host" ? this.poolOf(this.hostId(s) ?? undefined) : this.poolOf();
      const candidates = s.settings.distractor === "artist" ? [sameArtistTracks(answer, pool), pool] : [pool];
      ({ choices, reserve } = buildChoices(answer, candidates, s.settings.choiceCount));
    }
    const online = this.connectedIds();
    s.rounds = {};
    for (const p of s.players) {
      if (online.has(p.id)) s.rounds[p.id] = { ...base, choices, reserve };
    }
    s.phase = "round";
    s.deadline = Date.now() + s.settings.roundSeconds * 1000 + PREP_MS;
    await this.save(s);
    await this.ctx.storage.setAlarm(s.deadline);
    this.broadcast(s);
  }

  private async endRound(s: State) {
    for (const p of s.players) {
      const r = s.rounds[p.id];
      if (r) p.score += roundScore(r);
    }
    s.phase = "reveal";
    s.deadline = Date.now() + REVEAL_MS;
    await this.save(s);
    await this.ctx.storage.setAlarm(s.deadline);
    this.broadcast(s);
  }
}

function cleanSettings(v: unknown): RoomSettings {
  const o = (v && typeof v === "object" ? v : {}) as Partial<RoomSettings>;
  const d = DEFAULT_ROOM_SETTINGS;
  const pick = <T>(x: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(x as T) ? (x as T) : fallback);
  return {
    rounds: pick(o.rounds, [5, 10, 15, 20], d.rounds),
    startMode: pick(o.startMode, ["beginning", "random"] as const, d.startMode),
    answerMode: pick(o.answerMode, ["free", "choice"] as const, d.answerMode),
    choiceCount: pick(o.choiceCount, [4, 6, 8] as const, d.choiceCount),
    distractor: pick(o.distractor, ["artist", "random"] as const, d.distractor),
    poolMode: pick(o.poolMode, ["host", "everyone"] as const, d.poolMode),
    roundSeconds: pick(o.roundSeconds, [30, 60, 90, 120], d.roundSeconds),
  };
}
