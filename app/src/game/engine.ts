// 遊戲規則：出題、判定、計分、分享文字。純函式，不碰 Spotify
import { isSameSong, normalizeArtist, shuffle, songKey } from "./text";
import { Guess, MAX_GUESSES, Round, StartMode, STEPS_MS, Track } from "./types";

export const sameFirstArtist = (a: Track, b: Track): boolean =>
  a.artistUris[0] && b.artistUris[0] ? a.artistUris[0] === b.artistUris[0] : normalizeArtist(a.artists[0]) === normalizeArtist(b.artists[0]);

/**
 * 從題庫抽 n 首不重複的歌（同一首歌的不同版本只算一首）。
 * avoid 裡的歌（最近出過的）排到最後，題庫不夠時才會用到。
 */
export function pickTracks(pool: Track[], n: number, avoid: Set<string> = new Set()): Track[] {
  const out: Track[] = [];
  const keys = new Set<string>();
  const shuffled = shuffle(pool);
  const ordered = [...shuffled.filter((t) => !avoid.has(t.uri)), ...shuffled.filter((t) => avoid.has(t.uri))];
  for (const t of ordered) {
    const k = songKey(t);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/** 隨機段落：避開前 10% 和後 20%，並留夠最長片段的長度 */
export function startMsFor(track: Track, mode: StartMode): number {
  const longest = STEPS_MS[STEPS_MS.length - 1];
  const d = track.durationMs;
  if (mode === "beginning" || d < longest * 2) return 0;
  const lo = d * 0.1;
  const hi = d * 0.8 - longest;
  if (hi <= lo) return Math.floor(lo);
  return Math.floor(lo + Math.random() * (hi - lo));
}

export const newRound = (track: Track, mode: StartMode): Round => ({
  track,
  startMs: startMsFor(track, mode),
  guesses: [],
  blurCount: 0,
});

/** 目前能聽的長度：每猜錯或跳過一次就解鎖下一段 */
export const unlockedMs = (r: Round) => STEPS_MS[Math.min(r.guesses.length, MAX_GUESSES - 1)];

export const isSolved = (r: Round) => r.guesses.some((g) => g.kind === "correct");
export const isOver = (r: Round) => isSolved(r) || r.guesses.length >= MAX_GUESSES;

export function judge(answer: Track, track: Track | null): Guess {
  if (!track) return { kind: "skip" };
  if (isSameSong(track, answer)) return { kind: "correct", track };
  return { kind: "wrong", track, artistMatch: sameFirstArtist(track, answer) };
}

/** 記錄一次猜測；選擇題猜錯時，把那個選項換成備用的干擾選項 */
export function applyGuess(r: Round, track: Track | null): Round {
  if (isOver(r)) return r;
  const guess = judge(r.track, track);
  const next: Round = { ...r, guesses: [...r.guesses, guess] };
  if (guess.kind === "wrong" && r.choices) {
    const used = new Set(r.choices.map(songKey));
    const reserve = (r.reserve ?? []).filter((t) => !used.has(songKey(t)));
    const replacement = reserve.shift();
    if (replacement) {
      next.choices = r.choices.map((c) => (isSameSong(c, guess.track) ? replacement : c));
      next.reserve = reserve;
    }
  }
  return next;
}

/** 第 1～6 次猜中分別得 6～1 分 */
export function roundScore(r: Round): number {
  const i = r.guesses.findIndex((g) => g.kind === "correct");
  return i < 0 ? 0 : MAX_GUESSES - i;
}

export const maxScore = (rounds: number) => rounds * MAX_GUESSES;

export function emojiRow(r: Round): string {
  const cells: string[] = r.guesses.map((g) =>
    g.kind === "correct" ? "🟩" : g.kind === "skip" ? "⬛" : g.artistMatch ? "🟨" : "🟥",
  );
  while (cells.length < MAX_GUESSES) cells.push("⬜");
  return cells.join("");
}

export const APP_NAME = "First Notes";

export function shareText(rounds: Round[], subtitle = ""): string {
  const total = rounds.reduce((s, r) => s + roundScore(r), 0);
  const head = `${APP_NAME} 🎵${subtitle ? ` ${subtitle}` : ""} ${total}/${maxScore(rounds.length)}`;
  return [head, ...rounds.map(emojiRow)].join("\n");
}

// 備用干擾選項最多留幾個（每猜錯一次用掉一個，6 次機會最多用 5 個）
const RESERVE = 8;

/**
 * 選擇題選項：依優先順序從各候選清單補干擾選項，排除跟答案同一首歌、或彼此重複的。
 * candidates 例：[同專輯, 同歌手, 整個題庫]。多抽的放進 reserve，猜錯時補位用。
 */
export function buildChoices(answer: Track, candidates: Track[][], count: number): { choices: Track[]; reserve: Track[] } {
  const picked: Track[] = [];
  const keys = new Set([songKey(answer)]);
  const want = count - 1 + RESERVE;
  for (const list of candidates) {
    for (const t of shuffle(list)) {
      if (picked.length >= want) break;
      const k = songKey(t);
      if (keys.has(k)) continue;
      keys.add(k);
      picked.push(t);
    }
  }
  return { choices: shuffle([answer, ...picked.slice(0, count - 1)]), reserve: picked.slice(count - 1) };
}

export const sameArtistTracks = (answer: Track, pool: Track[]) => pool.filter((t) => sameFirstArtist(t, answer));
