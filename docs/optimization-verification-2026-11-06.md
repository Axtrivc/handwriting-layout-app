# 持续优化验证记录（2026-11-06）

## 最终状态

- TypeScript 全量检查通过；ESLint 零错误、零警告；`git diff --check` 通过。
- `pnpm test:unit`：15 组离线回归全部通过。
- `services/api/tests`：47 个图片安全、OCR、并发与 CORS 测试全部通过。
- 既有视觉回归通过：document scan 10 tests + 8 subtests、inpaint 14、glyph/detect、photo detect 11、deskew 4、reference restore 5。
- `pnpm test:e2e`：5 组核心浏览器回归通过。
- 额外浏览器回归全部通过：image import、glyph cache、viewport、pan、workbench、scan、clean、brush、natural handwriting、handwriting workflow、scan intelligence、sampling。
- `pnpm package:dist` 成功，NSIS 安装包约 155 MB，包含 RapidOCR 的独立后端。
- `scripts/test_packaged_desktop.cjs` 通过：`hw-app://app`、preload、页面到 API 的 CORS、隔离草稿读写/删除、内置 API 启动与关闭清理。

## 核心命令

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
services/api/.venv/Scripts/python.exe -I -m pytest -p no:cacheprovider services/api/tests -q
pnpm package:dist
pnpm exec node scripts/test_packaged_desktop.cjs
```

扩展浏览器脚本需要同时启动 Vite 与打包 API，并通过 `CHROMIUM_PATH` 指向本机 Chrome/Chromium。

## 产物

`apps/desktop/release/Handwriting Layout Setup 0.8.0.exe`

- 大小：162142339 bytes
- SHA-256：`9b09ad99ac95388cff5818d566a7d76c3254c0ebacd532a28f204339c45f1288`

## 保留事项

未提交、未推送；用户原有未跟踪素材、模型与存储文件保持不动。PDF/ZIP 已减少额外 base64 累积，但最终文档仍需整体生成；处理超时只停止 HTTP 等待，不会强杀已经运行的同步原生运算。上述限制及运行参数见 `docs/backend-operations.md`。
