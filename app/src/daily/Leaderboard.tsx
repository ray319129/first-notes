import React from "react";
import styles from "../css/game.module.css";
import { errMsg } from "../lib/util";
import { fetchLeaderboard } from "../net/api";
import { Category, LeaderboardRow, Period } from "../net/protocol";

const PERIODS: { value: Period; label: string }[] = [
  { value: "day", label: "今日" },
  { value: "week", label: "本週" },
  { value: "month", label: "本月" },
];

/** 每日挑戰排行榜：今日／本週／本月 × 單一分類／全部分類加總 */
export function Leaderboard(props: { categories: Category[]; category: string; me: string; refreshKey?: number }) {
  const [period, setPeriod] = React.useState<Period>("day");
  const [scope, setScope] = React.useState<"category" | "all">("category");
  const [data, setData] = React.useState<{ from: string; to: string; rows: LeaderboardRow[] } | null>(null);
  const [error, setError] = React.useState("");
  const category = scope === "all" ? "all" : props.category;

  React.useEffect(() => {
    let cancelled = false;
    setError("");
    fetchLeaderboard(period, category)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(`讀不到排行榜：${errMsg(e)}`));
    return () => {
      cancelled = true;
    };
  }, [period, category, props.refreshKey]);

  const catName = props.categories.find((c) => c.id === props.category)?.name ?? props.category;
  return (
    <div>
      <div className={styles.row}>
        <div className={styles.segmented}>
          {PERIODS.map((p) => (
            <button key={p.value} className={period === p.value ? styles.segActive : styles.seg} onClick={() => setPeriod(p.value)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.segmented}>
          <button className={scope === "category" ? styles.segActive : styles.seg} onClick={() => setScope("category")}>
            {catName}
          </button>
          <button className={scope === "all" ? styles.segActive : styles.seg} onClick={() => setScope("all")}>
            全部分類
          </button>
        </div>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {data && (
        <>
          <p className={styles.note}>{data.from === data.to ? data.from : `${data.from} ～ ${data.to}`}</p>
          {data.rows.length === 0 ? (
            <p className={styles.note}>還沒有人上榜</p>
          ) : (
            <table className={styles.board}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>玩家</th>
                  <th>分數</th>
                  <th>場次</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.userId} className={r.userId === props.me ? styles.boardMe : undefined}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td>
                      {r.score} <span className={styles.scoreMax}>/ {r.max}</span>
                    </td>
                    <td>{r.games}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
