/**
 * PDF 导出工具：用 jsPDF 把 canvas dataURL 组合成 PDF。
 *
 * 每页按原图比例放置，保持像素质量（jsPDF 支持任意尺寸的 image）。
 */
import { jsPDF } from "jspdf";
import { downloadURL, exportFilename } from "./image.js";

/**
 * 把多个 canvas dataURL 合并导出为一个 PDF。
 *
 * @param dataURLs 每页的 canvas dataURL（PNG）
 * @param sizes 每页的像素宽高（用于按比例设置 PDF 页尺寸）
 */
export function exportPagesToPDF(
  dataURLs: string[],
  sizes: { width: number; height: number }[],
): void {
  if (dataURLs.length === 0) return;

  // 用第一页创建 PDF，单位用 px（jsPDF 支持 "px"）
  const first = sizes[0];
  const orientation = first.width >= first.height ? "landscape" : "portrait";
  const doc = new jsPDF({
    orientation,
    unit: "px",
    format: [first.width, first.height],
    hotfixes: ["px_scaling"],
  });

  dataURLs.forEach((url, i) => {
    const s = sizes[i];
    if (i > 0) {
      doc.addPage(
        [s.width, s.height],
        s.width >= s.height ? "landscape" : "portrait",
      );
    }
    // addImage(imageData, format, x, y, w, h)
    doc.addImage(url, "PNG", 0, 0, s.width, s.height, undefined, "FAST");
  });

  const blob = doc.output("blob");
  const blobURL = URL.createObjectURL(blob);
  downloadURL(blobURL, exportFilename("pdf"));
  setTimeout(() => URL.revokeObjectURL(blobURL), 2000);
}

/** 导出单页为 PDF。 */
export function exportSinglePageToPDF(dataURL: string, width: number, height: number): void {
  exportPagesToPDF([dataURL], [{ width, height }]);
}
