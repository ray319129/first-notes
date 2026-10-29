import React from "react";
import { errMsg } from "../lib/util";
import { ClipPlayer } from "./clip";
import { getPrivateSession, setPrivateSession, setTrackInfoHidden } from "./spotify";

/**
 * 一局遊戲期間的播放與防作弊副作用，單人、每日挑戰、多人共用：
 * begin() 隱藏歌名與播放控制、開私人聆聽、啟動守門；end() 全部還原。
 * 元件卸載（例如切到別的 Spotify 頁面）時也會自動 end()。
 */
export function useRoundSession(opts: { onBlur: () => void; onDesync: () => void }) {
  const clip = React.useRef(new ClipPlayer()).current;
  const [preparing, setPreparing] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const session = React.useRef({ active: false, enabledPrivate: false });
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const begin = async () => {
    if (session.current.active) return;
    clip.begin();
    clip.onDesync = () => optsRef.current.onDesync();
    setTrackInfoHidden(true);
    session.current = { active: true, enabledPrivate: false };
    try {
      // 原本就在私人聆聽的話不動它，結束時也不關
      if ((await getPrivateSession()) !== true) {
        await setPrivateSession(true);
        session.current.enabledPrivate = true;
      }
    } catch {
      // 開不了私人聆聽不影響遊戲
    }
  };

  const end = () => {
    if (!session.current.active) return;
    clip.end();
    setTrackInfoHidden(false);
    if (session.current.enabledPrivate) setPrivateSession(false).catch(() => {});
    session.current = { active: false, enabledPrivate: false };
  };

  React.useEffect(() => end, []);

  // 切出視窗：交給外面決定（回合進行中要停掉片段並記錄次數，揭曉後自由聆聽則不管）
  React.useEffect(() => {
    const onBlur = () => {
      if (session.current.active) optsRef.current.onBlur();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  /** 準備片段；失敗時丟出錯誤，由呼叫端決定換題或跳過 */
  const prepare = async (uri: string, startMs: number) => {
    setPreparing(true);
    try {
      await clip.prepare(uri, startMs);
    } finally {
      setPreparing(false);
    }
  };

  const play = async (lengthMs: number): Promise<string | null> => {
    setPlaying(true);
    try {
      await clip.play(lengthMs);
      return null;
    } catch (e) {
      return `播放失敗：${errMsg(e)}`;
    } finally {
      setPlaying(false);
    }
  };

  return {
    begin,
    end,
    prepare,
    play,
    stop: () => clip.stop(),
    listenFreely: () => clip.listenFreely(),
    preparing,
    playing,
  };
}

export type RoundSession = ReturnType<typeof useRoundSession>;
