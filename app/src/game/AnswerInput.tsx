import React from "react";
import styles from "../css/game.module.css";
import { searchTracks } from "./spotify";
import { matchesQuery, songKey } from "./text";
import { Track } from "./types";

/** 封面＋歌名＋歌手，建議清單和選擇題共用 */
export function TrackLabel(props: { track: Track }) {
  const { track } = props;
  return (
    <div className={styles.sugRow}>
      {track.imageUrl ? <img className={styles.sugImg} src={track.imageUrl} alt="" /> : <div className={styles.sugImg} />}
      <div className={styles.sugText}>
        <span className={styles.sugName}>{track.name}</span>
        <span className={styles.sugArtist}>{track.artists.join(", ")}</span>
      </div>
    </div>
  );
}

const MAX_SUGGESTIONS = 8;
const LOCAL_FIRST = 5;
const DEBOUNCE_MS = 250;

/** 自由輸入：只能從自動完成的建議裡選，比對時就不會有錯字問題 */
export function AnswerInput(props: { pool: Track[]; disabled: boolean; onSubmit: (t: Track) => void }) {
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<Track[]>([]);
  const [active, setActive] = React.useState(0);
  const requestId = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    const id = ++requestId.current;
    if (!q) {
      setSuggestions([]);
      return;
    }
    // 題庫內的歌優先，立刻顯示；搜尋結果晚點補上
    const local = props.pool.filter((t) => matchesQuery(t, q)).slice(0, LOCAL_FIRST);
    setSuggestions(local);
    setActive(0);
    const timer = setTimeout(async () => {
      let remote: Track[] = [];
      try {
        remote = await searchTracks(q);
      } catch {
        // 搜尋失敗就只用題庫內的建議
      }
      if (id !== requestId.current) return;
      const keys = new Set(local.map(songKey));
      const merged = [...local];
      for (const t of remote) {
        if (merged.length >= MAX_SUGGESTIONS) break;
        const k = songKey(t);
        if (keys.has(k)) continue;
        keys.add(k);
        merged.push(t);
      }
      setSuggestions(merged);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, props.pool]);

  const submit = (t: Track | undefined) => {
    if (!t || props.disabled) return;
    props.onSubmit(t);
    setQuery("");
    setSuggestions([]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit(suggestions[active]);
    }
  };

  return (
    <div className={styles.answer}>
      <input
        className={styles.answerInput}
        placeholder="輸入歌名或歌手，從清單選一首"
        value={query}
        disabled={props.disabled}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      {suggestions.length > 0 && (
        <ul className={styles.suggestions}>
          {suggestions.map((t, i) => (
            <li
              key={t.uri}
              className={i === active ? styles.suggestionActive : styles.suggestion}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // mousedown 而不是 click：避免 input 先失焦
                e.preventDefault();
                submit(t);
              }}
            >
              <TrackLabel track={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
