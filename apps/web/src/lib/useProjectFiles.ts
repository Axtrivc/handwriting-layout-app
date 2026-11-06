import { useCallback, useEffect, useRef, useState } from 'react';
import { deserializeProject, serializeProject, type CanvasProject } from '@hw-layout/shared';
import { downloadText, exportFilename, fileToText, loadImage, pickFile } from './image.js';
import { describeError } from './errors.js';

interface DesktopSaveResult {
  status: 'saved' | 'canceled';
  path?: string;
}
interface DesktopDraft {
  contents: string;
  updatedAt: string;
}

declare global {
  interface Window {
    __HW_DESKTOP__?: {
      saveProject(payload: { filename: string; contents: string }): Promise<DesktopSaveResult>;
      writeDraft?(payload: { contents: string }): Promise<{ status: 'saved'; updatedAt: string }>;
      readDraft?(): Promise<DesktopDraft | null>;
      discardDraft?(): Promise<void>;
    };
  }
}

/** Verify resources before replacing a live document. Failed imports are all-or-nothing. */
async function verifyImages(project: CanvasProject) {
  const sources = new Map<string, string>();
  for (const page of project.pages) {
    if (page.backgroundImage) sources.set(page.backgroundImage, `页面「${page.name}」背景`);
    if (page.colorSource) sources.set(page.colorSource, `页面「${page.name}」彩色来源`);
    for (const entry of page.cleanHistory) {
      sources.set(entry.beforeImage, `页面「${page.name}」清除历史原图`);
      if (entry.beforeColorSource) sources.set(entry.beforeColorSource, `页面「${page.name}」历史彩色来源`);
      if (entry.scanColorSource) sources.set(entry.scanColorSource, `页面「${page.name}」校正后的彩色原图`);
      sources.set(entry.afterImage, `页面「${page.name}」清除历史结果`);
    }
  }
  for (const profile of project.handwritingProfiles) {
    for (const sample of profile.sampleSets) sources.set(sample.imageBase64, `档案「${profile.name}」样本「${sample.name}」`);
    for (const glyph of profile.glyphs) sources.set(glyph.imageBase64, `档案「${profile.name}」字形「${glyph.char}」`);
  }
  const pending = [...sources];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (cursor < pending.length) {
      const [source, label] = pending[cursor++];
      try { await loadImage(source); }
      catch { throw new Error(`${label}无法读取，当前工程未被替换。`); }
    }
  }));
}

