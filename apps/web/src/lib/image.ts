/**
 * 图片工具：读取本地文件、转 dataURL、获取尺寸。
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

/** 触发浏览器下载 dataURL。 */
export function downloadDataURL(dataURL: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
