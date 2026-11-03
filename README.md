# handwriting-layout-app

合规的本地桌面应用 MVP，用于个人笔记美化、扫描稿恢复、模板重排版、个人手写风格排版。

> 仅处理用户自己的扫描稿和自己的手写风格。本项目不实现签名、证件、合同、票据、考试/作业冒充提交、伪造他人笔迹、规避鉴定等功能。详见 [docs/product-boundary.md](docs/product-boundary.md)。

## 技术栈

- Electron（桌面壳）+ React + Vite + TypeScript（前端）
- Konva.js（画布编辑）
- Python FastAPI（本地后端）+ OpenCV / Pillow（图像清理、去字迹）

## 目录结构

```
handwriting-layout-app/
  apps/desktop      # Electron 主进程
  apps/web          # React + Vite 前端
  services/api      # FastAPI 后端
  services/vision   # 图像处理模块（OpenCV/Pillow）
  services/render   # 导出/渲染模块（预留）
  packages/shared   # 前端共享类型与工具
  storage/samples   # 示例素材
  storage/projects  # 工程文件
  storage/outputs   # 导出产物
  docs              # 文档
```

## 快速开始

本项目使用 **pnpm workspace** 管理 monorepo。

### 前置要求

- Node.js 22.18+ 或 24 LTS（浏览器应用最低要求 Node 20，回归脚本需要新版 Node）
- pnpm 11.10.0（与 `packageManager` 一致，可运行 `npm install -g pnpm@11.10.0`）
- Python 3.11+

### 安装（根目录一次性安装所有前端依赖）

```bash
pnpm install:all
```

### 前端（apps/web）

```bash
pnpm dev:web       # 开发模式，http://127.0.0.1:5173
pnpm build:web     # 类型检查 + 构建
```

### 桌面（apps/desktop）

```bash
# 先启动 apps/web 的 dev server（上一条命令），再另开终端：
pnpm dev:desktop   # 启动 Electron，加载 web 的开发服务器
```

### 后端（services/api）

在仓库根目录创建 Python 环境。Windows PowerShell：

```powershell
python -m venv services/api/.venv
services\api\.venv\Scripts\python.exe -m pip install -r services/api/requirements.txt
```

Linux / macOS：

```bash
python3 -m venv services/api/.venv
services/api/.venv/bin/python -m pip install -r services/api/requirements.txt
```

然后在仓库根目录的两个终端分别运行（所有平台通用）：

```bash
pnpm dev:api       # 终端一，API 默认 http://127.0.0.1:8001
pnpm dev:web       # 终端二，浏览器打开 Vite 打印的地址，通常是 http://localhost:5173
```

健康检查：`GET http://127.0.0.1:8001/health` → `{"status":"ok","version":"0.8.0"}`。
`dev:api` 同时监听 API 和图像算法源码。更新代码或安装依赖后，建议重新启动两个终端中的服务。
GitHub 推送和云环境发布不会启动你电脑上的 `localhost`，本机仍需要以上服务。

### 常用脚本

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装所有 workspace 依赖 |
| `pnpm typecheck` | 全量 TypeScript 类型检查 |
| `pnpm lint` | ESLint 检查 |
| `pnpm build` | 构建 shared + web + desktop |
| `pnpm dev:web` | 启动前端 dev server |
| `pnpm dev:desktop` | 启动 Electron |
| `pnpm dev:api` | 启动 FastAPI（自动用 venv） |

## MVP 范围

详见 [docs/mvp-plan.md](docs/mvp-plan.md)。冒烟测试流程见 [docs/smoke-test.md](docs/smoke-test.md)。

## 当前 main 的可用功能

- **扫描稿编辑**：手机照片 EXIF 方向统一；大图自动适合窗口，可切换 100%、滚轮缩放 / 空格拖动。显示缩放不改变选区或导出像素。
- **扫描增强**：去纸面阴影、黑白 / 灰度预览，黑白有保留浅字 / 标准 / 更强去噪三档；可比较原图、取消或应用。
- **文本对象**：添加 / 选中 / 拖拽 / 删除 / 复制 / 层级置顶置底；StylePanel 实时修改字体、字号、字距、行距、对齐、字色、粗体/斜体、透明度、旋转、轻微模糊
- **清除字迹**：矩形框选或可调粗细的精细画笔；先预览后应用，支持取消等待、撤销上一笔选区及最近 10 次背景处理。保留有双侧证据的横线 / 表格竖线，黑白扫描擦除恢复白底。
- **手写档案**：拍照样本检测与去阴影切字、单字 / 批量标注、缺字采样页；当前页字形按需加载并复用缓存。
- **多页工程**：批量图片按文件名数字顺序导入，失败不添加半批页面；切页、换图和重新加载工程隔离过期请求。
- **手写自然化**：可控参数（位置/旋转/透明度/字号/基线抖动）；编辑时不抖、导出时按固定 seed 应用，重复导出结果一致
- **导出**：当前页 PNG / PDF、全部页 PDF / PNG ZIP；与编辑器共用文字和字形渲染，不含选区提示层。
- **项目存档**：保存/加载本地 JSON（含背景 base64、宽高、文字、样式、自然化、清除历史、appVersion），加载后可继续编辑导出
- **后端连接状态**：UI 显示 connected/disconnected/error，可配置后端地址

## 试卷照片的建议操作

1. 上传原始照片；大图先用「适合窗口」查看整页。
2. 「预览扫描」并切换原图检查细字、标点和图表，再「应用扫描」。
3. 大块空白处用矩形，文字间隙用「精细画笔」；可放大到 100% 操作。红色涂层只是选区。
4. 「预览清除」检查结果，再应用。处理中的等待可取消，选区保留供重试。
5. 保存 JSON 以继续编辑，或导出 PNG / PDF。左栏底部始终保留处理按钮及错误信息。

这是本地图像处理，并非自动识别并恢复整张试卷的手写擦除模型。黑白化会丢失颜色区别，覆盖印刷字的笔迹无法保证恢复；也未实现透视矫正和 OCR 自动转正。算法与回归验证见 [docs/cleanup-validation.md](docs/cleanup-validation.md)，架构与异步状态说明见 [docs/editor-architecture.md](docs/editor-architecture.md)。

## 合规边界

仅用于个人笔记美化、扫描稿恢复、模板重排版、个人手写风格排版。不实现签名、证件、合同、票据、考试/作业冒充提交、伪造他人笔迹等功能。详见 [docs/product-boundary.md](docs/product-boundary.md)。
