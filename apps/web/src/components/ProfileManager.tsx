import { useState } from "react";
import type { HandwritingProfile } from "@hw-layout/shared";

interface ProfileManagerProps {
  profiles: HandwritingProfile[];
  activeProfileId: string | null;
  onCreate: (name: string, description?: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSetActive: (id: string | null) => void;
  onImportSample: (profileId: string, file: File) => void;
  onOpenSegmenter: (profileId: string, sampleSetId: string) => void;
}

/**
 * 手写档案管理面板：新建 / 重命名 / 删除档案，导入样本图，展示统计。
 */
export function ProfileManager({
  profiles,
  activeProfileId,
  onCreate,
  onRename,
  onDelete,
  onSetActive,
  onImportSample,
  onOpenSegmenter,
}: ProfileManagerProps) {
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="hw-manager">
      <div className="hw-create">
        <input
          type="text"
          placeholder="新档案名称（如：我的笔迹）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              onCreate(newName);
              setNewName("");
            }
          }}
        />
        <button
          className="btn btn--primary"
          disabled={!newName.trim()}
          onClick={() => {
            onCreate(newName);
            setNewName("");
          }}
        >
          新建
        </button>
      </div>

      <p className="hint" style={{ margin: "8px 0 12px" }}>
        采集你本人的书写风格，用于笔记排版与模板美化。
      </p>

      {profiles.length === 0 && (
        <p className="hint">还没有手写档案，先新建一个吧。</p>
      )}

      <ul className="hw-list">
        {profiles.map((p) => {
          const isActive = p.id === activeProfileId;
          const isExpanded = p.id === expandedId;
          const coveredChars = new Set(p.glyphs.map((g) => g.char)).size;
          return (
            <li key={p.id} className={`hw-item ${isActive ? "is-active" : ""}`}>
              <div className="hw-item__head">
                <input
                  type="radio"
                  checked={isActive}
                  onChange={() => onSetActive(isActive ? null : p.id)}
                  title="设为当前活动档案"
                />
                {renamingId === p.id ? (
                  <input
                    type="text"
                    value={renameDraft}
                    autoFocus
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => {
                      if (renameDraft.trim()) onRename(p.id, renameDraft);
                      setRenamingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (renameDraft.trim()) onRename(p.id, renameDraft);
                        setRenamingId(null);
                      }
                    }}
                  />
                ) : (
                  <span
                    className="hw-item__name"
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  >
                    {p.name}
                  </span>
                )}
                <button
                  className="btn btn--xs"
                  title="重命名"
                  onClick={() => {
                    setRenamingId(p.id);
                    setRenameDraft(p.name);
                  }}
                >
                  ✎
                </button>
                <button
                  className="btn btn--xs"
                  title="删除"
                  onClick={() => setConfirmDelId(p.id)}
                >
                  🗑
                </button>
              </div>

              {isExpanded && (
                <div className="hw-item__body">
                  <div className="hw-stats">
                    <span>样本图：{p.sampleSets.length}</span>
                    <span>字形：{p.glyphs.length}</span>
                    <span>覆盖字符：{coveredChars}</span>
                  </div>

                  <label className="btn hw-import" style={{ display: "block", textAlign: "center" }}>
                    + 导入样本图
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onImportSample(p.id, f);
                        e.target.value = "";
                      }}
                    />
                  </label>

                  {p.sampleSets.map((s) => (
                    <div key={s.id} className="hw-sample">
                      <img src={s.imageBase64} alt={s.name} className="hw-sample__img" />
                      <div className="hw-sample__meta">
                        <div>{s.name}</div>
                        <div className="hint">
                          {s.sourceImageWidth}×{s.sourceImageHeight}
                        </div>
                      </div>
                      <button
                        className="btn btn--xs btn--primary"
                        onClick={() => onOpenSegmenter(p.id, s.id)}
                      >
                        切割字形
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {confirmDelId === p.id && (
                <div className="hw-confirm">
                  确认删除档案「{p.name}」？此操作不可撤销。
                  <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                    <button
                      className="btn btn--xs"
                      style={{ color: "#c00", borderColor: "#e8b4b4" }}
                      onClick={() => {
                        onDelete(p.id);
                        setConfirmDelId(null);
                      }}
                    >
                      确认删除
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
