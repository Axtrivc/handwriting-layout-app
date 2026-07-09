/**
 * 手写自然化工具：对文本对象加入温和的随机抖动。
 *
 * 注意：抖动幅度刻意保持很小，仅用于让排版看起来不那么「印刷感」，
 * 不用于任何对抗检测的目的。
 */
import type { NaturalnessParams, TextObject } from "./types.js";

/** 简单确定性伪随机（基于种子），避免每次渲染抖动跳变。 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
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

/** 对一个文本对象应用自然化抖动，返回带抖动的新对象。 */
export function applyNaturalness(
  obj: TextObject,
  params: NaturalnessParams,
): TextObject {
  const rand = seededRandom(hashSeed(obj.id));
  // 对称区间 [-amp, amp]
  const jitter = (amp: number) => (rand() * 2 - 1) * amp;

  return {
    ...obj,
    x: obj.x + jitter(params.positionJitter),
    y: obj.y + jitter(params.positionJitter),
    style: {
      ...obj.style,
      rotation: obj.style.rotation + jitter(params.rotationJitter),
      opacity: clamp(obj.style.opacity + jitter(params.opacityJitter), 0.1, 1),
    },
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
