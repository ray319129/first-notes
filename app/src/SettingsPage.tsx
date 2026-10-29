import React from "react";
import styles from "./css/game.module.css";
import { DEFAULT_SERVER, getServer, setServer, testConnection } from "./net/api";

/** 伺服器網址與連線測試（每日挑戰、排行榜、多人都要連這台） */
export function SettingsPage() {
  const [url, setUrl] = React.useState(getServer());
  const [lines, setLines] = React.useState<string[]>([]);
  const [testing, setTesting] = React.useState(false);

  const test = async () => {
    setServer(url);
    setTesting(true);
    setLines([]);
    try {
      setLines(await testConnection());
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.h2}>伺服器</h2>
      <p className={styles.note}>每日挑戰、排行榜和多人連線都靠這台伺服器。一般不用改；自己架伺服器時才換成自己的網址。</p>
      <div className={styles.row}>
        <input className={styles.answerInput} value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className={styles.button} onClick={() => (setServer(url), setLines(["已儲存"]))}>
          儲存
        </button>
        <button className={styles.button} onClick={() => (setUrl(DEFAULT_SERVER), setServer(DEFAULT_SERVER))}>
          還原預設
        </button>
        <button className={styles.primary} onClick={test} disabled={testing}>
          {testing ? "測試中…" : "測試連線"}
        </button>
      </div>
      {lines.map((l) => (
        <p key={l} className={styles.note}>
          {l}
        </p>
      ))}
    </div>
  );
}
