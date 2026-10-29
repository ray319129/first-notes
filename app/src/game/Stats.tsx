import React from "react";
import styles from "../css/game.module.css";
import { computeStats, getHistory } from "./history";
import { MAX_GUESSES } from "./types";

/** 本機遊玩統計：局數、得分率、最佳、連續天數、第幾次猜中的分布 */
export function Stats() {
  const stats = React.useMemo(() => computeStats(getHistory()), []);
  if (!stats.games) return <p className={styles.note}>還沒有紀錄，玩一局就會開始統計。</p>;
  const peak = Math.max(1, ...stats.distribution);
  const labels = [...Array.from({ length: MAX_GUESSES }, (_, i) => String(i + 1)), "✗"];
  return (
    <div>
      <div className={styles.statTiles}>
        <div className={styles.statTile}>
          <div className={styles.statValue}>{stats.games}</div>
          <div className={styles.statLabel}>局數</div>
        </div>
        <div className={styles.statTile}>
          <div className={styles.statValue}>{Math.round(stats.avgRate * 100)}%</div>
          <div className={styles.statLabel}>平均得分率</div>
        </div>
        <div className={styles.statTile}>
          <div className={styles.statValue}>{stats.best}</div>
          <div className={styles.statLabel}>單局最高分</div>
        </div>
        <div className={styles.statTile}>
          <div className={styles.statValue}>{stats.streak}</div>
          <div className={styles.statLabel}>連續天數</div>
        </div>
      </div>
      <div className={styles.dist}>
        {stats.distribution.map((n, i) => (
          <div key={i} className={styles.distRow}>
            <span className={styles.distLabel}>{labels[i]}</span>
            <div className={styles.distTrack}>
              <div
                className={i === MAX_GUESSES ? styles.distBarMiss : styles.distBar}
                style={{ width: `${(n / peak) * 100}%` }}
              />
            </div>
            <span className={styles.distCount}>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
