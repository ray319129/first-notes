import React from "react";
import styles from "../css/game.module.css";
import { AnswerInput, TrackLabel } from "./AnswerInput";
import { isOver, isSolved, roundScore, unlockedMs } from "./engine";
import { isSameSong } from "./text";
import { MAX_GUESSES, Round, Settings, STEPS_MS, Track } from "./types";

const LONGEST = STEPS_MS[STEPS_MS.length - 1];

/** 片段長度條：已解鎖的部分亮起來，刻度標在每一段的終點 */
function StepsBar(props: { unlocked: number }) {
  return (
    <div className={styles.bar}>
      <div className={styles.barFill} style={{ width: `${(props.unlocked / LONGEST) * 100}%` }} />
      {STEPS_MS.map((ms) => (
        <div key={ms} className={styles.barTick} style={{ left: `${(ms / LONGEST) * 100}%` }} />
      ))}
    </div>
  );
}

function GuessList(props: { round: Round }) {
  const rows = [];
  for (let i = 0; i < MAX_GUESSES; i++) {
    const g = props.round.guesses[i];
    let content: React.ReactNode = "";
    let cls = styles.slot;
    if (g?.kind === "skip") {
      content = "⏭ 跳過";
      cls = styles.slotSkip;
    } else if (g?.kind === "wrong") {
      // 歌手對了但歌名錯：黃色，提示方向沒錯
      content = `${g.artistMatch ? "🟨" : "❌"} ${g.track.name} — ${g.track.artists.join(", ")}`;
      cls = g.artistMatch ? styles.slotArtist : styles.slotWrong;
    } else if (g?.kind === "correct") {
      content = `✅ ${g.track.name} — ${g.track.artists.join(", ")}`;
      cls = styles.slotCorrect;
    }
    rows.push(
      <div key={i} className={cls}>
        {content}
      </div>,
    );
  }
  return <div className={styles.slots}>{rows}</div>;
}

function Reveal(props: {
  round: Round;
  isLast: boolean;
  /** 沒有的話（多人模式非房主）顯示 nextHint */
  onNext?: () => void;
  nextHint?: string;
  onListen: () => void;
  onSave: () => Promise<void>;
}) {
  const { track } = props.round;
  const solved = isSolved(props.round);
  const [saved, setSaved] = React.useState<"idle" | "saving" | "done" | "error">("idle");
  const save = async () => {
    setSaved("saving");
    try {
      await props.onSave();
      setSaved("done");
    } catch {
      setSaved("error");
    }
  };
  return (
    <div className={styles.reveal}>
      {track.imageUrl && <img className={styles.cover} src={track.imageUrl} alt="" />}
      <div>
        <div className={solved ? styles.revealOk : styles.revealFail}>
          {solved ? `答對了！+${roundScore(props.round)} 分` : "沒猜到"}
        </div>
        <div className={styles.revealName}>{track.name}</div>
        <div className={styles.revealArtist}>{track.artists.join(", ")}</div>
        {track.albumName && <div className={styles.revealAlbum}>{track.albumName}</div>}
        <div className={styles.row}>
          <button className={styles.button} onClick={props.onListen}>
            ▶ 從片段處繼續聽
          </button>
          <button className={styles.button} onClick={save} disabled={saved === "saving" || saved === "done"}>
            {saved === "done" ? "✓ 已加入" : saved === "error" ? "加入失敗，再試一次" : "♡ 加入已按讚"}
          </button>
        </div>
      </div>
      {props.onNext ? (
        <button className={styles.primary} onClick={props.onNext} autoFocus>
          {props.isLast ? "看結果" : "下一題"}
        </button>
      ) : (
        <span className={styles.note}>{props.nextHint}</span>
      )}
    </div>
  );
}

export function RoundView(props: {
  round: Round;
  index: number;
  total: number;
  settings: Settings;
  pool: Track[];
  preparing: boolean;
  playing: boolean;
  onPlay: () => void;
  onGuess: (t: Track | null) => void;
  onNext?: () => void;
  onListen: () => void;
  onSave: () => Promise<void>;
  /** 多人：自己答完但還沒揭曉時顯示這段文字，不顯示答案 */
  waitingText?: string;
  /** 多人：顯示在標題列右邊（倒數） */
  extra?: React.ReactNode;
  nextHint?: string;
}) {
  const { round } = props;
  const over = isOver(round);
  const unlocked = unlockedMs(round);
  const nextLength = STEPS_MS[Math.min(round.guesses.length + 1, MAX_GUESSES - 1)];
  const lastChance = round.guesses.length === MAX_GUESSES - 1;
  const guessedWrong = (t: Track) => round.guesses.some((g) => g.kind === "wrong" && isSameSong(g.track, t));

  return (
    <div className={styles.panel}>
      <div className={styles.roundHeader}>
        <span>
          第 {props.index + 1} / {props.total} 題
        </span>
        {round.blurCount > 0 && <span className={styles.warn}>⚠️ 切出視窗 {round.blurCount} 次</span>}
        {props.extra}
      </div>

      <StepsBar unlocked={unlocked} />
      <div className={styles.row}>
        <button className={styles.play} onClick={props.onPlay} disabled={props.preparing || props.playing || over}>
          {props.preparing ? "準備中…" : props.playing ? "播放中…" : `▶ 播放 ${unlocked / 1000} 秒`}
        </button>
      </div>

      <GuessList round={round} />

      {over && props.waitingText ? (
        <p className={styles.note}>{props.waitingText}</p>
      ) : over ? (
        <Reveal
          key={round.track.uri}
          round={round}
          isLast={props.index + 1 === props.total}
          onNext={props.onNext}
          nextHint={props.nextHint}
          onListen={props.onListen}
          onSave={props.onSave}
        />
      ) : (
        <>
          {props.settings.answerMode === "free" ? (
            <AnswerInput pool={props.pool} disabled={props.preparing} onSubmit={props.onGuess} />
          ) : (
            <div className={styles.choices}>
              {(round.choices ?? []).map((t) => (
                <button
                  key={t.uri}
                  className={styles.choice}
                  disabled={props.preparing || guessedWrong(t)}
                  onClick={() => props.onGuess(t)}
                >
                  <TrackLabel track={t} />
                </button>
              ))}
              {!round.choices && <div className={styles.note}>準備選項中…</div>}
            </div>
          )}
          <button className={styles.button} onClick={() => props.onGuess(null)} disabled={props.preparing}>
            {lastChance ? "放棄" : `跳過（+${(nextLength - unlocked) / 1000} 秒）`}
          </button>
        </>
      )}
    </div>
  );
}
