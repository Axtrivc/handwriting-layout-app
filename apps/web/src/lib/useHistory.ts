/**
 * 每页独立的文本撤销/重做栈。
 *
 * 轻量实现：每个 pageId 维护一个 history 数组（存 textObjects 快照）+ 指针。
 * 不引入复杂状态管理库。
 *
 * 限制最大历史条数（默认 30）避免内存爆炸。
 */
import { useCallback, useRef } from "react";
import type { TextObject } from "@hw-layout/shared";

const MAX_HISTORY = 30;

interface PageHistory {
  stack: TextObject[][];
  pointer: number; // 指向当前状态（-1 表示空）
}

export interface UseHistoryResult {
  /** 在一次编辑操作前调用，把操作前的状态压栈 */
  push: (pageId: string, textObjects: TextObject[]) => void;
  /** 撤销：返回上一状态，若无返回 null */
  undo: (pageId: string) => TextObject[] | null;
  /** 重做：返回下一状态，若无返回 null */
  redo: (pageId: string) => TextObject[] | null;
  /** 是否可撤销 */
  canUndo: (pageId: string) => boolean;
  /** 是否可重做 */
  canRedo: (pageId: string) => boolean;
}

export function useHistory(): UseHistoryResult {
  const store = useRef<Map<string, PageHistory>>(new Map());

  const getOrCreate = useCallback((pageId: string): PageHistory => {
    let h = store.current.get(pageId);
    if (!h) {
      h = { stack: [], pointer: -1 };
      store.current.set(pageId, h);
    }
    return h;
  }, []);

  const push = useCallback(
    (pageId: string, textObjects: TextObject[]) => {
      const h = getOrCreate(pageId);
      // 丢弃 pointer 之后的历史（新操作覆盖 redo 分支）
      h.stack = h.stack.slice(0, h.pointer + 1);
      h.stack.push(textObjects.map((t) => ({ ...t, style: { ...t.style } })));
      // 限制最大长度
      if (h.stack.length > MAX_HISTORY) {
        h.stack.shift();
      } else {
        h.pointer++;
      }
    },
    [getOrCreate],
  );

  const undo = useCallback(
    (pageId: string): TextObject[] | null => {
      const h = getOrCreate(pageId);
      if (h.pointer <= 0) return null;
      h.pointer--;
      return h.stack[h.pointer].map((t) => ({ ...t, style: { ...t.style } }));
    },
    [getOrCreate],
  );

  const redo = useCallback(
    (pageId: string): TextObject[] | null => {
      const h = getOrCreate(pageId);
      if (h.pointer >= h.stack.length - 1) return null;
      h.pointer++;
      return h.stack[h.pointer].map((t) => ({ ...t, style: { ...t.style } }));
    },
    [getOrCreate],
  );

  const canUndo = useCallback(
    (pageId: string) => {
      const h = store.current.get(pageId);
      return h ? h.pointer > 0 : false;
    },
    [],
  );

  const canRedo = useCallback(
    (pageId: string) => {
      const h = store.current.get(pageId);
      return h ? h.pointer < h.stack.length - 1 : false;
    },
    [],
  );

  return { push, undo, redo, canUndo, canRedo };
}
