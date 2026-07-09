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

- Node.js >= 20
- pnpm >= 10（`npm install -g pnpm` 或 `corepack enable`）
- Python 3.11+（已在 3.14 验证）

### 安装（根目录一次性安装所有前端依赖）

```bash
pnpm install
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

```bash
cd services/api
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Git Bash on Windows
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8001
```

或用根目录脚本（自动定位 venv）：

```bash
pnpm dev:api
```

健康检查：`GET http://127.0.0.1:8001/health` → `{"status":"ok","version":"0.1.0"}`

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

## 当前可用功能（v0.2.0）

- **扫描稿编辑**：上传图片 → 按原图比例显示 → 滚轮缩放 / 空格拖拽平移视图
- **文本对象**：添加 / 选中 / 拖拽 / 删除 / 复制 / 层级置顶置底；StylePanel 实时修改字体、字号、字距、行距、对齐、字色、粗体/斜体、透明度、旋转、轻微模糊
- **清除字迹**：框选模式拖拽生成矩形选区（可拖角调整）→ 调用 `/clean-region`（OpenCV Telea inpaint）→ 替换背景；支持撤销一次
- **手写自然化**：可控参数（位置/旋转/透明度/字号/基线抖动）；编辑时不抖、导出时按固定 seed 应用，重复导出结果一致
- **导出 PNG**：含背景 + 全部文字 + 自然化效果；原图尺寸不被显示缩放降低；文件名 `handwriting-layout-YYYYMMDD-HHmmss.png`
- **项目存档**：保存/加载本地 JSON（含背景 base64、宽高、文字、样式、自然化、清除历史、appVersion），加载后可继续编辑导出
- **后端连接状态**：UI 显示 connected/disconnected/error，可配置后端地址

## 合规边界

仅用于个人笔记美化、扫描稿恢复、模板重排版、个人手写风格排版。不实现签名、证件、合同、票据、考试/作业冒充提交、伪造他人笔迹等功能。详见 [docs/product-boundary.md](docs/product-boundary.md)。
