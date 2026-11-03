# 清除字迹：实现与回归验证

本轮更新把直接覆盖背景改为「预览清除 → 查看原图/效果 → 应用或取消」。
只有应用时才写入项目和撤销记录。切换页面、更换图片、加载项目后，旧清除请求的结果不再应用。
清除历史保留最近 10 次；更换底图时清空该页清除历史。

## 算法

- 使用局部纸张背景估计与逐颜色通道的对比度检测，替代固定灰度 <100 的黑字阈值。
- 提供轻柔、标准、加强三档；可关闭横线保留。
- 横线恢复要求选区左右两侧均有可靠证据。虚线按原图坐标估计周期，避免镜像复制邻近内容。
- 仅替换选区内检测到的笔画像素；选区外和 alpha 通道保持不变。
- API 始终返回 PNG，避免对 JPEG 扫描稿重复有损编码。`changed=false` 表示未检测到可清除内容。
- 越界区域真正裁剪；完全在图外的区域不会修改边缘像素。

这仍是针对纸面扫描稿的传统图像修复，不保证复杂照片、粗涂抹、倾斜/弯曲线条、垂直表格线或严重阴影的无痕恢复。
合成样本不能替代用户真实扫描稿验收。先预览，检查细节后应用。

## 可重复验证

仓库根目录，先启动 `pnpm dev:api` 和 `pnpm dev:web`：

```bash
services/api/.venv/bin/python services/api/scripts/test_inpaint.py
services/api/.venv/bin/python services/api/scripts/test_clean_api.py
node scripts/test_editing.mjs
# 浏览器回归需要 Playwright 和 Chromium；可使用外部安装，无需改项目依赖
PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright-core \
  CHROMIUM_PATH=/usr/bin/chromium node scripts/test_clean_ui.cjs
```

`test_editing.mjs` 使用 Node 22.18+ 的 TypeScript 类型擦除能力，本云环境是 Node 24。

像素回归覆盖黑笔、浅色铅笔、红蓝笔、实线/虚线、无字纸张、扫描噪声/抗锯齿、重叠区域、裁剪、透明度和选区外内容。
接口测试覆盖 PNG/JPEG、三档力度、选区外像素一致性及非法输入。
浏览器测试覆盖预览、原图对比、取消、应用、撤销、文本首次编辑撤销重做、缩放坐标、调整选区不新增框，以及切页后延迟请求的隔离。

另修复文本撤销栈：第一次操作现在可撤销，重做能恢复最新操作，加载工程时清除旧历史。
