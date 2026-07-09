# 导出说明

## PNG 导出

### 当前页 PNG
- 导出当前活动页为 PNG
- 内容包含：清理后的背景图 + 所有文本对象 + handwritingGlyph 图片 + naturalness 渲染效果
- 尺寸：按所选倍率（1x 原图 / 2x 高清）× 原图像素分辨率
- 文件名：`handwriting-layout-YYYYMMDD-HHmmss-page-NNN.png`

操作：顶部「导出 PNG」按钮。

### 全部页 PNG ZIP
- 导出所有页面为 PNG，打包成 ZIP
- 每页文件名：`handwriting-layout-YYYYMMDD-HHmmss-page-001.png`、`...-page-002.png`...
- ZIP 文件名：`handwriting-layout-YYYYMMDD-HHmmss-pages.zip`
- 导出过程显示进度（如「正在导出 2/5」），逐页 await 避免 UI 完全卡死
- 失败时显示错误提示

操作：顶部「PNG ZIP」按钮。

## PDF 导出

使用 [jsPDF](https://github.com/parallax/jsPDF) 在前端生成 PDF，无需后端参与。

### 当前页 PDF / 全部页 PDF
- 当前页：单页 PDF；全部页：多页 PDF
- 每页尺寸按原图比例 × 倍率
- 内容含：背景 + 文本 + glyph + naturalness

操作：顶部「页 PDF」/「全 PDF」按钮。

### 压缩质量
顶部下拉可选：
- **FAST**：最快，文件最小（默认）
- **MEDIUM**：平衡
- **SLOW**：最高质量，文件最大

## 导出倍率
顶部下拉可选：
- **1x**：原图尺寸
- **2x**：高清（像素 ×2，适合打印）

## 导出前缺字检查

当导出页面含 handwritingGlyph 模式文本时：
- 自动检查缺字（有字符无 glyph 覆盖）
- 弹窗提示各页缺字，例如：
  ```
  部分页面有缺失字形，将用普通字体代替：
  第 1 页：然、后
  第 3 页：测、试
  ```
- 用户可选择「继续导出」（缺字 fallback 到字体）或取消
- 不阻止导出

## 渲染一致性

第六轮起，活动页与非活动页导出使用**统一的离屏渲染核心**（`lib/offscreenRender.ts` + `shared/textLayout.ts`）：
- 非活动页 PDF 也正确渲染 handwritingGlyph 图片（不再 fallback 字体）
- 支持 left/center/right 对齐、多行
- 支持 naturalness（位置/旋转/透明度/scale/baseline 抖动），seed 稳定
- 图片加载显式 await image.onload，不靠 setTimeout 猜测

## 大图导出限制
- 浏览器 canvas 有最大尺寸限制（约 16384px），超大原图（8000px+）2x 导出可能失败
- 多页 PDF/ZIP 导出耗时随页数增长，已加进度提示
- 内存：每页生成完整 PNG，页数过多可能 OOM

## 项目 JSON 保存/加载

- 保存：`handwriting-layout-YYYYMMDD-HHmmss.json`，含全部 pages、handwritingProfiles、settings
- 加载：自动识别新旧结构，旧单页项目迁移为 pages[0]
- 加载后可继续编辑、导出

## 合规说明

所有导出仅用于个人笔记美化、扫描稿恢复、模板重排版、个人手写风格排版。
不导出用于签名、证件、合同、票据、考试/作业冒充的内容。
详见 [product-boundary.md](product-boundary.md)。

