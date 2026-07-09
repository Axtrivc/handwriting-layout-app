/**
 * 画布对象与文本样式的共享类型定义。
 * 被 apps/web 与 apps/desktop 复用。
 */

import type { HandwritingProfile, TextRenderMode } from "./handwriting.js";

/** 字体粗细 */
export type FontWeight = "normal" | "bold";
/** 字体风格（倾斜） */
export type FontStyle = "normal" | "italic";
/** 对齐方式 */
export type TextAlign = "left" | "center" | "right";

/** 单个文本对象的样式参数 */
export interface TextStyle {
  /** 字体族 */
  fontFamily: string;
  /** 字号 (px) */
  fontSize: number;
  /** 字体粗细 */
  fontWeight: FontWeight;
  /** 字体风格（倾斜） */
  fontStyle: FontStyle;
  /** 对齐方式 */
  align: TextAlign;
  /** 字距 (px)，正数展开、负数收紧 */
  letterSpacing: number;
  /** 行高倍数，1.0 为单倍行距 */
  lineHeight: number;
  /** 文字颜色，#RRGGBB */
  color: string;
  /** 透明度 0~1 */
  opacity: number;
  /** 旋转角度 (deg)，轻微旋转范围内使用 */
  rotation: number;
  /**
   * 轻微高斯模糊半径 (px)。0 为不模糊。
   * 用于模拟手写墨迹边缘的柔和感，温和范围 0~1.5。
   * TODO: 混合模式（multiply 等）后续阶段实现。
   */
  blur: number;
}

/** 画布上的文本对象 */
export interface TextObject {
  id: string;
  /** 文本内容（多行用 \n） */
  text: string;
  /** 中心点 x 坐标 (px) */
  x: number;
  /** 中心点 y 坐标 (px) */
  y: number;
  /** 样式 */
  style: TextStyle;
  /**
   * 层级，数值越大越在上层。
   * 渲染时按 zIndex 升序排列。
   */
  zIndex: number;
  /**
   * 该对象的自然化随机种子。
   * 保证同一项目重复导出时该对象的抖动一致。
   */
  naturalnessSeed: number;
  /**
   * 渲染模式：
   * - font：用系统字体渲染
   * - handwritingGlyph：优先用当前 profile 中该字符的 glyph 图片渲染，缺字 fallback 到字体
   */
  renderMode: TextRenderMode;
  /**
   * 当 renderMode 为 handwritingGlyph 时，指定使用的手写档案 id。
   * 为 null 表示用项目 activeHandwritingProfileId。
   */
  handwritingProfileId: string | null;
}

/** 手写自然化的温和参数（位置抖动、旋转抖动、透明度变化、字号波动、基线浮动）。 */
export interface NaturalnessParams {
  /** 位置抖动幅度 (px)，温和范围 0~3 */
  positionJitter: number;
  /** 旋转抖动幅度 (deg)，温和范围 0~2 */
  rotationJitter: number;
  /** 透明度抖动幅度 0~0.1 */
  opacityJitter: number;
  /** 字号波动幅度 (px)，温和范围 0~2 */
  fontSizeJitter: number;
  /** 基线浮动幅度 (px)，温和范围 0~2 */
  baselineJitter: number;
}

/** 默认自然化参数（温和） */
export const DEFAULT_NATURALNESS: NaturalnessParams = {
  positionJitter: 2,
  rotationJitter: 1.5,
  opacityJitter: 0.05,
  fontSizeJitter: 1,
  baselineJitter: 1,
};

/** 默认文本样式 */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "cursive, 'Comic Sans MS', 'PingFang SC', sans-serif",
  fontSize: 28,
  fontWeight: "normal",
  fontStyle: "normal",
  align: "left",
  letterSpacing: 0,
  lineHeight: 1.4,
  color: "#1a1a1a",
  opacity: 1,
  rotation: 0,
  blur: 0,
};

/** 一次清除操作的历史记录（用于撤销） */
export interface CleanHistoryEntry {
  /** 清除前的背景图 dataURL */
  beforeImage: string;
  /** 清除后（当前）的背景图 dataURL */
  afterImage: string;
  /** 涉及的区域 */
  regions: RectRegion[];
}

/** 矩形区域 */
export interface RectRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 单页画布数据。第五轮引入多页工程。 */
export interface CanvasPage {
  id: string;
  /** 页面名称（如「第 1 页」） */
  name: string;
  /** 页面序号（从 0 开始，用于排序显示） */
  index: number;
  /** 背景图 dataURL 或 URL */
  backgroundImage: string | null;
  /** 原图宽度（px） */
  originalWidth: number;
  /** 原图高度（px） */
  originalHeight: number;
  /** 该页的文本对象列表 */
  textObjects: TextObject[];
  /** 该页的清除操作历史（栈顶为最近一次），用于撤销 */
  cleanHistory: CleanHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

/** 项目级设置 */
export interface ProjectSettings {
  /** 是否启用手写自然化（全局） */
  naturalnessEnabled: boolean;
  /** 自然化参数（全局） */
  naturalness: NaturalnessParams;
}

/** 默认项目设置 */
export const DEFAULT_SETTINGS: ProjectSettings = {
  naturalnessEnabled: false,
  naturalness: { ...DEFAULT_NATURALNESS },
};

/**
 * 画布工程数据（项目文件格式）。
 *
 * 第五轮起采用多页结构：pages 数组 + activePageId。
 * 旧单页项目的 backgroundImage/width/height/textObjects/cleanHistory 字段
 * 在反序列化时自动迁移为 pages[0]，运行时以 pages 为准。
 */
export interface CanvasProject {
  /** 应用版本，用于后续迁移 */
  appVersion: string;
  /** 项目 id */
  id: string;
  /** 项目名称 */
  name: string;
  /** 页面列表 */
  pages: CanvasPage[];
  /** 当前激活页面 id */
  activePageId: string | null;
  /** 项目级设置 */
  settings: ProjectSettings;
  /** 手写档案列表（project 级共享，跨页使用） */
  handwritingProfiles: HandwritingProfile[];
  /** 当前激活的手写档案 id（可为 null） */
  activeHandwritingProfileId: string | null;
  createdAt: string;
  updatedAt: string;

  // ---- 以下为旧单页字段，仅用于读取旧项目，运行时不再使用 ----
  /** @deprecated 第五轮起改用 pages[activePage].backgroundImage */
  backgroundImage?: string | null;
  /** @deprecated 第五轮起改用 pages[activePage].originalWidth */
  width?: number;
  /** @deprecated 第五轮起改用 pages[activePage].originalHeight */
  height?: number;
  /** @deprecated 第五轮起改用 pages[activePage].textObjects */
  textObjects?: TextObject[];
  /** @deprecated 第五轮起改用 pages[activePage].cleanHistory */
  cleanHistory?: CleanHistoryEntry[];
  /** @deprecated 第五轮起改用 settings.naturalnessEnabled */
  naturalnessEnabled?: boolean;
  /** @deprecated 第五轮起改用 settings.naturalness */
  naturalness?: NaturalnessParams;
}
