import { Track } from "../../app/src/game/types";

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

export const cleanName = (v: unknown) => str(v, 40)?.trim() || null;
export const cleanUserId = (v: unknown) => {
  const s = str(v, 64);
  return s && /^[\w.\-@]+$/.test(s) ? s : null;
};
