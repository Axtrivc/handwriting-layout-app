import { useEffect, useRef } from 'react';
import type { HandwritingProfile } from '@hw-layout/shared';
import { SampleSheet } from './SampleSheet.js';

export function WorkbookDialog({ profile, projectText, onClose }: {
  profile: HandwritingProfile | null; projectText: string; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, []);
  return <dialog ref={ref} className="workbook-dialog" onClose={onClose} aria-labelledby="workbook-title">
    <header><div><span className="eyebrow">把你的字迹，变成可以排版的字库</span><h2 id="workbook-title">字帖工坊</h2></div>
      <button className="btn" autoFocus onClick={() => ref.current?.close()} aria-label="关闭字帖工坊">关闭</button></header>
    <ol className="workbook-steps"><li>选择基础或进阶</li><li>下载并打印填写</li><li>拍照导入，核对字形</li></ol>
    <p className="hint">{profile ? `当前使用「${profile.name}」的已有字形判断缺字。` : '无需先建档案即可打印。填写后到「我的字迹 / 采样字帖」新建档案并导入照片。'}</p>
    <SampleSheet profile={profile ?? { name: '我的字帖', glyphs: [] }} projectText={projectText} expanded />
  </dialog>;
}
