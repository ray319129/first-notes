// 遊戲用到的 Spotify 內部 API。實測過的見 HANDOFF「API 定案」；專輯／歌手（getAlbum、queryArtistOverview）尚未實測
import { EntityLite, extractEntities, extractTracks, pickImage, Platform, S, sleep, TrackLite, withTimeout } from "../lib/util";
import { Track } from "./types";

const PAGE = 100;
// 避免超大歌庫讀太久
const MAX_TRACKS = 5000;

export const imageUrl = (spotifyImage: string | undefined) =>
  spotifyImage?.startsWith("spotify:image:") ? `https://i.scdn.co/image/${spotifyImage.split(":").pop()}` : spotifyImage;

/** PlaylistAPI／LibraryAPI 的 item 轉成 Track；不可播放、本機檔案、被封鎖的歌回傳 null */
function toTrack(item: any): Track | null {
  if (!item || typeof item.uri !== "string" || !item.uri.startsWith("spotify:track:")) return null;
  if (item.isLocal || item.isPlayable === false || item.isBanned) return null;
  const images: any[] = item.album?.images ?? [];
  const image = images.find((i) => i.label === "standard") ?? images.find((i) => i.label === "large") ?? images[0];
  return {
    uri: item.uri,
    name: item.name,
    artists: (item.artists ?? []).map((a: any) => a.name),
    artistUris: (item.artists ?? []).map((a: any) => a.uri),
    albumUri: item.album?.uri,
    albumName: item.album?.name,
    durationMs: item.duration?.milliseconds ?? 0,
    imageUrl: imageUrl(image?.url),
  };
}

export interface LoadResult {
  tracks: Track[];
  /** 不可播放、本機檔案而被排除的數量 */
  excluded: number;
}

async function loadPaged(fetchPage: (offset: number) => Promise<any>, onProgress?: (n: number) => void): Promise<LoadResult> {
  const tracks: Track[] = [];
  const seen = new Set<string>();
  let excluded = 0;
  // LibraryAPI 回傳的 totalLength 不可信（實測是 0），所以一直讀到沒有資料為止
  let offset = 0;
  while (offset < MAX_TRACKS) {
    const res = await fetchPage(offset);
    const items: any[] = res?.items ?? [];
    for (const item of items) {
      const t = toTrack(item);
      if (!t) excluded++;
      else if (!seen.has(t.uri)) {
        seen.add(t.uri);
        tracks.push(t);
      }
    }
    onProgress?.(tracks.length);
    // 不用 items.length < PAGE 判斷結束：API 若把 limit 壓得比 PAGE 小，會只讀到第一頁
    if (items.length === 0) break;
    offset += items.length;
  }
  return { tracks, excluded };
}

export const loadLikedTracks = (onProgress?: (n: number) => void) =>
  loadPaged((offset) => Platform().LibraryAPI.getTracks({ limit: PAGE, offset }), onProgress);

export const loadPlaylistTracks = (uri: string, onProgress?: (n: number) => void) =>
  loadPaged((offset) => Platform().PlaylistAPI.getContents(uri, { limit: PAGE, offset }), onProgress);

/** 自己的播放清單（含資料夾裡的） */
export async function listPlaylists(): Promise<{ uri: string; name: string }[]> {
  const res = await Platform().RootlistAPI.getContents();
  const lists: { uri: string; name: string }[] = [];
  const walk = (items: any[]) => {
    for (const it of items ?? []) {
      if (it?.type === "playlist" && typeof it.uri === "string") lists.push({ uri: it.uri, name: it.name });
      if (Array.isArray(it?.items)) walk(it.items);
    }
  };
  walk(res?.items);
  return lists;
}

// ---- 題庫來源：清單、專輯、歌手 ----

export type SourceRef = { kind: "liked" } | { kind: "playlist" | "album" | "artist"; uri: string };

export const sourceKey = (s: SourceRef) => (s.kind === "liked" ? "liked" : s.uri);

