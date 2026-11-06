# 性能与包体积说明

## 前端包体积

第七轮起，jspdf / jszip 改为动态导入（懒加载），降低主包体积：

| 模块 | 体积 | 加载时机 |
|------|------|----------|
| 主包 index.js | ~523 KB（gzip 163 KB） | 首屏 |
| jspdf chunk | ~358 KB（gzip 118 KB） | 仅导出 PDF 时 |
| jszip chunk | ~97 KB（gzip 30 KB） | 仅导出 ZIP 时 |
| html2canvas | ~202 KB（gzip 48 KB） | 随 jspdf（jspdf 依赖） |
| purify | ~22 KB（gzip 9 KB） | 随 jspdf |

### 主包前 3 大依赖
1. **react-konva + konva**（~350 KB）：画布渲染核心，必需
2. **react + react-dom**（~140 KB）：UI 框架，必需
3. **@hw-layout/shared**（编译后较小）：类型与工具

### 进一步优化方向（TODO）
- react-konva 可考虑按需导入 Konva 组件
- 用 manualChunks 进一步拆分 vendor
- dynamic import GlyphSegmenter（仅打开切割器时加载）

## 大图导出限制

- 浏览器 canvas 最大尺寸约 **16384×16384**（Chrome，平台相关）
- 超大原图（8000px+）2x 导出可能失败或降采样
- 导出失败时 UI 显示错误，不会静默

## 多页项目内存风险

- 保存工程时重复 dataURL 图片会去重到 `assets`，避免十条清除历史和多页复制反复写入相同图片；加载后恢复原有引用结构。
- 字库分组按 glyphs 数组通过 WeakMap 复用，避免多文本对象反复扫描同一字库；编辑产生新数组时自动重建。
- 全部页 PDF 使用异步逐页输入，调用方不再预先保存所有页面的 PNG dataURL；jsPDF 内部仍需保存文档图像。
- PNG ZIP 直接把逐页 canvas 编码为 Blob，不再额外生成 base64 字符串；最终 ZIP 仍需整体生成。
- 字形图按源复用，长项目仍可能占用较多内存；页数过多（>50）或图过大可能导致 **OOM**。
- 超大项目仍建议分批导出，后续可增加页范围导出和完全流式压缩。

## 后端性能

- `/clean-region`：OpenCV Telea inpaint，区域越大越慢
- `/detect-glyph-candidates`：连通域分析，整图越大越慢
- `/segment-glyph`：单字裁剪，很快
- OCR（可选）：首次加载模型较慢，之后缓存

## 撤销栈内存

- 每页最多保留 30 条历史快照（深拷贝 textObjects）
- 大量文本对象时可能占用较多内存
- 切换页面不清理历史（支持回切撤销）
