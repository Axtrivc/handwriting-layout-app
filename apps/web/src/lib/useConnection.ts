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
  const probeGeneration = useRef(0);

  const probe = useCallback(async () => {
    const generation = ++probeGeneration.current;
    setStatus({ kind: "connecting" });
    const result = await checkHealth();
    if (generation === probeGeneration.current) setStatus(result);
  }, []);

  const invalidateProbes = useCallback(() => { probeGeneration.current++; }, []);

  // 立即探测一次，并忽略卸载或后续探测之前返回的旧结果。
  useEffect(() => {
    void probe();
    return invalidateProbes;
  }, [probe, invalidateProbes]);

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
      try {
        setApiBase(url);
        setApiBaseState(getApiBase());
        void probe();
        return true;
      } catch (error) {
        setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        return false;
      }
    },
    [probe],
  );

  const reconnect = useCallback(() => {
    void probe();
  }, [probe]);

  return { status, apiBase, updateApiBase, reconnect };
}
