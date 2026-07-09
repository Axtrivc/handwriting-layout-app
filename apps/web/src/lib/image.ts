/**
 * 图片与通用工具：读取本地文件、转 dataURL、获取尺寸、文件名、seed。
 */

/** 读取 File 为 dataURL 字符串。 */
export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 从 dataURL 加载 HTMLImageElement，用于获取原始尺寸。 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/** 生成唯一 id。 */
export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 生成 32 位无符号随机种子（用于 TextObject.naturalnessSeed）。 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/**
 * 从 dataURL 中提取 base64 数据与 MIME。
 * 输入 "data:image/png;base64,xxxx" -> { data: "xxxx", mime: "image/png" }
 */
export function splitDataURL(
  dataURL: string,
): { data: string; mime: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataURL);
  if (!m) throw new Error("invalid data URL");
  return { mime: m[1], data: m[2] };
}

/** 拼接 base64 为 dataURL。 */
export function joinDataURL(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

/** 触发浏览器下载（dataURL 或普通 URL）。 */
export function downloadURL(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 触发下载文本内容为文件。 */
export function downloadText(text: string, filename: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  downloadURL(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 生成导出文件名：handwriting-layout-YYYYMMDD-HHmmss.png
 * 可传入扩展名（不带点）。
 */
export function exportFilename(ext: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `handwriting-layout-${y}${m}${d}-${hh}${mm}${ss}.${ext}`;
}

/** 触发文件选择（用于加载项目 JSON）。返回所选文件或 null。 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    // 取消选择时 onchange 不触发；此处不阻塞，返回 null 由调用方处理
    input.click();
  });
}

/** 读取 File 为文本。 */
export function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
