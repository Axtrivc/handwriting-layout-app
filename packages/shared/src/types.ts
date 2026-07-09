/**
 * 画布对象与文本样式的共享类型定义。
 * 被 apps/web 与 apps/desktop 复用。
 */

/** 单个文本对象的样式参数 */
export interface TextStyle {
  /** 字号 (px) */
  fontSize: number;
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
}

/** 手写自然化的温和参数（位置抖动、旋转抖动、透明度变化） */
export interface NaturalnessParams {
  /** 位置抖动幅度 (px)，温和范围 0~3 */
  positionJitter: number;
  /** 旋转抖动幅度 (deg)，温和范围 0~2 */
  rotationJitter: number;
  /** 透明度抖动幅度 0~0.1 */
  opacityJitter: number;
}

/** 默认自然化参数（温和） */
export const DEFAULT_NATURALNESS: NaturalnessParams = {
  positionJitter: 2,
  rotationJitter: 1.5,
  opacityJitter: 0.05,
};

/** 默认文本样式 */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 28,
  letterSpacing: 0,
  lineHeight: 1.4,
  color: "#1a1a1a",
  opacity: 1,
  rotation: 0,
};

/** 画布工程数据 */
export interface CanvasProject {
  /** 背景图 dataURL 或 URL */
  backgroundImage: string | null;
  /** 画布宽度 */
  width: number;
  /** 画布高度 */
  height: number;
  /** 文本对象列表 */
  textObjects: TextObject[];
  /** 是否启用手写自然化 */
  naturalnessEnabled: boolean;
  /** 自然化参数 */
  naturalness: NaturalnessParams;
}
