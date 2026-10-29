// 客戶端與伺服器（server/）共用的資料格式。只放型別與常數，兩邊都能 import
import { Guess, Settings, Track } from "../game/types";

// ───────── 每日挑戰 ─────────

export interface Category {
  id: string;
  name: string;
  /** 已知的官方歌單 URI，優先使用 */
  playlists: string[];
  /** 找不到或沒有 URI 時，用這些關鍵字搜尋 Spotify 官方（擁有者是 Spotify）的歌單 */
  queries: string[];
}

export const DAILY_ROUNDS = 5;
/** 每日挑戰規則固定：從頭播、自由輸入，大家條件一樣才能比 */
export const DAILY_SETTINGS: Settings = {
  rounds: DAILY_ROUNDS,
  startMode: "beginning",
  answerMode: "free",
  choiceCount: 6,
  distractor: "artist",
};

export interface DailySet {
  category: string;
  date: string;
  tracks: Track[];
}

export interface ScoreSubmit {
  userId: string;
  name: string;
  category: string;
  date: string;
  score: number;
  max: number;
  /** 每題在第幾次猜中（0 起算），沒猜中 -1 */
  solvedAt: number[];
}

export type Period = "day" | "week" | "month";

export interface LeaderboardRow {
  userId: string;
  name: string;
  score: number;
  max: number;
  games: number;
}

// ───────── 多人房間 ─────────

export type PoolMode = "host" | "everyone";

export interface RoomSettings {
  rounds: number;
  startMode: Settings["startMode"];
  answerMode: Settings["answerMode"];
  choiceCount: Settings["choiceCount"];
  /** 多人模式沒有「同專輯」干擾（伺服器查不到專輯），只有同歌手或隨機 */
  distractor: "artist" | "random";
  poolMode: PoolMode;
  /** 每題限時（秒） */
  roundSeconds: number;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  rounds: 10,
  startMode: "beginning",
  answerMode: "free",
  choiceCount: 6,
  distractor: "artist",
  poolMode: "everyone",
  roundSeconds: 90,
};

export type RoomPhase = "lobby" | "checking" | "round" | "reveal" | "final";

export interface PlayerView {
  id: string;
  name: string;
  host: boolean;
  connected: boolean;
  score: number;
  poolSize: number;
  /** 目前這題的進度（不含猜了什麼，避免洩題） */
  marks: ("correct" | "wrong" | "artist" | "skip")[];
  done: boolean;
  blurCount: number;
}

/** 每個玩家自己這一題的狀態（只送給本人） */
export interface MyRound {
  index: number;
  uri: string;
  startMs: number;
  guesses: Guess[];
  choices?: Track[];
  done: boolean;
}

export interface RoomView {
  code: string;
  phase: RoomPhase;
  settings: RoomSettings;
  players: PlayerView[];
  round: number;
  total: number;
  deadline: number | null;
  me: MyRound | null;
  /** 揭曉／結算時才有 */
  answers: Track[];
}

export type ClientMsg =
  | { t: "hello"; userId: string; name: string }
  | { t: "settings"; settings: RoomSettings }
  | { t: "pool"; tracks: Track[]; reset: boolean }
  | { t: "start" }
  | { t: "check"; unplayable: string[] }
  | { t: "guess"; round: number; track: Track | null }
  | { t: "blur"; round: number }
  | { t: "next" }
  | { t: "again" };

export type ServerMsg =
  | { t: "state"; room: RoomView }
  | { t: "check"; uris: string[] }
  | { t: "error"; message: string };

/** 單次 pool 訊息最多幾首（WebSocket 訊息上限 1 MiB） */
export const POOL_CHUNK = 500;
/** 每位玩家最多貢獻幾首 */
export const MAX_POOL_PER_PLAYER = 3000;
