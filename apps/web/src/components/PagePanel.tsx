import { useState } from "react";
import type { CanvasPage } from "@hw-layout/shared";

interface PagePanelProps {
  pages: CanvasPage[];
  activePageId: string | null;
  onAddPage: () => void;
  onDeletePage: (id: string) => void;
  onDuplicatePage: (id: string) => void;
  onRenamePage: (id: string, name: string) => void;
  onMovePage: (id: string, direction: -1 | 1) => void;
  onSetActivePage: (id: string) => void;
  onImportImages: (files: File[]) => void;
}

/**
 * 多页管理面板：新建/删除(确认)/复制/重命名/上移下移/切换/缩略图/页码。
 */
export function PagePanel({
  pages,
  activePageId,
  onAddPage,
  onDeletePage,
  onDuplicatePage,
  onRenamePage,
  onMovePage,
  onSetActivePage,
  onImportImages,
}: PagePanelProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const activeIdx = pages.findIndex((p) => p.id === activePageId);

  return (
    <div className="page-panel">
      <div className="page-panel__head">
        <span>
          页面 {activeIdx >= 0 ? activeIdx + 1 : 0}/{pages.length}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="btn btn--xs" onClick={onAddPage} title="新建空白页">
            + 新页
          </button>
          <button
            className="btn btn--xs"
            onClick={() => setImportOpen((v) => !v)}
            title="导入多张图片自动建页"
          >
            📥 多图
          </button>
        </div>
      </div>

      {importOpen && (
        <label className="btn btn--xs" style={{ display: "block", textAlign: "center", marginBottom: 6 }}>
          选择多张图片（按文件名排序建页）
          <input
            type="file"
            accept="image/png,image/jpeg"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onImportImages(files);
              e.target.value = "";
              setImportOpen(false);
            }}
          />
        </label>
      )}

      <ul className="page-list">
        {pages.map((p, idx) => {
          const isActive = p.id === activePageId;
          return (
            <li
              key={p.id}
              className={`page-item ${isActive ? "is-active" : ""}`}
              onClick={() => onSetActivePage(p.id)}
            >
              <div className="page-item__thumb">
                {p.backgroundImage ? (
                  <img src={p.backgroundImage} alt={p.name} />
                ) : (
                  <span className="hint">空白</span>
                )}
              </div>
              <div className="page-item__meta">
                {renamingId === p.id ? (
                  <input
                    type="text"
                    value={renameDraft}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => {
                      if (renameDraft.trim()) onRenamePage(p.id, renameDraft);
                      setRenamingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (renameDraft.trim()) onRenamePage(p.id, renameDraft);
                        setRenamingId(null);
                      }
                    }}
                  />
                ) : (
                  <span
                    className="page-item__name"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(p.id);
                      setRenameDraft(p.name);
                    }}
                    title="点击重命名"
                  >
                    {idx + 1}. {p.name}
                  </span>
                )}
                <span className="hint">
                  {p.originalWidth}×{p.originalHeight} · {p.textObjects.length} 字
                </span>
              </div>
              <div className="page-item__ops">
                <button
                  className="btn btn--xs"
                  title="上移"
                  disabled={idx === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMovePage(p.id, -1);
                  }}
                >
                  ↑
                </button>
                <button
                  className="btn btn--xs"
                  title="下移"
                  disabled={idx === pages.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMovePage(p.id, 1);
                  }}
                >
                  ↓
                </button>
                <button
                  className="btn btn--xs"
                  title="复制此页"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicatePage(p.id);
                  }}
                >
                  ⧉
                </button>
                <button
                  className="btn btn--xs"
                  title="删除"
                  disabled={pages.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelId(p.id);
                  }}
                >
                  🗑
                </button>
              </div>
              {confirmDelId === p.id && (
                <div className="page-confirm" onClick={(e) => e.stopPropagation()}>
                  确认删除「{p.name}」？
                  <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                    <button
                      className="btn btn--xs"
                      style={{ color: "#c00", borderColor: "#e8b4b4" }}
                      onClick={() => {
                        onDeletePage(p.id);
                        setConfirmDelId(null);
                      }}
                    >
                      删除
                    </button>
                    <button className="btn btn--xs" onClick={() => setConfirmDelId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
