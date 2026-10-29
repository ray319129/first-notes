import { Platform, sleep, waitFor } from "../lib/util";

const P = () => Spicetify.Player;
const PA = () => Platform().PlayerAPI;
const currentUri = () => (P().data as any)?.item?.uri as string | undefined;

// 實測：靜音要確認生效後再多等一下才開始播，否則會漏出聲音；Player.setMute 不可靠，一律用音量 0
const SILENCE_GUARD_MS = 300;
// 守門檢查的頻率與容許誤差
const GUARD_INTERVAL_MS = 100;
const GUARD_SLACK_MS = 800;

/**
 * 片段播放器（預載法，見 HANDOFF「API 定案」）：
 * prepare() 在音量 0 下以暫停狀態載入歌曲並停在起點；play() 從起點 resume，播到指定長度就暫停。
 *
 * 防偷聽的守門機制：鎖定期間每 100ms 檢查一次，
 * - 不是我們在播片段，但 Spotify 在播（玩家按了播放鍵、媒體鍵）→ 立刻暫停
 * - 播片段時進度跑出片段範圍（玩家拖了進度條）→ 立刻停止
 * - 歌被換掉（玩家按了下一首）→ 通知外面重新準備這題
 */
export class ClipPlayer {
  private userVolume: number | null = null;
  private uri = "";
  private startMs = 0;
  /** 每次 play／stop 都換新 token，讓舊的播放迴圈自己結束 */
  private token = 0;
  private clipEnd: number | null = null;
  private preparing = false;
  private locked = false;
  private guardTimer: ReturnType<typeof setInterval> | null = null;
  /** 歌曲被玩家換掉時呼叫 */
  onDesync: (() => void) | null = null;

  /** 遊戲開始時記下使用者原本的音量，之後都還原成這個值 */
  begin() {
    this.userVolume = P().getVolume();
    this.guardTimer = setInterval(() => this.guard(), GUARD_INTERVAL_MS);
  }

  end() {
    this.stop();
    this.locked = false;
    if (this.guardTimer) clearInterval(this.guardTimer);
    this.guardTimer = null;
    if (this.userVolume !== null) P().setVolume(this.userVolume);
    this.userVolume = null;
  }

  async prepare(uri: string, startMs: number) {
    this.stop();
    this.uri = uri;
    this.startMs = startMs;
    this.locked = true;
    this.preparing = true;
    const volume = this.userVolume ?? P().getVolume();
    P().setVolume(0);
    try {
      await waitFor(() => P().getVolume() === 0, 2000);
      await sleep(SILENCE_GUARD_MS);
      await PA().play({ uri }, {}, { seekTo: startMs, paused: true });
      await waitFor(() => currentUri() === uri, 8000);
      // paused: true 實測有效；萬一這次沒生效，就手動暫停（仍在音量 0 下，不會出聲）
      await sleep(150);
      if (P().isPlaying()) {
        await PA().pause();
        await waitFor(() => !P().isPlaying(), 2000);
      }
      await this.seekToStart();
    } finally {
      this.preparing = false;
      P().setVolume(volume);
    }
  }

  /** 播放 lengthMs 毫秒，播完或被 stop() 時結束 */
  async play(lengthMs: number) {
    const token = ++this.token;
    if (P().isPlaying()) await PA().pause();
    await this.seekToStart();
    if (token !== this.token) return;
    this.clipEnd = this.startMs + lengthMs;
    await PA().resume();
    const deadline = performance.now() + lengthMs + 3000;
    // 用播放進度判斷何時停，比 setTimeout 準（resume 本身有幾十毫秒延遲）
    while (token === this.token && P().getProgress() < this.clipEnd && performance.now() < deadline) {
      await sleep(15);
    }
    if (token === this.token) this.stop();
  }

  stop() {
    this.token++;
    this.clipEnd = null;
    if (P().isPlaying()) PA().pause();
  }

  /** 揭曉後：解除鎖定，從片段起點繼續往下播，玩家可以自由操作 */
  async listenFreely() {
    this.stop();
    this.locked = false;
    await this.seekToStart();
    await PA().resume();
  }

  private guard() {
    if (!this.locked || this.preparing) return;
    if (currentUri() !== this.uri) {
      this.stop();
      // 先解鎖，避免重新準備之前每 100ms 重複觸發；prepare() 會再鎖上
      this.locked = false;
      this.onDesync?.();
      return;
    }
    if (!P().isPlaying()) return;
    const progress = P().getProgress();
    const inClip = this.clipEnd !== null && progress >= this.startMs - GUARD_SLACK_MS && progress <= this.clipEnd + GUARD_SLACK_MS;
    if (!inClip) this.stop();
  }

  private async seekToStart() {
    await PA().seekTo(this.startMs);
    await waitFor(() => Math.abs(P().getProgress() - this.startMs) < 300, 2000);
  }
}
