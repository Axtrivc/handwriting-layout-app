# Changelog

本项目版本号语义：`主.次.修订`。当前为 **0.8.0-beta**（功能完整，待真实环境长期验证）。

## [Unreleased]

- 修复手机照片 EXIF 方向未统一导致的清除后旋转和选区错位，前端增加处理结果尺寸校验。
- 新增黑白/灰度扫描预览：去纸面阴影、三档黑白细节、原图对比、应用与逐步撤销；背景处理历史随工程保存。
- 黑白扫描版擦除直接恢复白底，减少灰色涂抹残迹；增加方向、细字/横线、实际浏览器扫描清除流程回归。
- 吸收本地拍照样本检测：增加自适应阈值、去阴影字形提取，覆盖单项与批量保存，保留彩色笔画和透明度。
- 手写档案新增补字采样页：按项目文字或参考字表生成，跳过已有字形，下载可打印 HTML 与逐页标注顺序。
- 修正透明字形缩放填充与裁边，新增拍照/采样回归；本地改动取舍及未合入 LaMa 封装的原因见 docs/local-changes-review.md。
- 工程加载先验证嵌套数据及图片资源，失败不覆盖当前编辑；修复取消文件选择后的挂起。
- 修复字形保存失败丢候选、批量保存误删未标注项、检测失败清空标注，以及 OCR 候选顺序错配。
- 标注窗口隔离过期请求，新增工程格式校验和浏览器失败恢复回归。
- 重构编辑器文档修改入口：版本化未保存状态、旧工程异步结果隔离、并发档案更新。
- 清除、图片解码、导出流程独立；移除重复维护的页面图片缓存。
- 编辑器与 PNG/PDF/ZIP 共用文字/字形绘制描述，修复旋转丢失与缩放平移影响 PNG。
- 修复复制页背景、非活动手写档案字形加载、空白页编辑，以及导出倍率改变 PDF 纸张尺寸。
- 新增文档状态与浏览器导出回归；架构说明见 docs/editor-architecture.md。

- 清除字迹改用局部背景与颜色对比检测，改善浅色和彩色笔迹；严格保留选区外像素与透明度。
- 横线使用双侧证据恢复，虚线保留周期；API 使用 PNG 无损输出。
- 新增清除预览、原图对比、应用/取消、三档力度与横线保留开关。
- 修复缩放选区边界、角点调整误触发框选、切页/换图后的异步清除结果污染。
- 修复文本首次编辑无法撤销及重做状态丢失；新增像素、接口、编辑历史和真实浏览器回归。
- 验证方式及适用范围见 docs/cleanup-validation.md。

## [0.8.0-beta] - 2026-07-09 Release 验证

### 第九轮验证结果
- Release 前检查：install/typecheck/lint/build 全过，Python 3 套 + Node 4 套测试全过
- 后端版本同步 0.8.0，/health、/ocr/status、/clean-region、/detect-glyph-candidates、/export 联调通过
- Electron prod 模式 `electron .` 启动验证通过（加载 web/dist）
- RapidOCR 可选依赖安装成功（rapidocr-onnxruntime 1.2.3），/ocr/status 从 unavailable 变 ok+rapidocr
- OCR pipeline 完整工作（provider 检测→识别→低置信度清空），合成图准确率低（需真实手写样本验证）
- electron-builder exe 打包因 Windows 工具链（squirrel-windows）下载超时未完成，配置已就绪
- 新增 services/api/requirements-ocr.txt（可选 OCR 依赖）

## [0.8.0] - 2026-07-09

### 第七轮：OCR 辅助标注 + 导出懒加载
- OCR provider 抽象（RapidOCR/EasyOCR/mock 可插拔，可选依赖）
- OCR 端点：/ocr/status、/ocr-glyph、/ocr-sample、/suggest-glyph-labels
- GlyphSegmenter OCR 辅助识别、置信度分级（high/medium/low）
- 高置信度一键应用，中低不自动
- 标注工作流：键盘导航、自动跳转、过滤
- jspdf/jszip 动态懒加载（主包 979KB→523KB，-47%）
- dirty/clean 状态、未保存提示

### 第六轮：导出增强 + 离屏 glyph
- 统一渲染核心 shared/textLayout.ts
- 非活动页 PDF 离屏渲染 handwritingGlyph（不再 fallback）
- 全部页 PNG ZIP 导出
- 导出质量设置（1x/2x、PDF 压缩）
- 文本撤销栈（Ctrl+Z/Y）
- 导出前缺字检查

### 第五轮：多页工程 + PDF
- 多页数据结构 CanvasPage[] + activePageId
- PagePanel 多页 UI（新建/删除/复制/重命名/重排/切换）
- 多图导入、页面级隔离
- PDF 导出（jsPDF，当前页/全部页）
- PNG 导出带页码
- 旧单页项目自动迁移

### 第四轮：自动辅助切字
- glyph 自动检测（连通域 + 行聚类 + 阅读顺序）
- 前端批量标注、候选框编辑
- glyph 质量检查（good/warning/poor）
- handwritingGlyph 对齐（left/center/right）
- 渲染自然度增强、缺字提示、覆盖率统计

### 第三轮：手写样本库
- HandwritingProfile/SampleSet/Glyph 数据结构
- ProfileManager 档案管理
- GlyphSegmenter 手动切割
- handwritingGlyph 渲染模式（glyph 优先 + fallback）
- 多 variant seed 稳定选择
- 项目 JSON 兼容、样本模板

## [0.5.0] - 多页工程基础

## [0.4.0] - 自动辅助切字

## [0.3.0] - 手写样本库

## [0.2.0] - 真实可用 MVP

## [0.1.0] - MVP 骨架
- Electron + React + Vite + Konva + FastAPI
- 扫描稿画布、文本对象、清除区域、导出 PNG
- 自然化抖动、项目存档
- 合规边界文档

## 已知限制
- jspdf chunk 仍 >500KB（独立懒加载，不影响首屏）
- 非活动页 PDF 的 glyph 离屏渲染已支持，但建议导出前切到该页获得最佳效果
- 浏览器 canvas 最大 ~16384px，超大图导出受限
- electron-builder exe 打包需稳定网络下载 Windows 工具链（squirrel-windows），prod 模式 `electron .` 已验证可运行
- RapidOCR 合成图准确率低，真实手写样本效果待验证
- PDF 导入未实现

## 下一步计划
- RapidOCR 真实识别验证
- electron-builder 集成打包 exe/dmg
- PDF 导入（pdf.js）
- 多页文本撤销栈增强
- chunk 进一步拆分
