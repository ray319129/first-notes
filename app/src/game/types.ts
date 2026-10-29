export interface Track {
  uri: string;
  name: string;
  artists: string[];
  artistUris: string[];
  albumUri?: string;
  albumName?: string;
  durationMs: number;
  imageUrl?: string;
}

export type Source = { kind: "liked" } | { kind: "playlist"; uri: string; name: string };

export type AnswerMode = "free" | "choice";
export type StartMode = "beginning" | "random";
export type DistractorMode = "random" | "artist" | "album";

export interface Settings {
  rounds: number;
  startMode: StartMode;
  answerMode: AnswerMode;
  choiceCount: 4 | 6 | 8;
  distractor: DistractorMode;
}

export type Guess =
  /** artistMatch：歌名錯但第一位歌手對了（顯示 🟨） */
  | { kind: "wrong"; track: Track; artistMatch: boolean }
  | { kind: "skip" }
  | { kind: "correct"; track: Track };

export interface Round {
  track: Track;
  startMs: number;
  guesses: Guess[];
  /** 選擇題模式才有 */
  choices?: Track[];
  /** 選擇題的備用干擾選項：猜錯的選項會被換成這裡的下一首，讓刪去法失效 */
  reserve?: Track[];
  /** 回合中切出視窗的次數 */
  blurCount: number;
}

/** 經典 Heardle：每次猜錯或跳過，片段延長到下一個長度 */
export const STEPS_MS = [1000, 2000, 4000, 7000, 11000, 16000];
export const MAX_GUESSES = STEPS_MS.length;
