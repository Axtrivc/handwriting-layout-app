# Smoke Test（冒烟测试）

本文件描述手工验证 MVP 核心闭环的完整流程。建议每次改动后按此流程跑一遍。

> 示例素材：`storage/samples/demo-notes.png`（程序生成的合成笔记本页，**非真实敏感材料**）。
> 如需重新生成：`services/api/.venv/Scripts/python.exe scripts/gen_sample.py`

## 前置准备

1. 已执行 `pnpm install`（根目录）
2. 已创建 Python 虚拟环境并装依赖：
   ```bash
   cd services/api
   python -m venv .venv
   .venv/Scripts/python.exe -m pip install -r requirements.txt
   ```

## 启动服务

打开两个终端：

**终端 A — 后端：**
```bash
pnpm dev:api
# 或：cd services/api && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8001
```
预期看到：`Uvicorn running on http://127.0.0.1:8001`

**终端 B — 前端：**
```bash
pnpm dev:web
```
浏览器打开 http://127.0.0.1:5173

## 验证步骤

### 1. 连接状态
- 页面顶部连接徽章显示 **「已连接」v0.2.0**（绿色圆点）
- 若显示「未连接」，点 ⚙ 修改后端地址为 `http://127.0.0.1:8001` 后回车

### 2. 上传图片
- 点左侧「点击上传图片」，选择 `storage/samples/demo-notes.png`
- 画布显示笔记本页（按原图 800×1000 比例）

### 3. 框选清除
- 勾选「框选模式」
- 在画布上某行旧字迹上拖拽出矩形选区
- 选区四角可拖拽调整大小（绿色锚点）
- 点「清除字迹 (1)」→ 显示「处理中…」→ 完成后该区域字迹消失，背景保留
- 点「↶ 撤销清除」→ 字迹恢复

### 4. 添加文字
- 取消「框选模式」
- 点「+ 添加文本框」→ 画布中央出现文本
- 拖拽文本移动位置
- 双击文本 → 编辑内容

### 5. 样式修改
- 选中文本，右侧 StylePanel：
  - 字体族、字号、字距、行距、对齐
  - 字色、粗体 B、斜体 I、透明度、旋转、轻微模糊
- 所有修改**实时**反映在画布

### 6. 层级与复制
- 添加第二个文本框
- StylePanel 顶部：复制 / 置顶 / 置底

### 7. 自然化
- 勾选「启用温和抖动」
- 调整 5 个参数滑块（位置/旋转/透明度/字号/基线）
- **编辑时文字不跳**（显示原始对象）
- 导出时才应用抖动（见下一步）

### 8. 导出 PNG
- 点「导出 PNG」
- 文件名格式：`handwriting-layout-YYYYMMDD-HHmmss.png`
- 打开导出图：
  - 尺寸 = 原图尺寸（800×1000，不被显示缩放降低）
  - 包含背景 + 所有文字 + 自然化抖动效果
  - 框选选区/选中框不出现

### 9. 项目保存 / 加载
- 点「保存项目」→ 下载 `handwriting-layout-...json`
- 刷新页面（清空状态）
- 点「加载项目」→ 选择刚才的 JSON
- 画布恢复：背景、所有文字、样式、自然化设置
- 可继续编辑并重新导出

## 通过标准

以上 9 步全部无报错、行为符合预期，即为 smoke test 通过。

## 自动化补充

由于前端依赖 Konva 真实 Canvas API，无法在 jsdom 环境挂载。
后端能力有自动化验证：

```bash
# 启动后端后，运行：
services/api/.venv/Scripts/python.exe services/api/scripts/test_clean.py
```
该脚本验证 `/clean-region` 能接收 base64 图 + region，返回 inpaint 后的 base64 图。
