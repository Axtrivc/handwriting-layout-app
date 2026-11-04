import { useCallback, useEffect, useRef, useState } from 'react';
import { deserializeProject, serializeProject, type CanvasProject } from '@hw-layout/shared';
import { downloadText, exportFilename, fileToText, loadImage, pickFile } from './image.js';
import { describeError } from './errors.js';

/** Verify resources before replacing a live document. Failed imports are all-or-nothing. */
async function verifyImages(project: CanvasProject) {
  const sources = new Map<string, string>();
  for (const page of project.pages) {
    if (page.backgroundImage) sources.set(page.backgroundImage, `页面「${page.name}」背景`);
    for (const entry of page.cleanHistory) {
      sources.set(entry.beforeImage, `页面「${page.name}」清除历史原图`);
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
  replace: (project: CanvasProject) => void; markSaved: () => void;
  onReplaced: () => void; onError: (message: string | null) => void; notify: (message: string) => void;
}) {
  const latest = useRef({ dirty, generation });
  latest.current = { dirty, generation };
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => () => { request.current++; }, []);

  const save = useCallback(() => {
    try {
      downloadText(serializeProject(project), exportFilename('json'), 'application/json');
      markSaved();
      notify('已生成项目 JSON 下载');
    } catch (error) { onError(`保存失败：${describeError(error)}`); }
  }, [project, markSaved, notify, onError]);

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
      onError(null);
      notify(result.migrated ? '已加载旧版工程并迁移为多页格式' : '已加载工程');
    } catch (error) {
      if (current()) onError(`加载失败：${describeError(error)}`);
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [generation, replace, onReplaced, onError, notify]);
  return { save, load, loading };
}
