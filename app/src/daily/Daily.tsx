import React from "react";
import styles from "../css/game.module.css";
import { load, save } from "../lib/storage";
import { errMsg } from "../lib/util";
import { fetchCategories, fetchDaily, submitDaily, submitScore } from "../net/api";
import { Category, DAILY_ROUNDS, DAILY_SETTINGS } from "../net/protocol";
import { applyGuess, isOver, maxScore, newRound, pickTracks, roundScore, unlockedMs } from "../game/engine";
import { recordGame } from "../game/history";
import { RoundView } from "../game/RoundView";
import { currentUser, loadCategoryTracks, saveTrack, unplayableOf } from "../game/spotify";
import { Summary } from "../game/Summary";
import { Round, Track } from "../game/types";
import { useRoundSession } from "../game/useRoundSession";
import { Leaderboard } from "./Leaderboard";

type Phase = "menu" | "loading" | "round" | "done";

const savedKey = (category: string, date: string) => `daily:${category}:${date}`;

/** 今天還沒人出題：由這個客戶端從分類歌單抽 5 首可播放的歌，送到伺服器（先送先贏） */
async function generateSet(category: Category, userId: string, onStatus: (s: string) => void): Promise<Track[]> {
  onStatus("讀取分類歌單…");
  const pool = await loadCategoryTracks(category.playlists, category.queries);
  if (pool.length < DAILY_ROUNDS) throw new Error(`「${category.name}」找不到足夠的歌（${pool.length} 首）`);
  onStatus("檢查歌曲能不能播放…");
  const candidates = pickTracks(pool, DAILY_ROUNDS * 3);
  const bad = new Set(await unplayableOf(candidates.map((t) => t.uri)));
  const picked = candidates.filter((t) => !bad.has(t.uri)).slice(0, DAILY_ROUNDS);
  if (picked.length < DAILY_ROUNDS) throw new Error("能播放的歌不夠");
  onStatus("送出今天的題目…");
  const { set } = await submitDaily(category.id, userId, picked);
  return set.tracks;
}

