// 本機遊玩紀錄：統計、避免重複出題
import { load, save } from "../lib/storage";
import { roundScore } from "./engine";
import { MAX_GUESSES, Round } from "./types";

export interface GameRecord {
  at: string;
  mode: "free" | "daily";
  category?: string;
  /** 每日挑戰的題目日期（伺服器的台灣日期） */
  date?: string;
  score: number;
  max: number;
  /** 每題在第幾次猜中（0 起算），沒猜中是 -1 */
  solvedAt: number[];
}

const HISTORY_KEY = "history";
const RECENT_KEY = "recent";
const MAX_HISTORY = 500;
// 最近出過的歌記多少首；題庫比這小時，自然會開始重複
const MAX_RECENT = 300;

export const getHistory = () => load<GameRecord[]>(HISTORY_KEY, []);

export function recordGame(mode: GameRecord["mode"], rounds: Round[], daily?: { category: string; date: string }) {
  const record: GameRecord = {
    at: new Date().toISOString(),
    mode,
    ...daily,
    score: rounds.reduce((s, r) => s + roundScore(r), 0),
    max: rounds.length * MAX_GUESSES,
    solvedAt: rounds.map((r) => r.guesses.findIndex((g) => g.kind === "correct")),
  };
  save(HISTORY_KEY, [...getHistory(), record].slice(-MAX_HISTORY));
  const recent = [...rounds.map((r) => r.track.uri), ...load<string[]>(RECENT_KEY, [])];
  save(RECENT_KEY, [...new Set(recent)].slice(0, MAX_RECENT));
}

export const findDaily = (category: string, date: string) =>
  getHistory().find((g) => g.mode === "daily" && g.category === category && g.date === date);

export const recentUris = () => new Set(load<string[]>(RECENT_KEY, []));

export interface Stats {
  games: number;
  rounds: number;
  /** 得分率（0～1） */
  avgRate: number;
  best: number;
  /** distribution[i]：第 i+1 次猜中的題數；最後一格是沒猜中 */
  distribution: number[];
  /** 連續有玩的天數（到今天或昨天為止） */
  streak: number;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export function computeStats(history: GameRecord[]): Stats {
  const distribution = new Array(MAX_GUESSES + 1).fill(0);
  let score = 0;
  let max = 0;
  for (const g of history) {
    score += g.score;
    max += g.max;
    for (const s of g.solvedAt) distribution[s < 0 ? MAX_GUESSES : s]++;
  }
  const days = new Set(history.map((g) => dayKey(new Date(g.at))));
  let streak = 0;
  const d = new Date();
  // 今天還沒玩不算斷
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return {
    games: history.length,
    rounds: distribution.reduce((a, b) => a + b, 0),
    avgRate: max ? score / max : 0,
    best: Math.max(0, ...history.map((g) => g.score)),
    distribution,
    streak,
  };
}
