/**
 * 项目文件的序列化 / 反序列化（多页版）。
 *
 * 第五轮起项目结构为 pages[]。旧单页项目（有 backgroundImage/width/height/textObjects
 * 但无 pages）会自动迁移为 pages[0]。
 */
import { APP_VERSION } from "./version.js";
import {
  DEFAULT_NATURALNESS,
  type CanvasPage,
  type CanvasProject,
  type CleanHistoryEntry,
  type NaturalnessParams,
  type RectRegion,
  type TextObject,
  type TextStyle,
} from "./types.js";
import {
  DEFAULT_RENDER_SETTINGS,
  nowISO,
  type HandwritingProfile,
} from "./handwriting.js";

/** 项目 JSON 的最小可识别结构（用于校验输入）。 */
interface ProjectFileShape {
  appVersion?: unknown;
  id?: unknown;
  name?: unknown;
  pages?: unknown;
  activePageId?: unknown;
  settings?: unknown;
  handwritingProfiles?: unknown;
  activeHandwritingProfileId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  // 旧单页字段
  backgroundImage?: unknown;
  width?: unknown;
  height?: unknown;
  textObjects?: unknown;
  naturalnessEnabled?: unknown;
  naturalness?: unknown;
  cleanHistory?: unknown;
}

/** 校验 + 反序列化的结果。 */
export interface LoadResult {
  ok: boolean;
  project?: CanvasProject;
  error?: string;
}

