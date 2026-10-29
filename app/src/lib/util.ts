// 共用的工具

// Spicetify.Platform 和 GraphQL 沒有完整型別，一律當 any 用
export const S = () => Spicetify as any;
export const Platform = () => (Spicetify as any).Platform;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withTimeout<T>(p: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} (${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

export async function waitFor(cond: () => boolean, timeoutMs: number, intervalMs = 25): Promise<number> {
  const start = performance.now();
  while (!cond()) {
    if (performance.now() - start > timeoutMs) throw new Error(`waitFor timeout (${timeoutMs}ms)`);
    await sleep(intervalMs);
  }
  return Math.round(performance.now() - start);
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export interface TrackLite {
  uri: string;
  name: string;
  artists: string[];
  artistUris: string[];
  album?: string;
  albumUri?: string;
  /** 封面網址（spotify:image: 或 https），GraphQL 回應裡常見 albumOfTrack.coverArt */
  image?: string;
  durationMs?: number;
  /** GraphQL 的 playability.playable；回應裡沒有這個欄位時是 undefined */
  playable?: boolean;
}

const artistList = (node: any): any[] => {
  const list = node?.artists?.items ?? node?.artists ?? node?.artist ?? [];
  return Array.isArray(list) ? list : [list];
};

/** 從 GraphQL 的 coverArt.sources 或 Platform API 的 images 挑一張中等大小的封面 */
export function pickImage(node: any): string | undefined {
  const sources: any[] = node?.coverArt?.sources ?? node?.images ?? [];
  if (!sources.length) return undefined;
  const mid = sources.find((s) => s.width >= 200 && s.width <= 400) ?? sources.find((s) => s.label === "standard");
  return (mid ?? sources[0])?.url;
}

/**
 * 在任意形狀的回應裡找出歌曲。不同 API（GraphQL / Cosmos / Web API）欄位不一樣，
 * 這裡用「有 spotify:track: 的 uri 加上 name」當判斷依據。
 */
export function extractTracks(root: unknown, max = 500): TrackLite[] {
  const out: TrackLite[] = [];
  const seen = new Set<string>();
  const visited = new WeakSet<object>();

  const walk = (node: any, depth: number) => {
    if (out.length >= max || depth > 12 || !node || typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);
    const uri = node.uri ?? node.link;
    if (typeof uri === "string" && uri.startsWith("spotify:track:") && typeof node.name === "string") {
      if (!seen.has(uri)) {
        seen.add(uri);
        const artists = artistList(node);
        const album = node.albumOfTrack ?? node.album;
        out.push({
          uri,
          name: node.name,
          artists: artists.map((a: any) => a?.profile?.name ?? a?.name).filter((n: unknown): n is string => typeof n === "string"),
          artistUris: artists.map((a: any) => a?.uri).filter((u: unknown): u is string => typeof u === "string"),
          album: album?.name,
          albumUri: album?.uri,
          image: pickImage(album),
          durationMs: node.duration?.totalMilliseconds ?? node.duration?.milliseconds ?? node.trackDuration?.totalMilliseconds,
          playable: typeof node.playability?.playable === "boolean" ? node.playability.playable : undefined,
        });
      }
    }
    for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, depth + 1);
  };

  walk(root, 0);
  return out;
}

export interface EntityLite {
  kind: "album" | "artist" | "playlist";
  uri: string;
  name: string;
  /** 專輯的歌手或清單的擁有者 */
  subtitle?: string;
  image?: string;
}

/** 搜尋結果裡的專輯、歌手、播放清單 */
export function extractEntities(root: unknown, max = 50): EntityLite[] {
  const out: EntityLite[] = [];
  const seen = new Set<string>();
  const visited = new WeakSet<object>();
  const walk = (node: any, depth: number) => {
    if (out.length >= max || depth > 12 || !node || typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);
    const m = typeof node.uri === "string" ? node.uri.match(/^spotify:(album|artist|playlist):/) : null;
    const name = node.name ?? node.profile?.name;
    if (m && typeof name === "string" && !seen.has(node.uri)) {
      seen.add(node.uri);
      const subtitle =
        m[1] === "album"
          ? artistList(node).map((a: any) => a?.profile?.name ?? a?.name).filter(Boolean).join(", ")
          : m[1] === "playlist"
            ? (node.ownerV2?.data?.name ?? node.owner?.name)
            : undefined;
      out.push({
        kind: m[1] as EntityLite["kind"],
        uri: node.uri,
        name,
        subtitle: subtitle || undefined,
        image: pickImage(node) ?? pickImage(node.visuals?.avatarImage) ?? pickImage(node.images?.items?.[0]),
      });
    }
    for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, depth + 1);
  };
  walk(root, 0);
  return out;
}
