import { Track } from "../../app/src/game/types";
import { DailyChoice } from "../../app/src/net/protocol";

const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);

/** 客戶端送來的歌曲只留認得的欄位，並限制長度 */
export function sanitizeTrack(v: unknown): Track | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const uri = str(o.uri, 64);
  const name = str(o.name);
  if (!uri || !/^spotify:track:[A-Za-z0-9]{22}$/.test(uri) || !name) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.map((a) => str(a)).filter((a): a is string => !!a).slice(0, 10) : []);
  const artists = list(o.artists);
  if (!artists.length) return null;
  const durationMs = typeof o.durationMs === "number" && o.durationMs > 0 ? Math.floor(o.durationMs) : 0;
  return {
    uri,
    name,
    artists,
    artistUris: list(o.artistUris),
    albumUri: str(o.albumUri, 64) ?? undefined,
    albumName: str(o.albumName) ?? undefined,
    durationMs,
    imageUrl: str(o.imageUrl, 500) ?? undefined,
  };
}

export const sanitizeTracks = (v: unknown, max: number): Track[] =>
  Array.isArray(v) ? v.slice(0, max).map(sanitizeTrack).filter((t): t is Track => !!t) : [];

/**
 * 每日選擇題的選項：每題要剛好 count 個不重複的選項、其中一個是那題的答案。
 * 格式不對就整份不收（回傳 null）
 */
export function sanitizeChoices(v: unknown, answers: Track[], count: number): DailyChoice[] | null {
  if (!Array.isArray(v) || v.length !== answers.length) return null;
  const out: DailyChoice[] = [];
  for (let i = 0; i < answers.length; i++) {
    const o = v[i] as Record<string, unknown> | null;
    const choices = sanitizeTracks(o?.choices, count);
    const uris = new Set(choices.map((t) => t.uri));
    if (choices.length !== count || uris.size !== count || !uris.has(answers[i].uri)) return null;
    const reserve = sanitizeTracks(o?.reserve, 8).filter((t) => !uris.has(t.uri));
    out.push({ choices, reserve });
  }
  return out;
}

export const cleanName = (v: unknown) => str(v, 40)?.trim() || null;
export const cleanUserId = (v: unknown) => {
  const s = str(v, 64);
  return s && /^[\w.\-@]+$/.test(s) ? s : null;
};
