import React from "react";
import styles from "../css/game.module.css";
import { Platform } from "../lib/util";
import { emojiRow, maxScore, roundScore, shareText } from "./engine";
import { Stats } from "./Stats";
import { Round } from "./types";

export function Summary(props: {
  rounds: Round[];
  onReplay?: () => void;
  /** 分享文字標題後面加的字，例如「每日 台灣獨立樂團 2026-10-29」 */
  shareSubtitle?: string;
  /** 取代下方的「我的紀錄」，例如每日挑戰放排行榜 */
  children?: React.ReactNode;
}) {
  const { rounds } = props;
  const total = rounds.reduce((s, r) => s + roundScore(r), 0);
  const blurs = rounds.reduce((s, r) => s + r.blurCount, 0);
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    const text = shareText(rounds, props.shareSubtitle);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      await Platform().ClipboardAPI.copy(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.score}>
        {total} <span className={styles.scoreMax}>/ {maxScore(rounds.length)}</span>
      </div>
      {blurs > 0 && <p className={styles.warn}>⚠️ 這局切出視窗共 {blurs} 次</p>}
      <div className={styles.row}>
        <button className={styles.primary} onClick={copy}>
          {copied ? "已複製！" : "複製分享結果"}
        </button>
        {props.onReplay && (
          <button className={styles.button} onClick={props.onReplay}>
            再玩一局
          </button>
        )}
      </div>
      <div className={styles.results}>
        {rounds.map((r, i) => (
          <div key={i} className={styles.resultRow}>
            {r.track.imageUrl ? <img className={styles.thumb} src={r.track.imageUrl} alt="" /> : <div className={styles.thumb} />}
            <div className={styles.resultText}>
              <div className={styles.sugName}>{r.track.name}</div>
              <div className={styles.sugArtist}>{r.track.artists.join(", ")}</div>
            </div>
            <div className={styles.emoji}>{emojiRow(r)}</div>
            <div className={styles.resultScore}>
              +{roundScore(r)}
              {r.blurCount > 0 && <span className={styles.warn}> ⚠️{r.blurCount}</span>}
            </div>
          </div>
        ))}
      </div>
      {props.children ?? (
        <>
          <h2 className={styles.h2}>我的紀錄</h2>
          <Stats />
        </>
      )}
    </div>
  );
}
