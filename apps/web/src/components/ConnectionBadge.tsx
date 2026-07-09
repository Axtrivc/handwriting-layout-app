import { useState } from "react";
import type { ConnectionStatus } from "../lib/apiClient.js";

interface ConnectionBadgeProps {
  status: ConnectionStatus;
  apiBase: string;
  onReconnect: () => void;
  onApiBaseChange: (url: string) => void;
}

/**
 * 后端连接状态徽章：显示 connected / disconnected / error，
 * 并支持手动修改 API base 与重连。
 */
export function ConnectionBadge({
  status,
  apiBase,
  onReconnect,
  onApiBaseChange,
}: ConnectionBadgeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(apiBase);

  const { label } = describe(status);

  return (
    <div className="conn">
      <span className={`conn__dot conn__dot--${status.kind}`} />
      <span className="conn__label" title={apiBase}>
        {label}
      </span>
      {status.kind === "connected" && "version" in status && (
        <span className="conn__version">v{status.version}</span>
      )}
      <button
        className="btn btn--xs"
        onClick={onReconnect}
        title="重新检测连接"
      >
        ↻
      </button>
      <button
        className="btn btn--xs"
        onClick={() => {
          setDraft(apiBase);
          setEditing((v) => !v);
        }}
        title="修改后端地址"
      >
        ⚙
      </button>
      {editing && (
        <span className="conn__edit">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="http://127.0.0.1:8001"
          />
          <button
            className="btn btn--xs btn--primary"
            onClick={() => {
              onApiBaseChange(draft);
              setEditing(false);
            }}
          >
            保存
          </button>
        </span>
      )}
      {status.kind === "error" && (
        <span className="conn__err" title={status.message}>
          ⚠ {status.message}
        </span>
      )}
    </div>
  );
}

function describe(status: ConnectionStatus): { label: string } {
  switch (status.kind) {
    case "idle":
      return { label: "未检测" };
    case "connecting":
      return { label: "连接中…" };
    case "connected":
      return { label: "已连接" };
    case "disconnected":
      return { label: "未连接" };
    case "error":
      return { label: "错误" };
  }
}
