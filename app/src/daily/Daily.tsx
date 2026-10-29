import React from "react";
import styles from "../css/game.module.css";
import { load, save } from "../lib/storage";
import { errMsg } from "../lib/util";
import { fetchCategories, fetchDaily, getServer, isDefaultServer, submitDaily, submitScore } from "../net/api";
import { Category, DAILY_CHOICE_COUNT, DAILY_ROUNDS, DailyChoice, DailySet, dailySettings } from "../net/protocol";
import { applyGuess, buildChoices, isOver, maxScore, newRound, pickTracks, roundScore, sameArtistTracks, unlockedMs } from "../game/engine";
import { recordGame } from "../game/history";
import { RoundView } from "../game/RoundView";
import { currentUser, loadCategoryTracks, saveTrack, unplayableOf } from "../game/spotify";
import { Summary } from "../game/Summary";
import { AnswerMode, Round, Track } from "../game/types";
import { useRoundSession } from "../game/useRoundSession";
import { Leaderboard, MODE_LABELS } from "./Leaderboard";

type Phase = "menu" | "loading" | "round" | "done";

const savedKey = (category: string, date: string) => `daily:${category}:${date}`;
const savedModeKey = (category: string, date: string) => `dailyMode:${category}:${date}`;

/** 選擇題選項：同歌手優先，再從分類歌單補 */
const makeChoices = (tracks: Track[], pool: Track[]): DailyChoice[] =>
  tracks.map((t) => buildChoices(t, [sameArtistTracks(t, pool), pool], DAILY_CHOICE_COUNT));

async function loadPool(category: Category, onStatus: (s: string) => void) {
  onStatus("讀取分類歌單…");
  const pool = await loadCategoryTracks(category.playlists, category.queries);
  if (pool.length < DAILY_ROUNDS) throw new Error(`「${category.name}」找不到足夠的歌（${pool.length} 首）`);
  return pool;
}

/** 今天還沒人出題：由這個客戶端從分類歌單抽 5 首可播放的歌，連同選擇題選項送到伺服器（先送先贏） */
async function generateSet(category: Category, userId: string, onStatus: (s: string) => void): Promise<DailySet> {
  const pool = await loadPool(category, onStatus);
  onStatus("檢查歌曲能不能播放…");
  const candidates = pickTracks(pool, DAILY_ROUNDS * 3);
  const bad = new Set(await unplayableOf(candidates.map((t) => t.uri)));
  const picked = candidates.filter((t) => !bad.has(t.uri)).slice(0, DAILY_ROUNDS);
  if (picked.length < DAILY_ROUNDS) throw new Error("能播放的歌不夠");
  onStatus("送出今天的題目…");
  const { set } = await submitDaily(category.id, userId, picked, makeChoices(picked, pool));
  return set;
}

/** 題目是舊版客戶端產生的、還沒有選擇題選項：補一份（一樣先送先贏，大家拿到同一份） */
async function ensureChoices(category: Category, set: DailySet, userId: string, onStatus: (s: string) => void) {
  if (set.choices) return set.choices;
  const pool = await loadPool(category, onStatus);
  onStatus("準備選項…");
  const res = await submitDaily(category.id, userId, set.tracks, makeChoices(set.tracks, pool));
  if (!res.set.choices) throw new Error("伺服器沒有存到選擇題選項");
  return res.set.choices;
}

export function Daily() {
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [today, setToday] = React.useState("");
  const [category, setCategory] = React.useState<string>(() => load("dailyCategory", ""));
  const [mode, setMode] = React.useState<AnswerMode>(() => load("dailyAnswerMode", "free"));
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
  // 玩過就看當時用的作答方式（每天每分類只能用一種方式上榜）
  const playedMode = played ? load<AnswerMode>(savedModeKey(category, today), "free") : mode;

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
    save("dailyAnswerMode", mode);
    setPhase("loading");
    setError("");
    try {
      const res = await fetchDaily(cat.id);
      setToday(res.today);
      const set = res.set ?? (await generateSet(cat, user.id, setStatus));
      const choices = mode === "choice" ? await ensureChoices(cat, set, user.id, setStatus) : null;
      setRounds(
        set.tracks.map((t, i) => ({
          ...newRound(t, "beginning"),
          ...(choices ? { choices: choices[i].choices, reserve: choices[i].reserve } : {}),
        })),
      );
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
    save(savedModeKey(category, today), mode);
    recordGame("daily", list, { category, date: today });
    setPhase("done");
    if (!user) return;
    try {
      const solvedAt = list.map((r) => r.guesses.findIndex((g) => g.kind === "correct"));
      const score = list.reduce((s, r) => s + roundScore(r), 0);
      await submitScore({ userId: user.id, name: user.name, category, date: today, mode, score, max: maxScore(list.length), solvedAt });
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

  const modeLabel = MODE_LABELS.find((m) => m.value === playedMode)?.label ?? "";
  const subtitle = cat ? `每日 ${cat.name}（${modeLabel}）${today}` : "";
  const board = user && categories.length > 0 && (
    <>
      <h2 className={styles.h2}>排行榜</h2>
      <Leaderboard categories={categories} category={category} mode={playedMode} me={user.id} refreshKey={boardKey} />
    </>
  );

  return (
    <div>
      {error && <p className={styles.error}>{error}</p>}
      {!isDefaultServer() && (
        <p className={styles.error}>
          目前連到自訂伺服器 {getServer()}，成績只會出現在這台伺服器的排行榜。要跟大家一起排名，請到「設定」按「還原預設」。
        </p>
      )}

      {phase === "menu" && (
        <div className={styles.panel}>
          <h2 className={styles.h2}>每日挑戰 {today}</h2>
          <p className={styles.note}>
            每個分類每天 {DAILY_ROUNDS} 首，大家同一組題目，從頭開始播。自由輸入和選擇題（{DAILY_CHOICE_COUNT} 選 1）分開排名；每個分類每天只能選一種方式，第一次的成績才會上排行榜。
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
              <div className={styles.row}>
                <div className={styles.segmented}>
                  {MODE_LABELS.map((m) => (
                    <button key={m.value} className={mode === m.value ? styles.segActive : styles.seg} onClick={() => setMode(m.value)}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
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
            settings={dailySettings(mode)}
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
