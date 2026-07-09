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

### 前端（apps/web）

```bash
cd apps/web
npm install
npm run dev        # 开发模式
npm run build      # 类型检查 + 构建
```

### 桌面（apps/desktop）

```bash
cd apps/desktop
npm install
npm run dev        # 启动 Electron，加载 apps/web 的开发服务器
```

### 后端（services/api）

```bash
cd services/api
python -m venv .venv
. .venv/Scripts/activate    # Git Bash on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

健康检查：`GET http://127.0.0.1:8001/health`

## MVP 范围

详见 [docs/mvp-plan.md](docs/mvp-plan.md)。
