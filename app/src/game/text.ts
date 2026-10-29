import { Track } from "./types";

// 括號或「 - 」後綴裡出現這些字，就視為版本標註而不是歌名本身
const VERSION_WORDS =
  /remaster|live|version|ver\.|feat|ft\.|with |mix|edit|mono|stereo|deluxe|bonus|demo|acoustic|session|anniversary|現場|版|演唱會/i;

/** 歌名正規化：全形轉半形、去掉版本標註、忽略大小寫與標點空白 */
export function normalizeTitle(name: string): string {
  let s = name.normalize("NFKC").toLowerCase();
  // (Remastered 2011)、[Live]、（現場版）
  s = s.replace(/[(\[（【][^)\]）】]*[)\]）】]/g, (m) => (VERSION_WORDS.test(m) ? "" : m));
  // 「 - Remastered 2011」、「 - Live at ...」
  s = s.replace(/\s+-\s+(.*)$/, (m, rest: string) => (VERSION_WORDS.test(rest) ? "" : m));
  // 歌名整個都是符號（例如 emoji）時，退回只做小寫，避免每首都變成空字串而互相相等
  return s.replace(/[\s\p{P}\p{S}]/gu, "") || name.toLowerCase();
}

export const normalizeArtist = (name: string | undefined) =>
  (name ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");

/** 同一首歌常有單曲版、專輯版、重新發行版等不同 uri，歌名＋第一位歌手相同就視為同一首 */
export const songKey = (t: Pick<Track, "name" | "artists">) => `${normalizeTitle(t.name)}|${normalizeArtist(t.artists[0])}`;

export const isSameSong = (a: Pick<Track, "uri" | "name" | "artists">, b: Pick<Track, "uri" | "name" | "artists">) =>
  a.uri === b.uri || songKey(a) === songKey(b);

/** 自動完成用：查詢字串有沒有出現在歌名或歌手裡 */
export function matchesQuery(t: Track, query: string): boolean {
  const q = normalizeArtist(query);
  if (!q) return false;
  return normalizeArtist(t.name).includes(q) || t.artists.some((a) => normalizeArtist(a).includes(q));
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
