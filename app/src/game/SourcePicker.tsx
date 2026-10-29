import React from "react";
import styles from "../css/game.module.css";
import { EntityLite, errMsg } from "../lib/util";
import { listPlaylists, loadSource, nowPlayingSources, parseSourceInput, searchSources, SourceRef, sourceKey } from "./spotify";
import { Track } from "./types";

export interface SourceEntry {
  key: string;
  ref: SourceRef;
  label: string;
  image?: string;
  status: "loading" | "ok" | "error";
  progress: number;
  tracks: Track[];
  excluded: number;
  error?: string;
}

const KIND_LABEL: Record<EntityLite["kind"], string> = { album: "專輯", artist: "歌手", playlist: "清單" };

/** 所有已載入來源合併成一個題庫，依 uri 去重 */
export function mergePool(sources: SourceEntry[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const s of sources) {
    if (s.status !== "ok") continue;
    for (const t of s.tracks) {
      if (seen.has(t.uri)) continue;
      seen.add(t.uri);
      out.push(t);
    }
  }
  return out;
}

/** 記住的來源（不含歌曲，下次開啟時重新載入） */
export type SavedSource = { ref: SourceRef; label: string; image?: string };
export const toSaved = (sources: SourceEntry[]): SavedSource[] =>
  sources.filter((s) => s.status === "ok").map(({ ref, label, image }) => ({ ref, label, image }));

/** 加入一個來源並開始載入歌曲 */
export async function addSource(
  setSources: React.Dispatch<React.SetStateAction<SourceEntry[]>>,
  ref: SourceRef,
  label: string,
  image?: string,
) {
  const key = sourceKey(ref);
  const update = (patch: Partial<SourceEntry>) => setSources((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  setSources((list) =>
    list.some((s) => s.key === key) ? list : [...list, { key, ref, label, image, status: "loading", progress: 0, tracks: [], excluded: 0 }],
  );
  try {
    const r = await loadSource(ref, (n) => update({ progress: n }));
    update({ status: "ok", label: r.label, tracks: r.tracks, excluded: r.excluded });
  } catch (e) {
    update({ status: "error", error: errMsg(e) });
  }
}

const entityLabel = (e: EntityLite) => `${KIND_LABEL[e.kind]}：${e.name}${e.subtitle ? `（${e.subtitle}）` : ""}`;

export function SourcePicker(props: { sources: SourceEntry[]; setSources: React.Dispatch<React.SetStateAction<SourceEntry[]>> }) {
  const { sources, setSources } = props;
  const [playlists, setPlaylists] = React.useState<{ uri: string; name: string }[]>([]);
  const [playlistUri, setPlaylistUri] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<EntityLite[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [nowPlaying, setNowPlaying] = React.useState<EntityLite[]>(nowPlayingSources);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    listPlaylists()
      .then((lists) => {
        setPlaylists(lists);
        if (lists[0]) setPlaylistUri(lists[0].uri);
      })
      .catch((e) => setError(`讀不到播放清單：${errMsg(e)}`));
    const onSong = () => setNowPlaying(nowPlayingSources());
    Spicetify.Player.addEventListener("songchange", onSong);
    return () => Spicetify.Player.removeEventListener("songchange", onSong);
  }, []);

  const pasted = parseSourceInput(query);

  // 輸入的不是連結時，用名稱搜尋專輯／歌手／清單
  React.useEffect(() => {
    const q = query.trim();
    if (!q || pasted) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchSources(q);
        if (!cancelled) setResults(found.slice(0, 8));
      } catch (e) {
        if (!cancelled) setError(`搜尋失敗：${errMsg(e)}`);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const add = (ref: SourceRef, label: string, image?: string) => {
    if (sources.some((s) => s.key === sourceKey(ref))) return;
    setError("");
    addSource(setSources, ref, label, image);
  };

  const addEntity = (e: EntityLite) => {
    add({ kind: e.kind, uri: e.uri }, entityLabel(e), e.image);
    setQuery("");
  };

  const remove = (key: string) => setSources((list) => list.filter((s) => s.key !== key));
  const total = mergePool(sources).length;
  const has = (uri: string) => sources.some((s) => s.key === uri);

  return (
    <>
      <div className={styles.row}>
        <button className={styles.button} disabled={has("liked")} onClick={() => add({ kind: "liked" }, "已按讚的歌曲")}>
          ＋ 已按讚的歌曲
        </button>
        <select className={styles.select} value={playlistUri} onChange={(e) => setPlaylistUri(e.target.value)}>
          {playlists.map((p) => (
            <option key={p.uri} value={p.uri}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className={styles.button}
          disabled={!playlistUri || has(playlistUri)}
          onClick={() =>
            add({ kind: "playlist", uri: playlistUri }, `清單：${playlists.find((p) => p.uri === playlistUri)?.name ?? ""}`)
          }
        >
          ＋ 加入清單
        </button>
      </div>

      {nowPlaying.length > 0 && (
        <div className={styles.row}>
          <span className={styles.note}>目前播放：</span>
          {nowPlaying.map((e) => (
            <button key={e.uri} className={styles.button} disabled={has(e.uri)} onClick={() => addEntity(e)}>
              ＋ {KIND_LABEL[e.kind]}：{e.name}
            </button>
          ))}
        </div>
      )}

      <div className={styles.answer}>
        <input
          className={styles.answerInput}
          placeholder="搜尋專輯、歌手或清單名稱，也可以貼上分享連結"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {pasted && (
          <ul className={styles.dropdown}>
            <li
              className={styles.suggestionActive}
              onMouseDown={(e) => {
                e.preventDefault();
                add(pasted, `${pasted.kind === "playlist" ? "清單" : pasted.kind === "album" ? "專輯" : "歌手"}：讀取中…`);
                setQuery("");
              }}
            >
              <span className={styles.sugName}>＋ 加入這個連結</span>
              <span className={styles.sugArtist}>{pasted.uri}</span>
            </li>
          </ul>
        )}
        {!pasted && (results.length > 0 || searching) && (
          <ul className={styles.dropdown}>
            {searching && results.length === 0 && <li className={styles.suggestion}>搜尋中…</li>}
            {results.map((e) => (
              <li
                key={e.uri}
                className={styles.suggestion}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  if (!has(e.uri)) addEntity(e);
                }}
              >
                <div className={styles.sugRow}>
                  {e.image ? <img className={styles.sugImg} src={e.image} alt="" /> : <div className={styles.sugImg} />}
                  <div className={styles.sugText}>
                    <span className={styles.sugName}>
                      {has(e.uri) ? "✓ " : "＋ "}
                      {e.name}
                    </span>
                    <span className={styles.sugArtist}>
                      {KIND_LABEL[e.kind]}
                      {e.subtitle ? ` · ${e.subtitle}` : ""}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}

      {sources.length > 0 && (
        <div className={styles.sourceList}>
          {sources.map((s) => (
            <div key={s.key} className={styles.sourceRow}>
              <span className={styles.sourceLabel}>{s.label}</span>
              <span className={s.status === "error" ? styles.error : styles.note}>
                {s.status === "loading" && `載入中…（${s.progress} 首）`}
                {s.status === "ok" && `${s.tracks.length} 首${s.excluded ? `（排除 ${s.excluded} 首無法播放）` : ""}`}
                {s.status === "error" && `載入失敗：${s.error}`}
              </span>
              <button className={styles.remove} onClick={() => remove(s.key)} title="移除">
                ✕
              </button>
            </div>
          ))}
          <p className={styles.note}>
            題庫共 <b>{total}</b> 首（多個來源重複的歌只算一次）
          </p>
        </div>
      )}
    </>
  );
}
