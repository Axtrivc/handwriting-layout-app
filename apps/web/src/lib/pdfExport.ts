/**
 * PDF 导出工具：用 jsPDF 把 canvas dataURL 组合成 PDF。
 *
 * 第七轮起：jspdf 改为动态导入，降低主包体积。
 * 每页按原图比例放置。压缩质量可选。
 */
import { downloadURL, exportFilename } from "./image.js";

/** PDF 图片压缩质量。 */
export type PdfCompression = "FAST" | "MEDIUM" | "SLOW";

export interface PdfPageInput {
  dataURL: string;
  width: number;
  height: number;
}

/**
 * 把多个 canvas dataURL 合并导出为一个 PDF。
 * 支持异步逐页输入，调用方无需预先保留全部页面 dataURL。
 *
 * @param pages 每页的 dataURL + 像素宽高
 * @param compression 图片压缩质量
 */
export async function exportPagesToPDF(
  pages: Iterable<PdfPageInput> | AsyncIterable<PdfPageInput>,
  compression: PdfCompression = "FAST",
): Promise<void> {
  async function* iterate() {
    if (Symbol.asyncIterator in Object(pages)) yield* pages as AsyncIterable<PdfPageInput>;
    else yield* pages as Iterable<PdfPageInput>;
  }
  const iterator = iterate()[Symbol.asyncIterator]();
  const firstResult = await iterator.next();
  if (firstResult.done) return;
  // 动态导入 jspdf，仅在导出时加载
  const { jsPDF } = await import("jspdf");

  const first = firstResult.value;
  const orientation = first.width >= first.height ? "landscape" : "portrait";
  const doc = new jsPDF({
    orientation,
    unit: "px",
    format: [first.width, first.height],
    hotfixes: ["px_scaling"],
  });

  let page = first;
  let index = 0;
  while (true) {
    const orient = page.width >= page.height ? "landscape" : "portrait";
    if (index > 0) doc.addPage([page.width, page.height], orient);
    doc.addImage(page.dataURL, "PNG", 0, 0, page.width, page.height, undefined, compression);
    const next = await iterator.next();
    if (next.done) break;
    page = next.value;
    index++;
  }

  const blob = doc.output("blob");
  const blobURL = URL.createObjectURL(blob);
  downloadURL(blobURL, exportFilename("pdf"));
  setTimeout(() => URL.revokeObjectURL(blobURL), 2000);
}

/** 导出单页为 PDF。 */
export async function exportSinglePageToPDF(
  dataURL: string,
  width: number,
  height: number,
  compression: PdfCompression = "FAST",
): Promise<void> {
  await exportPagesToPDF([{ dataURL, width, height }], compression);
}