export function useProjectFiles({ project, dirty, generation, replace, markSaved, onReplaced, onError, notify }: {
  project: CanvasProject; dirty: boolean; generation: number;
  replace: (project: CanvasProject, dirty?: boolean) => void; markSaved: () => void;
  onReplaced: () => void; onError: (message: string | null) => void; notify: (message: string) => void;
}) {
  const latest = useRef({ project, dirty, generation });
  latest.current = { project, dirty, generation };
  const request = useRef(0);
  const saving = useRef(false);
  const [loading, setLoading] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const draftTimer = useRef<number | null>(null);
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  const draftErrorShown = useRef(false);
  useEffect(() => () => { request.current++; }, []);

  const clearDraft = useCallback(async (expectedProject?: CanvasProject) => {
    const bridge = window.__HW_DESKTOP__;
    if (!bridge?.discardDraft) return;
    if (expectedProject && latest.current.project !== expectedProject) return;
    if (draftTimer.current !== null) {
      window.clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    await draftQueue.current.catch(() => undefined);
    if (expectedProject && latest.current.project !== expectedProject) return;
    await bridge.discardDraft();
  }, []);

  const queueDraft = useCallback((contents: string) => {
    const bridge = window.__HW_DESKTOP__;
    if (!bridge?.writeDraft) return;
    draftQueue.current = draftQueue.current.catch(() => undefined).then(async () => {
      await bridge.writeDraft!({ contents });
      draftErrorShown.current = false;
    }).catch(error => {
      if (!draftErrorShown.current) {
        draftErrorShown.current = true;
        onError(`自动草稿保存失败：${describeError(error)}`);
      }
    });
  }, [onError]);

  // 启动时恢复崩溃或强制结束留下的草稿；正式加载会递增 generation 并使恢复失效。
  useEffect(() => {
    let active = true;
    const restoreGeneration = latest.current.generation;
    const bridge = window.__HW_DESKTOP__;
    if (!bridge?.readDraft) { setDraftReady(true); return; }
    void (async () => {
      try {
        const draft = await bridge.readDraft!();
        if (!active || restoreGeneration !== latest.current.generation) return;
        if (draft?.contents && window.confirm(`发现 ${draft.updatedAt} 的自动草稿，是否恢复？`)) {
          const result = deserializeProject(draft.contents);
          if (!result.ok || !result.project) throw new Error(result.error ?? '自动草稿格式无效');
          await verifyImages(result.project);
          if (!active || restoreGeneration !== latest.current.generation) return;
          if (latest.current.dirty && !window.confirm('当前编辑尚未保存，仍要恢复自动草稿并替换它吗？')) return;
          replace(result.project, true);
          onReplaced();
          notify('已恢复自动草稿；它仍是未保存状态，请核对后正式保存');
        } else if (draft?.contents) {
          await clearDraft();
        }
      } catch (error) {
        if (active) onError(`自动草稿恢复失败：${describeError(error)}`);
      } finally {
        if (active) setDraftReady(true);
      }
    })();
    return () => { active = false; };
  }, [replace, onReplaced, onError, notify, clearDraft]);

  useEffect(() => {
    if (!dirty || !draftReady || !window.__HW_DESKTOP__?.writeDraft) return;
    const timer = window.setTimeout(() => {
      draftTimer.current = null;
      queueDraft(serializeProject(project));
    }, 1500);
    draftTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (draftTimer.current === timer) draftTimer.current = null;
    };
  }, [project, dirty, draftReady, queueDraft]);

  const save = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      const contents = serializeProject(project);
      const filename = exportFilename('json');
      if (window.__HW_DESKTOP__) {
        const result = await window.__HW_DESKTOP__.saveProject({ filename, contents });
        if (result.status === 'canceled') {
          notify('已取消保存，工程仍保留未保存标记');
          return;
        }
        if (result.status !== 'saved') throw new Error('桌面端未确认文件写入');
        markSaved();
        const draftCleanupError = await clearDraft(project)
          .then(() => null)
          .catch(error => `文件已保存，但自动草稿清理失败：${describeError(error)}`);
        onError(draftCleanupError);
        notify(latest.current.project === project ? '项目已保存到本地文件' : '当前快照已保存；后续修改仍保留在自动草稿中');
      } else {
        downloadText(contents, filename, 'application/json');
        notify('已生成项目 JSON 下载；浏览器无法确认写入，工程仍保留未保存标记');
      }
    } catch (error) { onError(`保存失败：${describeError(error)}`); }
    finally { saving.current = false; }
  }, [project, markSaved, notify, onError, clearDraft]);

  const load = useCallback(async () => {
    const token = ++request.current;
    const current = () => token === request.current && generation === latest.current.generation;
    setLoading(true);
    try {
      const file = await pickFile('application/json,.json');
      if (!file || !current()) return;
      const result = deserializeProject(await fileToText(file));
      if (!current()) return;
      if (!result.ok || !result.project) throw new Error(result.error ?? '项目格式无效');
      await verifyImages(result.project);
      if (!current()) return;
      if (latest.current.dirty && !window.confirm('当前工程有未保存的修改。加载其他工程会丢弃这些修改，是否继续？')) return;
      replace(result.project);
      onReplaced();
      const draftCleanupError = await clearDraft()
        .then(() => null)
        .catch(error => `工程已加载，但旧草稿清理失败：${describeError(error)}`);
      onError(draftCleanupError);
      notify(result.migrated ? '已加载旧版工程并迁移为多页格式' : '已加载工程');
    } catch (error) {
      if (current()) onError(`加载失败：${describeError(error)}`);
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [generation, replace, onReplaced, onError, notify, clearDraft]);
  return { save, load, loading };
}