/** 接受 spotify:playlist|album|artist:ID，或 open.spotify.com 的分享連結（含 intl-xx 路徑） */
export function parseSourceInput(input: string): Extract<SourceRef, { uri: string }> | null {
  const v = input.trim();
  const m =
    v.match(/^spotify:(playlist|album|artist):([A-Za-z0-9]+)$/) ??
    v.match(/open\.spotify\.com\/(?:[a-z-]+\/)?(playlist|album|artist)\/([A-Za-z0-9]+)/);
  return m ? { kind: m[1] as "playlist" | "album" | "artist", uri: `spotify:${m[1]}:${m[2]}` } : null;
}

async function gql(defName: string, variables: Record<string, unknown>): Promise<any> {
  const g = S().GraphQL;
  const def = g?.Definitions?.[defName];
  if (!def) throw new Error(`這個 Spotify 版本沒有 GraphQL ${defName}`);
  const res = await g.Request(def, variables);
  if (res?.errors?.length) throw new Error(res.errors.map((e: any) => e.message).join("; "));
  return res;
}

function liteToTrack(t: TrackLite, fallback: Partial<Track> = {}): Track {
  return {
    uri: t.uri,
    name: t.name,
    artists: t.artists,
    artistUris: t.artistUris,
    albumUri: t.albumUri ?? fallback.albumUri,
    albumName: t.album ?? fallback.albumName,
    durationMs: t.durationMs ?? 0,
    imageUrl: imageUrl(t.image) ?? fallback.imageUrl,
  };
}

export interface LabeledLoad extends LoadResult {
  label: string;
}

const ALBUM_PAGE = 50;
// 專輯最多讀幾首（套裝合輯可能很長）
const ALBUM_MAX = 500;

/** 整張專輯的歌（GraphQL getAlbum） */
export async function loadAlbumTracks(uri: string): Promise<LabeledLoad> {
  const tracks: Track[] = [];
  const seen = new Set<string>();
  let excluded = 0;
  let name = "";
  for (let offset = 0; offset < ALBUM_MAX; offset += ALBUM_PAGE) {
    const res = await gql("getAlbum", { uri, locale: "", offset, limit: ALBUM_PAGE });
    const album = res?.data?.albumUnion;
    name ||= album?.name ?? "";
    const fallback = { albumUri: uri, albumName: album?.name, imageUrl: imageUrl(pickImage(album)) };
    const lites = extractTracks(album?.tracksV2 ?? album?.tracks ?? res).filter((t) => !seen.has(t.uri));
    for (const t of lites) {
      seen.add(t.uri);
      if (t.playable === false) excluded++;
      else tracks.push(liteToTrack(t, fallback));
    }
    if (lites.length < ALBUM_PAGE) break;
  }
  return { tracks, excluded, label: name ? `專輯：${name}` : uri };
}

// 歌手的專輯／單曲太多時只讀前幾張，避免載入太久
const ARTIST_MAX_RELEASES = 40;
const CONCURRENCY = 4;

/**
 * 歌手的歌：queryArtistOverview 取得 discography 裡的專輯／單曲，再逐張 getAlbum。
 * 只保留該歌手有掛名的歌（排除合輯裡別人的歌）。
 */
export async function loadArtistTracks(uri: string, onProgress?: (n: number) => void): Promise<LabeledLoad> {
  const res = await gql("queryArtistOverview", { uri, locale: "", includePrerelease: false, includePrereleases: false });
  const artist = res?.data?.artistUnion;
  const name: string = artist?.profile?.name ?? "";
  const releases = extractEntities(artist?.discography ?? res, 200)
    .filter((e) => e.kind === "album")
    .slice(0, ARTIST_MAX_RELEASES);

  const tracks: Track[] = [];
  const seen = new Set<string>();
  let excluded = 0;
  const add = (list: Track[]) => {
    for (const t of list) {
      if (seen.has(t.uri)) continue;
      // artistUris 抓不到時不過濾，寧可多收也不要整個歌手變空的
      if (t.artistUris.length && !t.artistUris.includes(uri)) continue;
      seen.add(t.uri);
      tracks.push(t);
    }
    onProgress?.(tracks.length);
  };

  add(extractTracks(artist?.discography?.topTracks).filter((t) => t.playable !== false).map((t) => liteToTrack(t)));
  for (let i = 0; i < releases.length; i += CONCURRENCY) {
    const batch = await Promise.all(releases.slice(i, i + CONCURRENCY).map((r) => loadAlbumTracks(r.uri).catch(() => null)));
    for (const b of batch) {
      if (!b) continue;
      excluded += b.excluded;
      add(b.tracks);
    }
  }
  return { tracks, excluded, label: name ? `歌手：${name}` : uri };
}

