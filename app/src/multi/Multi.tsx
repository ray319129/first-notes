import React from "react";
import styles from "../css/game.module.css";
import { errMsg } from "../lib/util";
import { createRoom } from "../net/api";
import { PlayerView, POOL_CHUNK, RoomSettings, RoomView } from "../net/protocol";
import { isOver, unlockedMs } from "../game/engine";
import { RoundView } from "../game/RoundView";
import { Radio } from "../game/Setup";
import { mergePool, SourceEntry, SourcePicker } from "../game/SourcePicker";
import { currentUser, saveTrack, unplayableOf } from "../game/spotify";
import { Round, Track } from "../game/types";
import { useRoundSession } from "../game/useRoundSession";
import { useRoom } from "./useRoom";

const MARK_EMOJI = { correct: "🟩", wrong: "🟥", artist: "🟨", skip: "⬛" } as const;

/** 伺服器給的「我的這題」轉成 RoundView 用的 Round；還沒揭曉時歌名是空的 */
function toRound(room: RoomView, userId: string): Round | null {
  const me = room.me;
  if (!me) return null;
  const answer = room.answers[me.index];
  const track: Track = answer ?? { uri: me.uri, name: "", artists: [], artistUris: [], durationMs: 0 };
  const blurCount = room.players.find((p) => p.id === userId)?.blurCount ?? 0;
  return { track, startMs: me.startMs, guesses: me.guesses, choices: me.choices, blurCount };
}

function Countdown(props: { deadline: number | null }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  if (!props.deadline) return null;
  const s = Math.max(0, Math.ceil((props.deadline - now) / 1000));
  return <span className={s <= 10 ? styles.warn : styles.note}>⏱ {s} 秒</span>;
}

function Players(props: { players: PlayerView[]; me: string; showMarks: boolean }) {
  const sorted = [...props.players].sort((a, b) => b.score - a.score);
  return (
    <div className={styles.results}>
      {sorted.map((p) => (
        <div key={p.id} className={styles.resultRow}>
          <div className={styles.resultText}>
            <div className={styles.sugName}>
              {p.host ? "👑 " : ""}
              {p.name}
              {p.id === props.me ? "（你）" : ""}
              {!p.connected && <span className={styles.note}>（離線）</span>}
            </div>
            <div className={styles.sugArtist}>
              題庫 {p.poolSize} 首{p.blurCount > 0 && <span className={styles.warn}> · ⚠️ 切出視窗 {p.blurCount} 次</span>}
            </div>
          </div>
          {props.showMarks && (
            <div className={styles.emoji}>
              {p.marks.map((m) => MARK_EMOJI[m]).join("")}
              {p.done ? " ✓" : ""}
            </div>
          )}
          <div className={styles.resultScore}>{p.score}</div>
        </div>
      ))}
    </div>
  );
}

function RoomSettingsForm(props: { settings: RoomSettings; editable: boolean; onChange: (s: RoomSettings) => void }) {
  const s = props.settings;
  const set = <K extends keyof RoomSettings>(k: K, v: RoomSettings[K]) => props.editable && props.onChange({ ...s, [k]: v });
  return (
    <fieldset className={styles.fieldset} disabled={!props.editable}>
      <div className={styles.field}>
        <span className={styles.label}>題庫</span>
        <Radio
          value={s.poolMode}
          onChange={(v) => set("poolMode", v)}
          options={[
            { value: "everyone", label: "大家的合併" },
            { value: "host", label: "只用房主的" },
          ]}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>題數</span>
        <Radio value={s.rounds} onChange={(v) => set("rounds", v)} options={[5, 10, 15, 20].map((n) => ({ value: n, label: `${n} 題` }))} />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>每題限時</span>
        <Radio
          value={s.roundSeconds}
          onChange={(v) => set("roundSeconds", v)}
          options={[30, 60, 90, 120].map((n) => ({ value: n, label: `${n} 秒` }))}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>片段起點</span>
        <Radio
          value={s.startMode}
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
          value={s.answerMode}
          onChange={(v) => set("answerMode", v)}
          options={[
            { value: "free", label: "自由輸入" },
            { value: "choice", label: "選擇題" },
          ]}
        />
      </div>
      {s.answerMode === "choice" && (
        <>
          <div className={styles.field}>
            <span className={styles.label}>選項數</span>
            <Radio
              value={s.choiceCount}
              onChange={(v) => set("choiceCount", v)}
              options={([4, 6, 8] as const).map((n) => ({ value: n, label: `${n} 個` }))}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>干擾選項</span>
            <Radio
              value={s.distractor}
              onChange={(v) => set("distractor", v)}
              options={[
                { value: "random", label: "題庫隨機" },
                { value: "artist", label: "同歌手優先" },
              ]}
            />
          </div>
        </>
      )}
    </fieldset>
  );
}

