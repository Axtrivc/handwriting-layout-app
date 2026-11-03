import { useMemo, useState } from 'react';
import { COMMON_SAMPLE_CHARACTERS, STARTER_SAMPLE_CHARACTERS, type HandwritingProfile } from '@hw-layout/shared';
import { downloadText } from '../lib/image.js';
import { collectSampleCharacters, renderSampleSheet, samplePageLabels } from '../lib/sampleSheet.js';

export function SampleSheet({ profile, projectText }: { profile: HandwritingProfile; projectText: string }) {
  const [text, setText] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chars = useMemo(() => collectSampleCharacters(text, onlyMissing ? new Set(profile.glyphs.map(g => g.char)) : undefined), [text, onlyMissing, profile.glyphs]);
  const download = (format: 'html' | 'txt') => {
    try {
      downloadText(format === 'html' ? renderSampleSheet(chars, profile.name) : samplePageLabels(chars).join('\n'),
        `handwriting-samples.${format}`, format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8');
      setError(null);
    } catch { setError('下载未能生成，请重试。'); }
  };
  return <details className="sample-sheet" style={{ margin: '10px 0' }}>
    <summary>生成补字采样页</summary>
    <label className="field" style={{ marginTop: 8 }}>
      <span>待采样文字</span>
      <textarea aria-label="待采样文字" value={text} rows={3}
        onChange={e => setText(e.target.value)} placeholder="粘贴要排版的文字，自动去重并跳过已有字形" />
    </label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      <button className="btn btn--xs" disabled={!projectText.trim()} onClick={() => setText(projectText)}>使用项目文字</button>
      <button className="btn btn--xs" onClick={() => setText(STARTER_SAMPLE_CHARACTERS)}>起步 500 字</button>
      <button className="btn btn--xs" onClick={() => setText(COMMON_SAMPLE_CHARACTERS)}>常用 2500 字</button>
    </div>
    <label className="toggle" style={{ marginTop: 8 }}>
      <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />仅补采当前档案缺字
    </label>
    <p className="hint">待采样 {chars.length} 字 · 每页最多 48 字。下载 HTML 后用浏览器打印；字序 TXT 每行对应一页。起步字表供采样参考，不代表频率排名。</p>
    <div style={{ display: 'flex', gap: 4 }}>
      <button className="btn btn--xs" disabled={!chars.length} onClick={() => download('html')}>下载采样页</button>
      <button className="btn btn--xs" disabled={!chars.length} onClick={() => download('txt')}>下载标注顺序</button>
    </div>
    {error && <p className="err-msg">{error}</p>}
  </details>;
}
