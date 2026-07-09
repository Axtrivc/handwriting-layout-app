/**
 * PDF 导出工具：用 jsPDF 把 canvas dataURL 组合成 PDF。
 *
 * 每页按原图比例放置。压缩质量可选。
 */
import { jsPDF } from "jspdf";
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
 *
 * @param pages 每页的 dataURL + 像素宽高
 * @param compression 图片压缩质量
 */
export function exportPagesToPDF(
  pages: PdfPageInput[],
  compression: PdfCompression = "FAST",
): void {
  if (pages.length === 0) return;

  const first = pages[0];
  const orientation = first.width >= first.height ? "landscape" : "portrait";
  const doc = new jsPDF({
    orientation,
    unit: "px",
    format: [first.width, first.height],
    hotfixes: ["px_scaling"],
  });

  pages.forEach((p, i) => {
    const orient = p.width >= p.height ? "landscape" : "portrait";
    if (i > 0) {
      doc.addPage([p.width, p.height], orient);
    }
    doc.addImage(p.dataURL, "PNG", 0, 0, p.width, p.height, undefined, compression);
  });

  const blob = doc.output("blob");
  const blobURL = URL.createObjectURL(blob);
  downloadURL(blobURL, exportFilename("pdf"));
  setTimeout(() => URL.revokeObjectURL(blobURL), 2000);
}

/** 导出单页为 PDF。 */
export function exportSinglePageToPDF(
  dataURL: string,
  width: number,
  height: number,
  compression: PdfCompression = "FAST",
): void {
  exportPagesToPDF([{ dataURL, width, height }], compression);
}
