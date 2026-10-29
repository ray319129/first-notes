// 跟後端（server/）溝通
import { load, save } from "../lib/storage";
import { AnswerMode } from "../game/types";
import { Category, DailyChoice, DailySet, LeaderboardRow, Period, ScoreSubmit } from "./protocol";

/**
 * 預設伺服器網址（公開網址，不是密碼）。本機開發用 `http://127.0.0.1:8787`（wrangler dev）。
 * 玩家也可以在「設定」頁改成自己架的伺服器。
 */
export const DEFAULT_SERVER = "https://first-notes-server.pitlingo.workers.dev";

export const getServer = () => load<string>("server", DEFAULT_SERVER).replace(/\/+$/, "");
export const setServer = (url: string) => save("server", url.trim());

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(getServer() + path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

const post = <T>(path: string, data: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(data) });

export const fetchCategories = () => call<{ today: string; categories: Category[] }>("/api/categories");
export const fetchDaily = (category: string) => call<{ today: string; set: DailySet | null }>(`/api/daily/${category}`);
/** 送出今天的題目（和選擇題選項）。伺服器以第一個送到的為準，回傳實際採用的那組 */
export const submitDaily = (category: string, userId: string, tracks: DailySet["tracks"], choices?: DailyChoice[]) =>
  post<{ today: string; set: DailySet }>(`/api/daily/${category}`, { userId, tracks, choices });
export const submitScore = (s: ScoreSubmit) => post<{ accepted: boolean }>("/api/scores", s);
export const fetchLeaderboard = (period: Period, category: string, mode: AnswerMode) =>
  call<{ from: string; to: string; rows: LeaderboardRow[] }>(
    `/api/leaderboard?period=${period}&category=${encodeURIComponent(category)}&mode=${mode}`,
  );
export const isDefaultServer = () => getServer() === DEFAULT_SERVER;
export const createRoom = () => post<{ code: string }>("/api/rooms", {});
export const roomSocketUrl = (code: string) => `${getServer().replace(/^http/, "ws")}/api/rooms/${code}/ws`;

/** 設定頁的「測試連線」：HTTP 與 WebSocket 都要通（Spotify 客戶端能不能連外部伺服器沒實測過） */
export async function testConnection(): Promise<string[]> {
  const lines: string[] = [];
  try {
    const h = await call<{ today: string }>("/api/health");
    lines.push(`✅ HTTP 正常（伺服器日期 ${h.today}）`);
  } catch (e) {
    lines.push(`❌ HTTP 失敗：${e instanceof Error ? e.message : String(e)}`);
    return lines;
  }
  try {
    const { code } = await createRoom();
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(roomSocketUrl(code));
      const timer = setTimeout(() => (ws.close(), reject(new Error("逾時"))), 5000);
      ws.onopen = () => (clearTimeout(timer), ws.close(), resolve());
      ws.onerror = () => (clearTimeout(timer), reject(new Error("連線錯誤")));
    });
    lines.push("✅ WebSocket 正常");
  } catch (e) {
    lines.push(`❌ WebSocket 失敗：${e instanceof Error ? e.message : String(e)}`);
  }
  return lines;
}
