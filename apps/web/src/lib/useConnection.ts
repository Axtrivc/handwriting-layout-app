/**
 * 后端连接状态 Hook：定时探测 /health。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkHealth,
  getApiBase,
  setApiBase,
  type ConnectionStatus,
} from "./apiClient.js";

const POLL_MS = 10000;

export function useConnection() {
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "idle" });
  const [apiBase, setApiBaseState] = useState<string>(() => getApiBase());
  const timerRef = useRef<number | null>(null);

  const probe = useCallback(async () => {
    setStatus({ kind: "connecting" });
    setStatus(await checkHealth());
  }, []);

  // 立即探测一次
  useEffect(() => {
    void probe();
  }, [probe]);

  // 定时轮询
  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      void probe();
    }, POLL_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [probe]);

  const updateApiBase = useCallback(
    (url: string) => {
      setApiBase(url);
      setApiBaseState(getApiBase());
      void probe();
    },
    [probe],
  );

  const reconnect = useCallback(() => {
    void probe();
  }, [probe]);

  return { status, apiBase, updateApiBase, reconnect };
}