/** 生成唯一 id（shared 层不依赖前端的 uid，用简单实现）。 */
function uid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 生成一个空白页。 */
export function createBlankPage(index: number, name?: string): CanvasPage {
  const now = nowISO();
  return {
    id: uid("page"),
    name: name ?? `第 ${index + 1} 页`,
    index,
    backgroundImage: null,
    originalWidth: 900,
    originalHeight: 600,
    textObjects: [],
    cleanHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 生成空项目（含一个空白首页）。 */
export function createEmptyProject(): CanvasProject {
  const now = nowISO();
  const firstPage = createBlankPage(0);
  return {
    appVersion: APP_VERSION,
    id: uid("project"),
    name: "未命名项目",
    pages: [firstPage],
    activePageId: firstPage.id,
    settings: {
      naturalnessEnabled: false,
      naturalness: { ...DEFAULT_NATURALNESS },
    },
    handwritingProfiles: [],
    activeHandwritingProfileId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** 把项目序列化为 JSON 字符串（剥离 deprecated 字段，仅存多页结构）。 */
export function serializeProject(project: CanvasProject): string {
  const clean: CanvasProject = {
    appVersion: APP_VERSION,
    id: project.id,
    name: project.name,
    pages: project.pages,
    activePageId: project.activePageId,
    settings: project.settings,
    handwritingProfiles: project.handwritingProfiles,
    activeHandwritingProfileId: project.activeHandwritingProfileId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  return JSON.stringify(clean, null, 2);
}

/** 从 JSON 字符串解析并校验项目，返回规范化后的 CanvasProject。 */
export function deserializeProject(raw: string): LoadResult {
  let data: ProjectFileShape;
  try {
    data = JSON.parse(raw) as ProjectFileShape;
  } catch {
    return { ok: false, error: "JSON 解析失败，文件不是有效的项目格式" };
  }
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "项目根结构不是对象" };
  }

  // 判断是新结构（有 pages）还是旧单页结构
  const hasPages = Array.isArray(data.pages) && data.pages.length > 0;
  const hasLegacySingle =
    !hasPages &&
    (typeof data.width === "number" || typeof data.height === "number");

  if (!hasPages && !hasLegacySingle) {
    return { ok: false, error: "缺少 pages 或 width/height 字段" };
  }

  const now = nowISO();
  let pages: CanvasPage[];

  if (hasPages) {
    pages = normalizePages(data.pages as unknown[]);
  } else {
    // 旧单页迁移为 pages[0]
    pages = [
      migrateLegacyPage(data, 0),
    ];
  }

  // 确保 activePageId 有效
  let activePageId: string | null =
    typeof data.activePageId === "string" ? (data.activePageId as string) : null;
  if (!activePageId || !pages.some((p) => p.id === activePageId)) {
    activePageId = pages[0]?.id ?? null;
  }

  const project: CanvasProject = {
    appVersion: typeof data.appVersion === "string" ? data.appVersion : APP_VERSION,
    id: typeof data.id === "string" ? data.id : uid("project"),
    name: typeof data.name === "string" ? data.name : "未命名项目",
    pages,
    activePageId,
    settings: normalizeSettings(data.settings, data),
    handwritingProfiles: Array.isArray(data.handwritingProfiles)
      ? normalizeProfiles(data.handwritingProfiles)
      : [],
    activeHandwritingProfileId:
      typeof data.activeHandwritingProfileId === "string"
        ? (data.activeHandwritingProfileId as string)
        : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now,
  };

  return { ok: true, project };
}

/** 规范化 pages 数组。 */
function normalizePages(raw: unknown[]): CanvasPage[] {
  return raw
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p, idx) => normalizePage(p, idx));
}

function normalizePage(p: Record<string, unknown>, idx: number): CanvasPage {
  const now = nowISO();
  const hasBg = typeof p.backgroundImage === "string";
  return {
    id: typeof p.id === "string" ? p.id : uid("page"),
    name: typeof p.name === "string" ? p.name : `第 ${idx + 1} 页`,
    index: typeof p.index === "number" ? p.index : idx,
    backgroundImage: hasBg ? (p.backgroundImage as string) : null,
    originalWidth:
      typeof p.originalWidth === "number"
        ? p.originalWidth
        : typeof p.width === "number"
          ? p.width
          : 900,
    originalHeight:
      typeof p.originalHeight === "number"
        ? p.originalHeight
        : typeof p.height === "number"
          ? p.height
          : 600,
    textObjects: normalizeTextObjects(p.textObjects),
    cleanHistory: Array.isArray(p.cleanHistory)
      ? (p.cleanHistory as CleanHistoryEntry[])
      : [],
    createdAt: typeof p.createdAt === "string" ? p.createdAt : now,
    updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : now,
  };
}

/** 旧单页项目迁移为一个 CanvasPage。 */
function migrateLegacyPage(data: ProjectFileShape, idx: number): CanvasPage {
  const now = nowISO();
  return {
    id: uid("page"),
    name: `第 ${idx + 1} 页`,
    index: idx,
    backgroundImage:
      typeof data.backgroundImage === "string" ? data.backgroundImage : null,
    originalWidth: typeof data.width === "number" ? data.width : 900,
    originalHeight: typeof data.height === "number" ? data.height : 600,
    textObjects: normalizeTextObjects(data.textObjects),
    cleanHistory: Array.isArray(data.cleanHistory)
      ? (data.cleanHistory as CleanHistoryEntry[])
      : [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 规范化项目设置（兼容旧 naturalnessEnabled/naturalness 顶层字段）。 */
function normalizeSettings(
  settingsRaw: unknown,
  data: ProjectFileShape,
): CanvasProject["settings"] {
  if (typeof settingsRaw === "object" && settingsRaw !== null) {
    const s = settingsRaw as Record<string, unknown>;
    return {
      naturalnessEnabled: s.naturalnessEnabled === true,
      naturalness: normalizeNaturalness(s.naturalness),
    };
  }
  // 旧项目：从顶层字段读
  return {
    naturalnessEnabled: data.naturalnessEnabled === true,
    naturalness: normalizeNaturalness(data.naturalness),
  };
}

function normalizeTextObjects(raw: unknown): TextObject[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
    .map((o, idx) => {
      const styleRaw = (o.style ?? {}) as Record<string, unknown>;
      const style: TextStyle = {
        fontFamily: strOr(styleRaw.fontFamily, "sans-serif"),
        fontSize: numOr(styleRaw.fontSize, 24),
        fontWeight: styleRaw.fontWeight === "bold" ? "bold" : "normal",
        fontStyle: styleRaw.fontStyle === "italic" ? "italic" : "normal",
        align: alignOf(styleRaw.align),
        letterSpacing: numOr(styleRaw.letterSpacing, 0),
        lineHeight: numOr(styleRaw.lineHeight, 1.4),
        color: strOr(styleRaw.color, "#1a1a1a"),
        opacity: numOr(styleRaw.opacity, 1),
        rotation: numOr(styleRaw.rotation, 0),
        blur: numOr(styleRaw.blur, 0),
      };
      return {
        id: strOr(o.id, `obj-${idx}-${Math.random().toString(36).slice(2, 8)}`),
        text: strOr(o.text, ""),
        x: numOr(o.x, 0),
        y: numOr(o.y, 0),
        style,
        zIndex: numOr(o.zIndex, idx),
        naturalnessSeed:
          typeof o.naturalnessSeed === "number"
            ? (o.naturalnessSeed as number)
            : Math.floor(Math.random() * 0xffffffff),
        renderMode: o.renderMode === "handwritingGlyph" ? "handwritingGlyph" : "font",
        handwritingProfileId:
          typeof o.handwritingProfileId === "string"
            ? (o.handwritingProfileId as string)
            : null,
      } satisfies TextObject;
    });
}

function normalizeNaturalness(raw: unknown): NaturalnessParams {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_NATURALNESS };
  }
  const r = raw as Record<string, unknown>;
  return {
    positionJitter: numOr(r.positionJitter, DEFAULT_NATURALNESS.positionJitter),
    rotationJitter: numOr(r.rotationJitter, DEFAULT_NATURALNESS.rotationJitter),
    opacityJitter: numOr(r.opacityJitter, DEFAULT_NATURALNESS.opacityJitter),
    fontSizeJitter: numOr(r.fontSizeJitter, DEFAULT_NATURALNESS.fontSizeJitter),
    baselineJitter: numOr(r.baselineJitter, DEFAULT_NATURALNESS.baselineJitter),
  };
}

/** 规范化手写档案列表（容错）。 */
function normalizeProfiles(raw: unknown[]): HandwritingProfile[] {
  return raw
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => normalizeProfile(p));
}

function normalizeProfile(p: Record<string, unknown>): HandwritingProfile {
  return {
    id: strOr(p.id, `profile-${Math.random().toString(36).slice(2, 8)}`),
    name: strOr(p.name, "未命名档案"),
    createdAt: strOr(p.createdAt, nowISO()),
    updatedAt: strOr(p.updatedAt, nowISO()),
    description: typeof p.description === "string" ? p.description : undefined,
    sampleSets: Array.isArray(p.sampleSets) ? (p.sampleSets as HandwritingProfile["sampleSets"]) : [],
    glyphs: Array.isArray(p.glyphs) ? (p.glyphs as HandwritingProfile["glyphs"]) : [],
    defaultRenderSettings: normalizeRenderSettings(
      (p.defaultRenderSettings ?? {}) as Record<string, unknown>,
    ),
  };
}

function normalizeRenderSettings(
  r: Record<string, unknown>,
): HandwritingProfile["defaultRenderSettings"] {
  const mode = r.preferredVariantMode;
  return {
    preferredVariantMode:
      mode === "first" || mode === "weighted" ? mode : "random",
    scale: numOr(r.scale, DEFAULT_RENDER_SETTINGS.scale),
    baselineJitter: numOr(r.baselineJitter, DEFAULT_RENDER_SETTINGS.baselineJitter),
    rotationJitter: numOr(r.rotationJitter, DEFAULT_RENDER_SETTINGS.rotationJitter),
    opacityJitter: numOr(r.opacityJitter, DEFAULT_RENDER_SETTINGS.opacityJitter),
    spacingJitter: numOr(r.spacingJitter, DEFAULT_RENDER_SETTINGS.spacingJitter),
  };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function alignOf(v: unknown): TextStyle["align"] {
  return v === "center" || v === "right" ? v : "left";
}

/** 类型断言：满足 RectRegion 形状。 */
export function isRectRegion(v: unknown): v is RectRegion {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.width === "number" &&
    typeof r.height === "number"
  );
}

// 重新导出 DEFAULT_SETTINGS 供外部使用
export { DEFAULT_SETTINGS } from "./types.js";
