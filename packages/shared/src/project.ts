/**
 * 项目文件的序列化 / 反序列化。
 *
 * 项目以本地 JSON 文件保存，不需要数据库。
 * 加载后会做基本校验与版本兼容处理。
 */
import { APP_VERSION } from "./version.js";
import {
  DEFAULT_NATURALNESS,
  type CanvasProject,
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
  backgroundImage?: unknown;
  width?: unknown;
  height?: unknown;
  textObjects?: unknown;
  naturalnessEnabled?: unknown;
  naturalness?: unknown;
  cleanHistory?: unknown;
  handwritingProfiles?: unknown;
  activeHandwritingProfileId?: unknown;
}

/** 校验 + 反序列化的结果。 */
export interface LoadResult {
  ok: boolean;
  project?: CanvasProject;
  error?: string;
}

/** 生成空项目（内存初始态）。 */
export function createEmptyProject(): CanvasProject {
  return {
    appVersion: APP_VERSION,
    backgroundImage: null,
    width: 900,
    height: 600,
    textObjects: [],
    naturalnessEnabled: false,
    naturalness: { ...DEFAULT_NATURALNESS },
    cleanHistory: [],
    handwritingProfiles: [],
    activeHandwritingProfileId: null,
  };
}

/** 把项目序列化为 JSON 字符串（供下载 / 复制）。 */
export function serializeProject(project: CanvasProject): string {
  return JSON.stringify(
    { ...project, appVersion: APP_VERSION },
    null,
    2,
  );
}

/** 从 JSON 字符串解析并校验项目，返回规范化后的 CanvasProject。 */
export function deserializeProject(raw: string): LoadResult {
  let data: ProjectFileShape;
  try {
    data = JSON.parse(raw) as ProjectFileShape;
  } catch {
    return { ok: false, error: "JSON 解析失败，文件不是有效的项目格式" };
  }

  if (
    typeof data !== "object" ||
    data === null ||
    typeof data.width !== "number" ||
    typeof data.height !== "number"
  ) {
    return { ok: false, error: "缺少必要的 width / height 字段" };
  }

  const project: CanvasProject = {
    appVersion: typeof data.appVersion === "string" ? data.appVersion : APP_VERSION,
    backgroundImage:
      typeof data.backgroundImage === "string" ? data.backgroundImage : null,
    width: data.width,
    height: data.height,
    textObjects: normalizeTextObjects(data.textObjects),
    naturalnessEnabled: data.naturalnessEnabled === true,
    naturalness: normalizeNaturalness(data.naturalness),
    cleanHistory: Array.isArray(data.cleanHistory)
      ? (data.cleanHistory as CanvasProject["cleanHistory"])
      : [],
    // 第三轮新增字段，旧项目兼容
    handwritingProfiles: Array.isArray(data.handwritingProfiles)
      ? normalizeProfiles(data.handwritingProfiles)
      : [],
    activeHandwritingProfileId:
      typeof data.activeHandwritingProfileId === "string"
        ? (data.activeHandwritingProfileId as string)
        : null,
  };

  return { ok: true, project };
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
        // 第三轮新增字段，旧项目兼容：默认 font 模式
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