export function Multi() {
  const [user, setUser] = React.useState<{ id: string; name: string } | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const [joinInput, setJoinInput] = React.useState("");
  const [sources, setSources] = React.useState<SourceEntry[]>([]);
  const [checking, setChecking] = React.useState(false);
  const [localError, setLocalError] = React.useState("");

  React.useEffect(() => {
    currentUser().then(setUser);
  }, []);

  const pool = React.useMemo(() => mergePool(sources), [sources]);

  // 伺服器要求檢查可播放性：用自己的帳號查（各人地區不同）
  const onCheck = async (uris: string[]) => {
    setChecking(true);
    try {
      send({ t: "check", unplayable: await unplayableOf(uris) });
    } finally {
      setChecking(false);
    }
  };
  const { room, status, error, setError, send } = useRoom(code, user, onCheck);
  const roomRef = React.useRef(room);
  roomRef.current = room;

  const rs = useRoundSession({
    onBlur: () => {
      const r = roomRef.current;
      if (r?.phase !== "round" || !r.me || r.me.done) return;
      rs.stop();
      send({ t: "blur", round: r.me.index });
    },
    onDesync: () => {
      const me = roomRef.current?.me;
      if (me && !me.done) rs.prepare(me.uri, me.startMs).catch((e) => setLocalError(`重新載入這題時出錯：${errMsg(e)}`));
    },
  });

  // 題庫有變就上傳（大題庫分批送）
  React.useEffect(() => {
    if (status !== "open" || room?.phase !== "lobby") return;
    if (sources.some((s) => s.status === "loading")) return;
    const timer = setTimeout(() => {
      for (let i = 0; i === 0 || i < pool.length; i += POOL_CHUNK) {
        send({ t: "pool", tracks: pool.slice(i, i + POOL_CHUNK), reset: i === 0 });
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [pool, status, room?.phase === "lobby"]);

  // 新的一題：準備片段；開始／結束時套用、還原防作弊
  const roundKey = room?.phase === "round" && room.me ? `${room.round}:${room.me.uri}` : "";
  React.useEffect(() => {
    if (!roundKey || !room?.me) return;
    const me = room.me;
    (async () => {
      await rs.begin();
      setLocalError("");
      try {
        await rs.prepare(me.uri, me.startMs);
      } catch (e) {
        setLocalError(`這題載入失敗：${errMsg(e)}（可以直接放棄這題）`);
      }
    })();
  }, [roundKey]);
  // 自己這題結束（猜中或用完機會）就停掉片段
  React.useEffect(() => {
    if (room?.me?.done) rs.stop();
  }, [room?.me?.done]);
  React.useEffect(() => {
    if (room?.phase === "final" || room?.phase === "lobby" || !code) rs.end();
  }, [room?.phase, code]);

  const create = async () => {
    setLocalError("");
    try {
      const { code } = await createRoom();
      setCode(code);
    } catch (e) {
      setLocalError(`開不了房間：${errMsg(e)}（可以到「設定」檢查伺服器網址）`);
    }
  };
  const join = () => {
    const c = joinInput.trim().toUpperCase();
    if (/^[A-Z2-9]{5}$/.test(c)) setCode(c);
    else setLocalError("房號是 5 個英文或數字");
  };
  const leave = () => {
    rs.end();
    setCode(null);
  };

  const me = room?.players.find((p) => p.id === user?.id);
  const isHost = !!me?.host;
  const round = room && user ? toRound(room, user.id) : null;
  const messages = [error, localError].filter(Boolean);

  if (!code) {
    return (
      <div className={styles.panel}>
        {messages.map((m) => (
          <p key={m} className={styles.error}>
            {m}
          </p>
        ))}
        <h2 className={styles.h2}>多人連線</h2>
        <p className={styles.note}>每個人在自己的 Spotify 上玩同一組題目，同時作答、各自計分。房號傳給朋友就能加入。</p>
        <div className={styles.row}>
          <button className={styles.primary} onClick={create} disabled={!user}>
            開新房間
          </button>
        </div>
        <div className={styles.row}>
          <input
            className={styles.input}
            placeholder="輸入房號"
            value={joinInput}
            maxLength={5}
            onChange={(e) => setJoinInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button className={styles.button} onClick={join} disabled={!user}>
            加入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {messages.map((m) => (
        <p key={m} className={styles.error} onClick={() => (setError(""), setLocalError(""))}>
          {m}
        </p>
      ))}
      <div className={styles.roundHeader}>
        <span>
          房號 <b className={styles.roomCode}>{code}</b>
        </span>
        <span className={styles.note}>
          {status === "connecting" ? "連線中…" : status === "lost" ? "連線中斷" : room ? `${room.players.length} 人` : ""}
        </span>
        <button className={styles.button} onClick={leave}>
          離開房間
        </button>
      </div>

      {room?.phase === "lobby" && (
        <div className={styles.panel}>
          <h2 className={styles.h2}>玩家</h2>
          <Players players={room.players} me={user?.id ?? ""} showMarks={false} />
          <h2 className={styles.h2}>規則{isHost ? "" : "（房主設定）"}</h2>
          <RoomSettingsForm settings={room.settings} editable={isHost} onChange={(s) => send({ t: "settings", settings: s })} />
          {(room.settings.poolMode === "everyone" || isHost) && (
            <>
              <h2 className={styles.h2}>我的題庫（{pool.length} 首）</h2>
              <SourcePicker sources={sources} setSources={setSources} />
            </>
          )}
          {isHost ? (
            <button className={styles.primary} onClick={() => send({ t: "start" })}>
              開始遊戲
            </button>
          ) : (
            <p className={styles.note}>等房主開始…</p>
          )}
        </div>
      )}

      {room?.phase === "checking" && (
        <p className={styles.note}>{checking ? "檢查歌曲在你這邊能不能播放…" : "等其他玩家檢查歌曲…"}</p>
      )}

      {(room?.phase === "round" || room?.phase === "reveal") && (
        <>
          {round ? (
            <RoundView
              round={round}
              index={room.round}
              total={room.total}
              settings={room.settings}
              pool={pool}
              preparing={rs.preparing}
              playing={rs.playing}
              onPlay={async () => {
                const err = await rs.play(unlockedMs(round));
                if (err) setLocalError(err);
              }}
              onGuess={(t) => {
                if (!isOver(round)) send({ t: "guess", round: room.round, track: t });
              }}
              onNext={isHost ? () => send({ t: "next" }) : undefined}
              nextHint="等房主按下一題（或幾秒後自動開始）"
              onListen={() => rs.listenFreely().catch((e) => setLocalError(`播放失敗：${errMsg(e)}`))}
              onSave={() => saveTrack(round.track.uri)}
              waitingText={room.phase === "round" ? "你答完了，等其他玩家…" : undefined}
              extra={room.phase === "round" ? <Countdown deadline={room.deadline} /> : null}
            />
          ) : (
            <p className={styles.note}>這題開始後才加入，下一題就能玩</p>
          )}
          <div className={styles.panel}>
            <Players players={room.players} me={user?.id ?? ""} showMarks />
          </div>
        </>
      )}

      {room?.phase === "final" && (
        <div className={styles.panel}>
          <h2 className={styles.h2}>最終排名</h2>
          <Players players={room.players} me={user?.id ?? ""} showMarks={false} />
          <h2 className={styles.h2}>這局的歌</h2>
          <div className={styles.results}>
            {room.answers.map((t, i) => (
              <div key={i} className={styles.resultRow}>
                {t.imageUrl ? <img className={styles.thumb} src={t.imageUrl} alt="" /> : <div className={styles.thumb} />}
                <div className={styles.resultText}>
                  <div className={styles.sugName}>{t.name}</div>
                  <div className={styles.sugArtist}>{t.artists.join(", ")}</div>
                </div>
              </div>
            ))}
          </div>
          {isHost ? (
            <button className={styles.primary} onClick={() => send({ t: "again" })}>
              再來一局
            </button>
          ) : (
            <p className={styles.note}>等房主決定要不要再來一局</p>
          )}
        </div>
      )}
    </div>
  );
}