export async function loadSource(ref: SourceRef, onProgress?: (n: number) => void): Promise<LabeledLoad> {
  switch (ref.kind) {
    case "liked":
      return { ...(await loadLikedTracks(onProgress)), label: "已按讚的歌曲" };
    case "playlist": {
      const meta = await Platform().PlaylistAPI.getMetadata(ref.uri);
      return { ...(await loadPlaylistTracks(ref.uri, onProgress)), label: `清單：${meta?.name ?? ref.uri}` };
    }
    case "album":
      return loadAlbumTracks(ref.uri);
    case "artist":
      return loadArtistTracks(ref.uri, onProgress);
  }
}

const SEARCH_VARS = {
  offset: 0,
  limit: 30,
  numberOfTopResults: 20,
  includeAudiobooks: false,
  includeArtistHasConcertsField: false,
  includePreReleases: false,
  includeLocalConcertsField: false,
  includeAuthors: false,
};

/** 自動完成用的搜尋（GraphQL searchModalResults，上限約 20 筆） */
export async function searchTracks(term: string): Promise<Track[]> {
  const res = await gql("searchModalResults", { ...SEARCH_VARS, searchTerm: term });
  return extractTracks(res).map((t) => liteToTrack(t));
}

/** 用名稱找專輯、歌手、清單，加入題庫用 */
export async function searchSources(term: string): Promise<EntityLite[]> {
  const res = await gql("searchModalResults", { ...SEARCH_VARS, searchTerm: term });
  return extractEntities(res).map((e) => ({ ...e, image: imageUrl(e.image) }));
}

/** 目前播放中歌曲的專輯與第一位歌手，方便一鍵加入 */
export function nowPlayingSources(): EntityLite[] {
  const item = (Spicetify.Player.data as any)?.item;
  if (!item?.uri?.startsWith("spotify:track:")) return [];
  const out: EntityLite[] = [];
  if (item.album?.uri) out.push({ kind: "album", uri: item.album.uri, name: item.album.name, subtitle: item.artists?.[0]?.name });
  if (item.artists?.[0]?.uri) out.push({ kind: "artist", uri: item.artists[0].uri, name: item.artists[0].name });
  return out;
}

/** 同專輯的歌（選擇題「同專輯」干擾選項用），失敗就回傳空陣列，由呼叫端退回其他策略 */
export const albumTracks = (albumUri: string): Promise<Track[]> =>
  loadAlbumTracks(albumUri).then(
    (r) => r.tracks,
    () => [],
  );

// ---- 防作弊：隱藏歌名 ----

const HIDE_STYLE_ID = "first-notes-hide";
// 實測對得到的元素：播放列的歌名區塊、整個右側欄（正在播放、相關影片、歌手卡片）
const LEAK_SELECTORS = ['[data-testid="now-playing-widget-v2"]', ".main-nowPlayingBar-left", "#Desktop_PanelContainer_Id"];

// 播放控制與進度條：遊戲中不讓玩家拖進度、按播放（選擇器沒實測，真正的防線是 ClipPlayer 的守門檢查）
const CONTROL_SELECTORS = ['[data-testid="playback-progressbar"]', ".playback-bar", ".player-controls"];

export function setTrackInfoHidden(hidden: boolean) {
  document.getElementById(HIDE_STYLE_ID)?.remove();
  if (!hidden) return;
  const style = document.createElement("style");
  style.id = HIDE_STYLE_ID;
  style.textContent = [
    `${LEAK_SELECTORS.join(",\n")} { visibility: hidden !important; }`,
    `${CONTROL_SELECTORS.join(",\n")} { visibility: hidden !important; pointer-events: none !important; }`,
  ].join("\n");
  document.head.appendChild(style);
}

