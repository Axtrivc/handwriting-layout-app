import { useMemo, useState } from 'react';
import { COMMON_SAMPLE_CHARACTERS, STARTER_SAMPLE_CHARACTERS, type HandwritingProfile } from '@hw-layout/shared';
import { downloadText } from '../lib/image.js';
import { collectSampleCharacters, renderSampleSheet, samplePageLabels, expandSamplePractice, SAMPLE_ALPHABET, SAMPLE_DIGITS, SAMPLE_SYMBOLS, type SampleLevel } from '../lib/sampleSheet.js';

export function SampleSheet({ profile, projectText, expanded }: { profile: Pick<HandwritingProfile, "name" | "glyphs">; projectText: string; expanded?: boolean }) {
  const [text, setText] = useState('');
  const [level, setLevel] = useState<SampleLevel>('custom');
  const choose = (next: SampleLevel, value: string) => { setLevel(next); setText(value); };
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const uniqueChars = useMemo(() => collectSampleCharacters(text, onlyMissing ? new Set(profile.glyphs.map(g => g.char)) : undefined), [text, onlyMissing, profile.glyphs]);
  const chars = useMemo(() => expandSamplePractice(uniqueChars, level), [uniqueChars, level]);
  const download = (format: 'html' | 'txt') => {
    try {
      downloadText(format === 'html' ? renderSampleSheet(chars, profile.name) : samplePageLabels(chars).join('\n'),
        `handwriting-samples.${format}`, format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8');
      setError(null);
    } catch { setError('下载未能生成，请重试。'); }
  };
  return <details open={expanded} className="sample-sheet" style={{ margin: '10px 0' }}>
    <summary>字帖工坊 · 基础与进阶</summary>
    <p className="hint">选一个阶段，填写空白字格，再拍照导入当前字迹档案。中文、英文与数字一起采集。</p>
    <div className="sample-levels">
      <button className={`sample-level ${level === 'basic' ? 'is-active' : ''}`} aria-pressed={level === 'basic'}
        onClick={() => choose('basic', Array.from(STARTER_SAMPLE_CHARACTERS).slice(0, 300).join('') + SAMPLE_ALPHABET + SAMPLE_DIGITS + SAMPLE_SYMBOLS)}>
        <strong>基础字帖</strong><span>300 汉字 · 52 字母 · 10 数字 · 常用符号</span><small>中文 1 遍，字母 3 遍，数字 5 遍，符号 2 遍</small>
      </button>
      <button className={`sample-level ${level === 'advanced' ? 'is-active' : ''}`} aria-pressed={level === 'advanced'}
        onClick={() => choose('advanced', COMMON_SAMPLE_CHARACTERS + SAMPLE_ALPHABET + SAMPLE_DIGITS + SAMPLE_SYMBOLS)}>
        <strong>进阶字帖</strong><span>2500 汉字 · 英文数字 · 更多书写变体</span><small>中文 2 遍，字母与数字 5 遍，符号 3 遍</small>
      </button>
    </div>
    <label className="field" style={{ marginTop: 8 }}>
      <span>待采样文字</span>
      <textarea aria-label="待采样文字" value={text} rows={3}
        onChange={e => choose('custom', e.target.value)} placeholder="粘贴要排版的文字，自动去重并跳过已有字形" />
    </label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      <button className="btn btn--xs" disabled={!projectText.trim()} onClick={() => choose('custom', projectText)}>使用项目文字</button>
      <button className="btn btn--xs" onClick={() => choose('custom', STARTER_SAMPLE_CHARACTERS)}>起步 500 字</button>
      <button className="btn btn--xs" onClick={() => choose('custom', COMMON_SAMPLE_CHARACTERS)}>常用 2500 字</button>
    </div>
    <label className="toggle" style={{ marginTop: 8 }}>
      <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />仅补采当前档案缺字
    </label>
    <p className="sample-count">{uniqueChars.length} 个不同字符 · {chars.length} 个书写格 · {Math.ceil(chars.length / 48)} 页 A4</p>
    <p className="hint">每页最多 48 格。下载 HTML 后用浏览器打印；字序 TXT 每行对应一页。起步字表供采样参考，不代表频率排名。</p>
    {chars.length > 1000 && <p className="hint">进阶页数较多，建议按打印页码分批填写；已有字形默认跳过，需要补充变体时取消上方勾选。</p>}
    <div className="sample-preview" aria-label="字帖内容预览">{chars.slice(0, 24).map((char, i) => <span key={i}>{char}</span>)}</div>
    <div style={{ display: 'flex', gap: 4 }}>
      <button className="btn btn--xs" disabled={!chars.length} onClick={() => download('html')}>下载采样页</button>
      <button className="btn btn--xs" disabled={!chars.length} onClick={() => download('txt')}>下载标注顺序</button>
    </div>
    {error && <p className="err-msg">{error}</p>}
  </details>;
}
