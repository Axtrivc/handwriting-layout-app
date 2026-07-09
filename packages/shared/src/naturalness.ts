/**
 * 手写自然化工具：对文本对象加入温和的随机抖动。
 *
 * 设计要点：
 * - 每个 TextObject 自带 naturalnessSeed，保证同一项目重复导出结果一致。
 * - 编辑状态下不应用抖动（由调用方决定），导出/渲染时才应用。
 * - 抖动幅度刻意保持很小，仅用于让排版看起来不那么「印刷感」。
 *
 * 注意：不用于任何对抗检测的目的。
 */
import type { NaturalnessParams, TextObject } from "./types.js";

/** 简单确定性伪随机（基于种子），避免每次渲染抖动跳变。 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  // 若 seed 为 0，给个非零初值避免退化
  if (s === 0) s = 0x9e3779b9;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** 由字符串生成正整数种子。 */
export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 应用自然化后的文本对象（带可能的逐行基线浮动）。 */
export interface NaturalizedObject extends TextObject {
  /** 逐行基线偏移 (px)，长度等于文本行数；编辑时不提供。 */
  lineOffsets?: number[];
}

/**
 * 对一个文本对象应用自然化抖动，返回带抖动的新对象。
 *
 * @param obj 原始文本对象
 * @param params 自然化参数
 * @param exportSeed 导出时的全局种子。若提供，会与对象自身 seed 组合，
 *                  保证「同一项目多次导出结果一致」；不提供则只用对象 seed。
 */
export function applyNaturalness(
  obj: TextObject,
  params: NaturalnessParams,
  exportSeed?: number,
): NaturalizedObject {
  // 组合种子：对象 seed 与导出 seed 混合
  const baseSeed =
    exportSeed !== undefined
      ? (obj.naturalnessSeed ^ exportSeed) >>> 0
      : obj.naturalnessSeed;
  const rand = seededRandom(baseSeed);

  // 对称区间 [-amp, amp]
  const jitter = (amp: number) => (rand() * 2 - 1) * amp;

  // 逐行基线浮动：每行独立偏移，让多行文本看起来手写
  const lines = obj.text.split("\n");
  const lineOffsets =
    params.baselineJitter > 0
      ? lines.map(() => jitter(params.baselineJitter))
      : undefined;

  return {
    ...obj,
    x: obj.x + jitter(params.positionJitter),
    y: obj.y + jitter(params.positionJitter),
    style: {
      ...obj.style,
      fontSize: Math.max(
        4,
        obj.style.fontSize + jitter(params.fontSizeJitter),
      ),
      rotation: obj.style.rotation + jitter(params.rotationJitter),
      opacity: clamp(obj.style.opacity + jitter(params.opacityJitter), 0.1, 1),
    },
    lineOffsets,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
