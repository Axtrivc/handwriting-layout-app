/**
 * 手写档案与字形的状态管理 Hook。
 *
 * 操作项目内的 handwritingProfiles 数组，提供档案/样本集/字形的 CRUD。
 * 字形裁剪调用后端 /segment-glyph。
 */
import { useCallback, useMemo } from "react";
import {
  DEFAULT_RENDER_SETTINGS,
  nowISO,
  type GlyphBoundingBox,
  type HandwritingGlyph,
  type HandwritingProfile,
  type HandwritingSampleSet,
} from "@hw-layout/shared";
import { ApiError, segmentGlyph } from "./apiClient.js";
import { splitDataURL, uid } from "./image.js";

export interface UseHandwritingResult {
  profiles: HandwritingProfile[];
  activeProfile: HandwritingProfile | null;
  /** 新建档案，返回新 id */
  createProfile: (name: string, description?: string) => string;
  renameProfile: (id: string, name: string) => void;
  deleteProfile: (id: string) => void;
  setActiveProfile: (id: string | null) => void;
  /** 导入样本图（dataURL），返回新 sampleSet id */
  importSample: (
    profileId: string,
    name: string,
    dataURL: string,
    width: number,
    height: number,
  ) => string;
  /** 切割并保存一个字形，返回新 glyph 或错误信息 */
  saveGlyph: (
    profileId: string,
    sampleSetId: string,
    char: string,
    bbox: GlyphBoundingBox,
    sampleDataURL: string,
  ) => Promise<{ ok: true; glyph: HandwritingGlyph } | { ok: false; error: string }>;
  deleteGlyph: (profileId: string, glyphId: string) => void;
  /** 按字符搜索 glyph（返回该 profile 下匹配的 glyph） */
  searchGlyphs: (profileId: string, query: string) => HandwritingGlyph[];
  /** 获取某 profile 下某字符的所有变体 */
  variantsOf: (profileId: string, char: string) => HandwritingGlyph[];
}

interface UseHandwritingArgs {
  profiles: HandwritingProfile[];
  activeProfileId: string | null;
  onProfilesChange: (profiles: HandwritingProfile[]) => void;
  onActiveChange: (id: string | null) => void;
}

export function useHandwriting({
  profiles,
  activeProfileId,
  onProfilesChange,
  onActiveChange,
}: UseHandwritingArgs): UseHandwritingResult {
  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  const mutate = useCallback(
    (fn: (list: HandwritingProfile[]) => HandwritingProfile[]) => {
      onProfilesChange(fn(profiles));
    },
    [profiles, onProfilesChange],
  );

  const touch = (p: HandwritingProfile): HandwritingProfile => ({
    ...p,
    updatedAt: nowISO(),
  });

  const createProfile = useCallback(
    (name: string, description?: string): string => {
      const id = uid();
      const now = nowISO();
      const profile: HandwritingProfile = {
        id,
        name: name.trim() || "未命名档案",
        createdAt: now,
        updatedAt: now,
        description,
        sampleSets: [],
        glyphs: [],
        defaultRenderSettings: { ...DEFAULT_RENDER_SETTINGS },
      };
      mutate((list) => [...list, profile]);
      onActiveChange(id);
      return id;
    },
    [mutate, onActiveChange],
  );

  const renameProfile = useCallback(
    (id: string, name: string) => {
      mutate((list) =>
        list.map((p) => (p.id === id ? touch({ ...p, name: name.trim() || p.name }) : p)),
      );
    },
    [mutate],
  );

  const deleteProfile = useCallback(
    (id: string) => {
      mutate((list) => list.filter((p) => p.id !== id));
      if (activeProfileId === id) onActiveChange(null);
    },
    [mutate, activeProfileId, onActiveChange],
  );

  const setActiveProfile = useCallback(
    (id: string | null) => onActiveChange(id),
    [onActiveChange],
  );

  const importSample = useCallback(
    (
      profileId: string,
      name: string,
      dataURL: string,
      width: number,
      height: number,
    ): string => {
      const id = uid();
      const sample: HandwritingSampleSet = {
        id,
        profileId,
        name: name.trim() || "样本图",
        imageBase64: dataURL,
        sourceImageWidth: width,
        sourceImageHeight: height,
        createdAt: nowISO(),
        status: "imported",
      };
      mutate((list) =>
        list.map((p) =>
          p.id === profileId
            ? touch({ ...p, sampleSets: [...p.sampleSets, sample] })
            : p,
        ),
      );
      return id;
    },
    [mutate],
  );

  const saveGlyph = useCallback(
    async (
      profileId: string,
      sampleSetId: string,
      char: string,
      bbox: GlyphBoundingBox,
      sampleDataURL: string,
    ): Promise<
      { ok: true; glyph: HandwritingGlyph } | { ok: false; error: string }
    > => {
      const c = char.trim();
      if (!c) return { ok: false, error: "请输入对应字符" };
      try {
        const { data, mime } = splitDataURL(sampleDataURL);
        const resp = await segmentGlyph({
          image: data,
          mime,
          bbox,
          outMime: "image/png",
          transparent: true,
        });
        const glyphDataURL = `data:${resp.mime};base64,${resp.image}`;
        // 计算该字符已有的 variantIndex
        let variantIndex = 0;
        for (const p of profiles) {
          if (p.id === profileId) {
            variantIndex = p.glyphs.filter((g) => g.char === c).length;
            break;
          }
        }
        const glyph: HandwritingGlyph = {
          id: uid(),
          profileId,
          char: c,
          imageBase64: glyphDataURL,
          bbox,
          sourceSampleSetId: sampleSetId,
          variantIndex,
          createdAt: nowISO(),
        };
        mutate((list) =>
          list.map((p) =>
            p.id === profileId
              ? touch({ ...p, glyphs: [...p.glyphs, glyph] })
              : p,
          ),
        );
        return { ok: true, glyph };
      } catch (err) {
        return { ok: false, error: describeError(err) };
      }
    },
    [mutate, profiles],
  );

  const deleteGlyph = useCallback(
    (profileId: string, glyphId: string) => {
      mutate((list) =>
        list.map((p) =>
          p.id === profileId
            ? touch({ ...p, glyphs: p.glyphs.filter((g) => g.id !== glyphId) })
            : p,
        ),
      );
    },
    [mutate],
  );

  const searchGlyphs = useCallback(
    (profileId: string, query: string): HandwritingGlyph[] => {
      const p = profiles.find((x) => x.id === profileId);
      if (!p) return [];
      const q = query.trim();
      if (!q) return p.glyphs;
      return p.glyphs.filter((g) => g.char.includes(q));
    },
    [profiles],
  );

  const variantsOf = useCallback(
    (profileId: string, char: string): HandwritingGlyph[] => {
      const p = profiles.find((x) => x.id === profileId);
      if (!p) return [];
      return p.glyphs.filter((g) => g.char === char);
    },
    [profiles],
  );

  return {
    profiles,
    activeProfile,
    createProfile,
    renameProfile,
    deleteProfile,
    setActiveProfile,
    importSample,
    saveGlyph,
    deleteGlyph,
    searchGlyphs,
    variantsOf,
  };
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    let detail = err.body;
    try {
      const j = JSON.parse(err.body);
      if (j?.detail)
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* keep raw */
    }
    return `HTTP ${err.status}: ${detail || err.message}`;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") return "请求超时，请检查后端是否运行";
    return err.message;
  }
  return String(err);
}
