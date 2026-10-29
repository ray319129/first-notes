import React from "react";
import { roomSocketUrl } from "../net/api";
import { ClientMsg, RoomView, ServerMsg } from "../net/protocol";

// 斷線自動重連的次數與間隔
const RETRIES = 5;
const RETRY_MS = 2000;

/**
 * 房間的 WebSocket 連線：連上就送 hello，斷線自動重連（伺服器以 userId 認人，分數不會掉）。
 * onCheck：伺服器要求檢查一批歌能不能播。
 */
export function useRoom(code: string | null, user: { id: string; name: string } | null, onCheck: (uris: string[]) => void) {
  const [room, setRoom] = React.useState<RoomView | null>(null);
  const [status, setStatus] = React.useState<"idle" | "connecting" | "open" | "lost">("idle");
  const [error, setError] = React.useState("");
  const wsRef = React.useRef<WebSocket | null>(null);
  const onCheckRef = React.useRef(onCheck);
  onCheckRef.current = onCheck;

  React.useEffect(() => {
    if (!code || !user) return;
    let closed = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setStatus("connecting");
      const ws = new WebSocket(roomSocketUrl(code));
      wsRef.current = ws;
      ws.onopen = () => {
        tries = 0;
        setStatus("open");
        const hello: ClientMsg = { t: "hello", userId: user.id, name: user.name };
        ws.send(JSON.stringify(hello));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMsg;
        if (msg.t === "state") setRoom(msg.room);
        else if (msg.t === "check") onCheckRef.current(msg.uris);
        else if (msg.t === "error") setError(msg.message);
      };
      ws.onclose = (e) => {
        if (wsRef.current === ws) wsRef.current = null;
        // 4000：同一個帳號在別處連進來，這邊不要搶回去
        if (closed || e.code === 4000) {
          if (e.code === 4000) setError("你在別的地方連進這個房間了");
          setStatus("lost");
          return;
        }
        if (tries++ < RETRIES) {
          setStatus("connecting");
          timer = setTimeout(connect, RETRY_MS);
        } else setStatus("lost");
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
      setRoom(null);
      setStatus("idle");
    };
  }, [code, user?.id]);

  const send = React.useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { room, status, error, setError, send };
}
