/** Printable sampling uses blank cells, keeping reference glyphs out of the ink. */
export const SAMPLE_PAGE_SIZE = 48;
const COLUMNS = 8;

export function collectSampleCharacters(text: string, covered: ReadonlySet<string> = new Set()): string[] {
  return [...new Set(Array.from(text).filter(char => !/[\s\p{C}]/u.test(char) && !covered.has(char)))];
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function samplePageLabels(chars: string[]): string[] {
  const pages: string[] = [];
  for (let i = 0; i < chars.length; i += SAMPLE_PAGE_SIZE) pages.push(chars.slice(i, i + SAMPLE_PAGE_SIZE).join(''));
  return pages;
}

export function renderSampleSheet(chars: string[], profileName: string): string {
  const pages = samplePageLabels(chars);
  const name = escapeHtml(profileName);
  const content = pages.map((labels, page) => {
    const items = Array.from(labels);
    const rows: string[] = [];
    for (let i = 0; i < items.length; i += COLUMNS) rows.push(`<li>${escapeHtml(items.slice(i, i + COLUMNS).join('　'))}</li>`);
    return `<section class="page"><h1>${name} · 手写采样</h1>
<p>第 ${page + 1} / ${pages.length} 页 · 本页 ${items.length} 字。按字序从左到右、从上到下，在下方空格内书写。</p>
<ol class="reference">${rows.join('')}</ol>
<p class="hint">导入照片时只裁取下方书写区，去掉上方参考文字；核对候选数量和顺序后再批量标注。</p>
<div class="writing">${items.map(() => '<div class="cell"></div>').join('')}</div>
<details><summary>本页标注顺序（复制时不要换行）</summary><textarea readonly>${escapeHtml(labels)}</textarea></details></section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} · 手写采样</title>
<style>
@page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#222;font-family:system-ui,sans-serif}
.page{width:190mm;margin:8mm auto;break-after:page}.page:last-child{break-after:auto}
h1{font-size:16pt;margin:0 0 3mm}p{font-size:9pt;margin:2mm 0}.reference{font:13pt/1.6 serif;margin:2mm 0;padding-left:8mm}
.hint{margin:4mm 0}.writing{display:grid;grid-template-columns:repeat(8,1fr);gap:2mm}
.cell{height:25mm;border:0.3mm dashed #eee;break-inside:avoid}
details{margin-top:5mm}textarea{width:100%;height:22mm;font-size:14pt}
@media print{.page{margin:0}details{display:none}}
</style></head><body>${content}</body></html>`;
}

export type SampleLevel = 'basic' | 'advanced' | 'custom';
export const SAMPLE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const SAMPLE_DIGITS = '0123456789';
export const SAMPLE_SYMBOLS = '，。！？；：“”‘’（）《》、…—+-×÷=<>%.,!?;:"\'()[]/';

/** Repetitions remain in both the printed cells and matching label text. */
export function expandSamplePractice(chars: string[], level: SampleLevel): string[] {
  return chars.flatMap(char => {
    const count = level === 'custom' ? 1 : /[0-9]/.test(char) ? 5 : /[A-Za-z]/.test(char)
      ? (level === 'basic' ? 3 : 5) : /\p{Script=Han}/u.test(char)
        ? (level === 'basic' ? 1 : 2) : (level === 'basic' ? 2 : 3);
    return Array.from({ length: count }, () => char);
  });
}
