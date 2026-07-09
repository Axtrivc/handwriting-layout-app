/**
 * 后端 API 客户端。封装对 FastAPI 的调用。
 *
 * 后端默认地址可由 (window as any).__API_BASE__ 注入（Electron 主进程），
 * 否则使用 shared 中的默认值。
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

function base(): string {
  if (typeof window !== "undefined" && window.__API_BASE__) {
    return window.__API_BASE__;
  }
  return DEFAULT_API_BASE;
}

export async function health(): Promise<{ status: string }> {
  const res = await fetch(`${base()}/health`);
  if (!res.ok) throw new Error(`health failed: ${res.status}`);
  return (await res.json()) as { status: string };
}

export async function cleanRegion(
  req: CleanRegionRequest,
): Promise<CleanRegionResponse> {
  const res = await fetch(`${base()}/clean-region`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`clean-region failed: ${res.status} ${text}`);
  }
  return (await res.json()) as CleanRegionResponse;
}

export async function exportFile(
  req: ExportRequest,
): Promise<ExportResponse> {
  const res = await fetch(`${base()}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`export failed: ${res.status} ${text}`);
  }
  return (await res.json()) as ExportResponse;
}
