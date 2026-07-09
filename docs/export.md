# 导出说明

## PNG 导出

### 当前页 PNG
- 导出当前活动页为 PNG
- 内容包含：清理后的背景图 + 所有文本对象 + handwritingGlyph 图片 + naturalness 渲染效果
- 尺寸：按原图像素分辨率（不被显示缩放降低）
- 文件名：`handwriting-layout-YYYYMMDD-HHmmss-page-NNN.png`
  - NNN 为页码（从 001 开始）

操作：顶部「导出 PNG」按钮。

### 全部页 PNG（TODO）
- 当前未实现批量 PNG zip 导出，可逐页导出
- 后续阶段考虑用 jszip 打包

## PDF 导出

使用 [jsPDF](https://github.com/parallax/jsPDF) 在前端生成 PDF，无需后端参与，降低部署复杂度。

### 当前页 PDF
- 导出当前活动页为单页 PDF
- 页面尺寸按原图比例（单位 px）
- 内容同 PNG 导出

操作：顶部「页 PDF」按钮。

### 全部页 PDF
- 导出所有页面为一个多页 PDF
- 每页尺寸按各自原图比例
- 文件名：`handwriting-layout-YYYYMMDD-HHmmss.pdf`

操作：顶部「全 PDF」按钮。

### 导出质量与实现
- **当前活动页**：直接用 Konva Stage 的 `toDataURL`（pixelRatio 抵消显示缩放），保证清晰度
- **非活动页**：用离屏 canvas 重绘背景 + 文本（字体模式用 fillText）
  - 当前离屏渲染对 handwritingGlyph 模式会 fallback 到字体（标注 TODO）
  - 建议导出全部 PDF 前，先切到每页让它成为活动页以获得最佳 glyph 渲染
- 大图导出有 toast 提示「正在生成…」，失败时显示错误

### 大图导出限制
- 浏览器 canvas 有最大尺寸限制（通常 16384×16384 或更小，取决于平台）
- 超大原图（如 8000px+）导出可能失败或被降采样
- 多页 PDF 导出耗时随页数增长，已加 loading 提示
- 内存占用：每页都会生成一张完整 PNG dataURL，页数过多可能导致 OOM

## 项目 JSON 保存/加载

- 保存：`handwriting-layout-YYYYMMDD-HHmmss.json`，含全部 pages、handwritingProfiles、settings
- 加载：自动识别新旧结构，旧单页项目迁移为 pages[0]
- 加载后可继续编辑、导出

## 合规说明

所有导出仅用于个人笔记美化、扫描稿恢复、模板重排版、个人手写风格排版。
不导出用于签名、证件、合同、票据、考试/作业冒充的内容。
详见 [product-boundary.md](product-boundary.md)。
