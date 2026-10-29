import React from "react";
import styles from "../css/game.module.css";
import { Stats } from "./Stats";
import { mergePool, SourceEntry, SourcePicker } from "./SourcePicker";
import { Settings, Track } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  rounds: 10,
  startMode: "beginning",
  answerMode: "free",
  choiceCount: 6,
  distractor: "artist",
};

export function Radio<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={styles.segmented}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === props.value ? styles.segActive : styles.seg}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Setup(props: {
  initial: Settings;
  // 題庫來源放在 Game，「再玩一局」回到設定頁時還在
  sources: SourceEntry[];
  setSources: React.Dispatch<React.SetStateAction<SourceEntry[]>>;
  onStart: (settings: Settings, pool: Track[]) => void;
}) {
  const [settings, setSettings] = React.useState<Settings>(props.initial);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  const pool = React.useMemo(() => mergePool(props.sources), [props.sources]);
  const loading = props.sources.some((s) => s.status === "loading");
  const available = pool.length;
  // 選擇題的干擾選項以題庫為最後備援，題庫至少要有選項數那麼多首
  const tooFew = available > 0 && settings.answerMode === "choice" && available < settings.choiceCount;

  return (
    <div className={styles.panel}>
      <h2 className={styles.h2}>1. 題庫（可以加入多個來源）</h2>
      <SourcePicker sources={props.sources} setSources={props.setSources} />

      <h2 className={styles.h2}>2. 規則</h2>
      <div className={styles.field}>
        <span className={styles.label}>題數</span>
        <Radio
          value={settings.rounds}
          onChange={(v) => set("rounds", v)}
          options={[5, 10, 15, 20].map((n) => ({ value: n, label: `${n} 題` }))}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>片段起點</span>
        <Radio
          value={settings.startMode}
          onChange={(v) => set("startMode", v)}
          options={[
            { value: "beginning", label: "從歌曲開頭" },
            { value: "random", label: "隨機段落" },
          ]}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>作答方式</span>
        <Radio
          value={settings.answerMode}
          onChange={(v) => set("answerMode", v)}
          options={[
            { value: "free", label: "自由輸入" },
            { value: "choice", label: "選擇題" },
          ]}
        />
      </div>
      {settings.answerMode === "choice" && (
        <>
          <div className={styles.field}>
            <span className={styles.label}>選項數</span>
            <Radio
              value={settings.choiceCount}
              onChange={(v) => set("choiceCount", v)}
              options={([4, 6, 8] as const).map((n) => ({ value: n, label: `${n} 個` }))}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>干擾選項</span>
            <Radio
              value={settings.distractor}
              onChange={(v) => set("distractor", v)}
              options={[
                { value: "random", label: "題庫隨機" },
                { value: "artist", label: "同歌手優先" },
                { value: "album", label: "同專輯優先" },
              ]}
            />
          </div>
        </>
      )}

      {tooFew && <p className={styles.error}>題庫的歌太少了，至少需要 {settings.choiceCount} 首才能出選擇題</p>}
      {available > 0 && available < settings.rounds && !tooFew && (
        <p className={styles.note}>題庫只有 {available} 首，這局會出 {available} 題</p>
      )}
      <button
        className={styles.primary}
        disabled={loading || available === 0 || tooFew}
        onClick={() => props.onStart(settings, pool)}
      >
        {loading ? "題庫載入中…" : "開始遊戲"}
      </button>

      <h2 className={styles.h2}>我的紀錄</h2>
      <Stats />
    </div>
  );
}
