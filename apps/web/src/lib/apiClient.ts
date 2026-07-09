/**
 * 后端 API 客户端。封装对 FastAPI 的调用。
 *
 * API base URL 配置优先级：
 *   1. window.__API_BASE__（Electron 主进程注入，见 apps/desktop/src/main.ts）
 *   2. localStorage 中的 "hw:apiBase"
 *   3. shared 中的 DEFAULT_API_BASE（http://127.0.0.1:8001）
 *
 * 用户可在 UI 上手动修改并保存到 localStorage。
 */
import {
  DEFAULT_API_BASE,
  type CleanRegionRequest,
  type CleanRegionResponse,
  type ExportRequest,
  type ExportResponse,
} from "@hw-layout/shared";

declare global {
  interface Window {
    __API_BASE__?: string;
  }
}

const LS_KEY = "hw:apiBase";

/** 读取当前 API base。 */
export function getApiBase(): string {
  if (typeof window !== "undefined" && window.__API_BASE__) {
    return window.__API_BASE__;
  }
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) return stored;
  }
  return DEFAULT_API_BASE;
}

/** 设置并持久化 API base。 */
export function setApiBase(url: string): void {
  const normalized = url.trim().replace(/\/+$/, "");
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LS_KEY, normalized);
  }
}

/** 带详细信息的 API 错误。 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** fetch 包装：带超时与统一错误处理。 */
async function request<T>(
  path: string,
  init: RequestInit,
  timeoutMs = 15000,
): Promise<T> {
  const base = getApiBase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(
        `${path} -> HTTP ${res.status}`,
        res.status,
        text,
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 后端连接状态。 */
export type ConnectionStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; version: string }
  | { kind: "disconnected" }
  | { kind: "error"; message: string };

/** 调用 /health 做连通性测试。 */
export async function checkHealth(): Promise<ConnectionStatus> {
  try {
    const data = await request<{ status: string; version: string }>(
      "/health",
      { method: "GET" },
      5000,
    );
    if (data.status === "ok") {
      return { kind: "connected", version: data.version };
    }
    return { kind: "error", message: `unexpected status: ${data.status}` };
  } catch (err) {
    if (err instanceof ApiError) {
      return { kind: "error", message: err.message };
    }
    // 网络错误 / 超时（AbortError）统一视为 disconnected
    return { kind: "disconnected" };
  }
}

export async function cleanRegion(
  req: CleanRegionRequest,
): Promise<CleanRegionResponse> {
  return request<CleanRegionResponse>("/clean-region", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function exportFile(
  req: ExportRequest,
): Promise<ExportResponse> {
  return request<ExportResponse>("/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}
