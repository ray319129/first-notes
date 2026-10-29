import React from "react";
import styles from "../css/game.module.css";
import { load, save } from "../lib/storage";
import { errMsg } from "../lib/util";
import { applyGuess, buildChoices, isOver, newRound, pickTracks, sameArtistTracks, unlockedMs } from "./engine";
import { recentUris, recordGame } from "./history";
import { RoundView } from "./RoundView";
import { DEFAULT_SETTINGS, Setup } from "./Setup";
import { addSource, SavedSource, SourceEntry, toSaved } from "./SourcePicker";
import { albumTracks, saveTrack } from "./spotify";
import { Summary } from "./Summary";
import { songKey } from "./text";
import { Round, Settings, Track } from "./types";
import { useRoundSession } from "./useRoundSession";

type Phase = "setup" | "round" | "summary";

// 一題載入失敗（歌曲下架、地區限制等）時，最多自動換幾次
const MAX_REPLACE = 3;

async function makeChoices(answer: Track, pool: Track[], settings: Settings) {
  const sameArtist = sameArtistTracks(answer, pool);
  const candidates =
    settings.distractor === "album"
      ? [answer.albumUri ? await albumTracks(answer.albumUri) : [], sameArtist, pool]
      : settings.distractor === "artist"
        ? [sameArtist, pool]
        : [pool];
  return buildChoices(answer, candidates, settings.choiceCount);
}

export function Game() {
  const [phase, setPhase] = React.useState<Phase>("setup");
  const [settings, setSettings] = React.useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...load("settings", {}) }));
  const [sources, setSources] = React.useState<SourceEntry[]>([]);
  const [pool, setPool] = React.useState<Track[]>([]);
  const [rounds, setRoundsState] = React.useState<Round[]>([]);
  const [current, setCurrent] = React.useState(0);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  /** 這題換了幾次都載入失敗，只能跳過 */
  const [stuck, setStuck] = React.useState(false);

  // 非同步流程（準備、換題）要讀最新的回合，用 ref 同步一份
  const roundsRef = React.useRef<Round[]>([]);
  const currentRef = React.useRef(0);
  currentRef.current = current;
  // 每局一個編號：結束這局後，還在跑的準備流程不再改畫面
  const gameId = React.useRef(0);

  const setRounds = (fn: (rs: Round[]) => Round[]) => {
    roundsRef.current = fn(roundsRef.current);
    setRoundsState(roundsRef.current);
  };
  const updateRound = (index: number, patch: Partial<Round>) =>
    setRounds((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const rs = useRoundSession({
    onBlur: () => {
      const r = roundsRef.current[currentRef.current];
      if (phase !== "round" || !r || isOver(r)) return;
      rs.stop();
      updateRound(currentRef.current, { blurCount: r.blurCount + 1 });
    },
    // 玩家換了歌（按下一首、點了別的歌）：重新載入這題
    onDesync: () => {
      const r = roundsRef.current[currentRef.current];
      if (!r || isOver(r)) return;
      rs.prepare(r.track.uri, r.startMs).catch((e) => setError(`重新載入這題時出錯：${errMsg(e)}`));
    },
  });

  // 上次用的題庫來源：開啟時自動重新載入
  React.useEffect(() => {
    for (const s of load<SavedSource[]>("sources", [])) addSource(setSources, s.ref, s.label, s.image);
  }, []);

  /** 從題庫找一首還沒出過的歌來換掉載入失敗的題目 */
  const pickReplacement = (p: Track[], failed: Set<string>): Track | undefined => {
    const used = new Set(roundsRef.current.map((r) => songKey(r.track)));
    const candidates = p.filter((t) => !failed.has(t.uri) && !used.has(songKey(t)));
    return pickTracks(candidates, 1, recentUris())[0];
  };

  const prepareRound = async (index: number, s: Settings, p: Track[]) => {
    const id = gameId.current;
    setError("");
    setNotice("");
    setStuck(false);
    const failed = new Set<string>();
    for (let attempt = 0; ; attempt++) {
      const round = roundsRef.current[index];
      try {
        if (s.answerMode === "choice" && !round.choices) {
          const { choices, reserve } = await makeChoices(round.track, p, s);
          if (id !== gameId.current) return;
          updateRound(index, { choices, reserve });
        }
        await rs.prepare(round.track.uri, round.startMs);
        return;
      } catch (e) {
        if (id !== gameId.current) return;
        failed.add(round.track.uri);
        const replacement = attempt < MAX_REPLACE ? pickReplacement(p, failed) : undefined;
        if (!replacement) {
          setError(`這題載入失敗：${errMsg(e)}`);
          setStuck(true);
          return;
        }
        // 換新的歌，選項也要重新產生
        setRounds((rs) => rs.map((r, i) => (i === index ? newRound(replacement, s.startMode) : r)));
        setNotice("有一首歌無法播放，已自動換題");
      }
    }
  };

  const start = async (s: Settings, p: Track[]) => {
    gameId.current++;
    save("settings", s);
    save("sources", toSaved(sources));
    setRounds(() => pickTracks(p, s.rounds, recentUris()).map((t) => newRound(t, s.startMode)));
    setSettings(s);
    setPool(p);
    setCurrent(0);
    setPhase("round");
    await rs.begin();
    await prepareRound(0, s, p);
  };

  const finish = () => {
    rs.end();
    recordGame("free", roundsRef.current);
    setPhase("summary");
  };

  const quit = () => {
    gameId.current++;
    rs.end();
    setError("");
    setNotice("");
    setPhase("setup");
  };

  const play = async () => {
    const err = await rs.play(unlockedMs(roundsRef.current[current]));
    if (err) setError(err);
  };

  const guess = (t: Track | null) => {
    const next = applyGuess(roundsRef.current[current], t);
    updateRound(current, next);
    if (isOver(next)) rs.stop();
  };

  const goTo = async (index: number) => {
    if (index >= roundsRef.current.length) {
      if (roundsRef.current.length) finish();
      else quit();
      return;
    }
    setCurrent(index);
    await prepareRound(index, settings, pool);
  };

  /** 載入失敗又換不到歌：直接拿掉這題 */
  const dropCurrent = () => {
    setRounds((list) => list.filter((_, i) => i !== current));
    goTo(current);
  };

  const round = rounds[current];
  return (
    <div>
      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.note}>{notice}</p>}
      {phase === "setup" && <Setup initial={settings} sources={sources} setSources={setSources} onStart={start} />}
      {phase === "round" && round && (
        <RoundView
          round={round}
          index={current}
          total={rounds.length}
          settings={settings}
          pool={pool}
          preparing={rs.preparing}
          playing={rs.playing}
          onPlay={play}
          onGuess={guess}
          onNext={() => goTo(current + 1)}
          onListen={() => rs.listenFreely().catch((e) => setError(`播放失敗：${errMsg(e)}`))}
          onSave={() => saveTrack(round.track.uri)}
        />
      )}
      {phase === "round" && stuck && (
        <button className={styles.button} onClick={dropCurrent}>
          跳過這題（不計分）
        </button>
      )}
      {phase === "summary" && <Summary rounds={rounds} onReplay={() => setPhase("setup")} />}
      {phase === "round" && (
        <button className={styles.quit} onClick={quit}>
          結束這局
        </button>
      )}
    </div>
  );
}