export function Daily() {
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [today, setToday] = React.useState("");
  const [category, setCategory] = React.useState<string>(() => load("dailyCategory", ""));
  const [user, setUser] = React.useState<{ id: string; name: string } | null>(null);
  const [phase, setPhase] = React.useState<Phase>("menu");
  const [rounds, setRoundsState] = React.useState<Round[]>([]);
  const [current, setCurrent] = React.useState(0);
  const [status, setStatus] = React.useState("");
  const [error, setError] = React.useState("");
  const [boardKey, setBoardKey] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  const roundsRef = React.useRef<Round[]>([]);
  const currentRef = React.useRef(0);
  currentRef.current = current;
  const setRounds = (list: Round[]) => {
    roundsRef.current = list;
    setRoundsState(list);
  };
  const updateRound = (index: number, r: Round) => setRounds(roundsRef.current.map((x, i) => (i === index ? r : x)));

  const rs = useRoundSession({
    onBlur: () => {
      const r = roundsRef.current[currentRef.current];
      if (phase !== "round" || !r || isOver(r)) return;
      rs.stop();
      updateRound(currentRef.current, { ...r, blurCount: r.blurCount + 1 });
    },
    onDesync: () => {
      const r = roundsRef.current[currentRef.current];
      if (r && !isOver(r)) rs.prepare(r.track.uri, r.startMs).catch((e) => setError(`重新載入這題時出錯：${errMsg(e)}`));
    },
  });

  React.useEffect(() => {
    currentUser().then(setUser);
    fetchCategories()
      .then((r) => {
        setCategories(r.categories);
        setToday(r.today);
        setCategory((c) => (r.categories.some((x) => x.id === c) ? c : r.categories[0]?.id ?? ""));
      })
      .catch((e) => setError(`連不到伺服器：${errMsg(e)}（可以到「設定」檢查伺服器網址）`));
  }, []);

  const cat = categories.find((c) => c.id === category);
  // 今天這個分類玩過了：直接顯示結果
  const played = today && category ? load<Round[] | null>(savedKey(category, today), null) : null;

  const prepare = async (index: number) => {
    setError("");
    setFailed(false);
    const r = roundsRef.current[index];
    try {
      await rs.prepare(r.track.uri, r.startMs);
    } catch (e) {
      // 每日題目大家都一樣，不能換題；載入失敗只能算這題沒猜到
      setError(`這題載入失敗：${errMsg(e)}`);
      setFailed(true);
    }
  };

  const start = async () => {
    if (!cat || !user) return;
    save("dailyCategory", cat.id);
    setPhase("loading");
    setError("");
    try {
      const res = await fetchDaily(cat.id);
      setToday(res.today);
      const tracks = res.set?.tracks ?? (await generateSet(cat, user.id, setStatus));
      setRounds(tracks.map((t) => newRound(t, DAILY_SETTINGS.startMode)));
      setCurrent(0);
      setPhase("round");
      await rs.begin();
      await prepare(0);
    } catch (e) {
      setError(errMsg(e));
      setPhase("menu");
    }
  };

  const finish = async () => {
    rs.end();
    const list = roundsRef.current;
    save(savedKey(category, today), list);
    recordGame("daily", list, { category, date: today });
    setPhase("done");
    if (!user) return;
    try {
      const solvedAt = list.map((r) => r.guesses.findIndex((g) => g.kind === "correct"));
      const score = list.reduce((s, r) => s + roundScore(r), 0);
      await submitScore({ userId: user.id, name: user.name, category, date: today, score, max: maxScore(list.length), solvedAt });
    } catch (e) {
      setError(`成績上傳失敗：${errMsg(e)}`);
    }
    setBoardKey((k) => k + 1);
  };

  const guess = (t: Track | null) => {
    const next = applyGuess(roundsRef.current[current], t);
    updateRound(current, next);
    if (isOver(next)) rs.stop();
  };

  const giveUp = () => {
    let r = roundsRef.current[current];
    while (!isOver(r)) r = applyGuess(r, null);
    updateRound(current, r);
    setFailed(false);
  };

  const next = async () => {
    if (current + 1 >= roundsRef.current.length) return finish();
    setCurrent(current + 1);
    await prepare(current + 1);
  };

  const subtitle = cat ? `每日 ${cat.name} ${today}` : "";
  const board = user && categories.length > 0 && (
    <>
      <h2 className={styles.h2}>排行榜</h2>
      <Leaderboard categories={categories} category={category} me={user.id} refreshKey={boardKey} />
    </>
  );

  return (
    <div>
      {error && <p className={styles.error}>{error}</p>}

      {phase === "menu" && (
        <div className={styles.panel}>
          <h2 className={styles.h2}>每日挑戰 {today}</h2>
          <p className={styles.note}>
            每個分類每天 {DAILY_ROUNDS} 首，大家同一組題目；從頭開始播、自由輸入。每天只有第一次的成績會上排行榜。
          </p>
          <div className={styles.row}>
            {categories.map((c) => (
              <button key={c.id} className={c.id === category ? styles.segActive : styles.seg} onClick={() => setCategory(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
          {played ? (
            <Summary rounds={played} shareSubtitle={subtitle}>
              {board}
            </Summary>
          ) : (
            <>
              <button className={styles.primary} disabled={!cat || !user} onClick={start}>
                開始今天的「{cat?.name ?? "…"}」
              </button>
              {board}
            </>
          )}
        </div>
      )}

      {phase === "loading" && <p className={styles.note}>{status || "讀取今天的題目…"}</p>}

      {phase === "round" && rounds[current] && (
        <>
          <RoundView
            round={rounds[current]}
            index={current}
            total={rounds.length}
            settings={DAILY_SETTINGS}
            pool={[]}
            preparing={rs.preparing}
            playing={rs.playing}
            onPlay={async () => {
              const err = await rs.play(unlockedMs(roundsRef.current[current]));
              if (err) setError(err);
            }}
            onGuess={guess}
            onNext={next}
            onListen={() => rs.listenFreely().catch((e) => setError(`播放失敗：${errMsg(e)}`))}
            onSave={() => saveTrack(rounds[current].track.uri)}
          />
          {failed && (
            <button className={styles.button} onClick={giveUp}>
              這題算沒猜到，繼續
            </button>
          )}
        </>
      )}

      {phase === "done" && (
        <Summary rounds={rounds} shareSubtitle={subtitle}>
          {board}
        </Summary>
      )}
    </div>
  );
}