/** 加入已按讚；LibraryAPI.add 的參數格式沒實測過 */
export async function saveTrack(uri: string) {
  await Platform().LibraryAPI.add({ uris: [uri] });
}

// ---- 私人聆聽 ----

/**
 * 讀目前是否在私人聆聽。PrivateSessionAPI 沒有 get 方法，只能訂閱；
 * 回呼的參數格式沒實測過，讀不到就回傳 undefined。
 */
export async function getPrivateSession(): Promise<boolean | undefined> {
  const api = Platform().PrivateSessionAPI;
  let unsubscribe: any;
  try {
    return await withTimeout(
      new Promise<boolean | undefined>((resolve) => {
        unsubscribe = api.subscribeToPrivateSession((v: any) => {
          const value = typeof v === "boolean" ? v : (v?.isPrivateSession ?? v?.data?.isPrivateSession ?? v?.data);
          resolve(typeof value === "boolean" ? value : undefined);
        });
      }),
      500,
    );
  } catch {
    return undefined;
  } finally {
    if (typeof unsubscribe === "function") unsubscribe();
    else unsubscribe?.cancel?.();
  }
}

export async function setPrivateSession(on: boolean) {
  await Platform().PrivateSessionAPI.setPrivateSession(on);
  await sleep(100);
}

// ---- 每日挑戰、多人用 ----

/** 單首歌現在能不能播（GraphQL getTrack 的 playability，見 HANDOFF「API 定案」） */
export async function isTrackPlayable(uri: string): Promise<boolean> {
  try {
    const res = await gql("getTrack", { uri });
    return res?.data?.trackUnion?.playability?.playable !== false;
  } catch {
    // 查不到就當作可以播，交給播放時的自動換題處理
    return true;
  }
}

/** 一次檢查多首，回傳不能播的 */
export async function unplayableOf(uris: string[], concurrency = 6): Promise<string[]> {
  const bad: string[] = [];
  for (let i = 0; i < uris.length; i += concurrency) {
    const chunk = uris.slice(i, i + concurrency);
    const ok = await Promise.all(chunk.map(isTrackPlayable));
    chunk.forEach((u, j) => !ok[j] && bad.push(u));
  }
  return bad;
}

/**
 * 目前登入的 Spotify 帳號：id 用 Platform.username；
 * 顯示名稱從 UserAPI.getUser() 讀（沒實測，讀不到就用 username）
 */
export async function currentUser(): Promise<{ id: string; name: string }> {
  const id = String(Platform().username ?? "");
  let name = "";
  try {
    const u = await Platform().UserAPI?.getUser?.();
    name = u?.displayName ?? u?.display_name ?? u?.name ?? "";
  } catch {
    // 用 username
  }
  return { id, name: name || id };
}

/**
 * 找每日挑戰分類對應的官方歌單：先用設定裡的 URI，讀不到再用關鍵字搜尋擁有者是 Spotify 的歌單。
 * 回傳合併後的歌曲（已排除不可播放與本機檔案）。
 */
export async function loadCategoryTracks(playlists: string[], queries: string[]): Promise<Track[]> {
  const seen = new Set<string>();
  const out: Track[] = [];
  const add = (ts: Track[]) => ts.forEach((t) => !seen.has(t.uri) && (seen.add(t.uri), out.push(t)));
  for (const uri of playlists) {
    try {
      add((await loadPlaylistTracks(uri)).tracks);
    } catch {
      // 歌單不存在或讀不到，改用搜尋
    }
  }
  if (out.length >= 30) return out;
  for (const q of queries) {
    const found = await searchSources(q).catch(() => []);
    const official = found.filter((e) => e.kind === "playlist" && e.subtitle === "Spotify").slice(0, 2);
    for (const e of official) {
      try {
        add((await loadPlaylistTracks(e.uri)).tracks);
      } catch {
        // 下一個
      }
    }
    if (out.length >= 30) break;
  }
  return out;
}
