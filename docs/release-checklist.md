# Release Checklist

发布前逐项检查。全部通过后方可 tag release。

## 1. 依赖与构建

- [ ] `pnpm install` 无错误
- [ ] `pnpm typecheck` 3 包全部 Done
- [ ] `pnpm lint` 0 错误 0 警告
- [ ] `pnpm build` 成功
- [ ] 确认 jspdf/jszip 仍为独立懒加载 chunk（检查 build 输出）

## 2. Python 后端

- [ ] venv 依赖可装：`pip install -r services/api/requirements.txt -r services/api/requirements-dev.txt`
- [ ] `python -m pytest -p no:cacheprovider services/api/tests -q` 通过（图片安全与 OCR 契约）
- [ ] `python services/api/scripts/test_glyph.py` 通过
- [ ] `python services/api/scripts/test_detect.py` 通过
- [ ] `python services/api/scripts/test_ocr.py` 通过（unavailable）
- [ ] `HW_OCR_MOCK=1 python services/api/scripts/test_ocr.py` 通过（mock）
- [ ] 启动后端：`pnpm dev:api`，`/health` 返回 ok

## 3. Node 测试

- [ ] `pnpm test:unit` 全部通过（会构建 shared/web/desktop 并执行离线回归）
- [ ] `pnpm test:e2e` 通过（自动启动 Vite，覆盖原生保存契约、工程恢复、多页 PDF、PNG ZIP 与透明背景）
- [ ] 其余浏览器回归按 `docs/cleanup-validation.md` 运行

## 4. 桌面

- [ ] `pnpm build:desktop` 成功，`dist/main.cjs` 与 `dist/preload.cjs` 生成
- [ ] desktop typecheck 通过
- [ ] prod 加载验证：`pnpm --filter @hw-layout/desktop start` 能加载 web/dist
- [ ] dev 模式：`pnpm dev:desktop` 能加载 vite，并自动复用或启动 API
- [ ] 后端不可用且无法启动时弹窗提示
- [ ] 原生保存取消/失败保留 dirty，成功写入后才清除 dirty
- [ ] `pnpm build:api` 生成 `services/api/dist/hw-api`
- [ ] `pnpm package:desktop` 生成含 `resources/backend/hw-api` 的目录包
- [ ] `pnpm package:dist` 生成 NSIS 安装包；默认未签名，发布签名版本前另行配置证书与签名流程
- [ ] 在未预装 Python 的干净环境安装后，启动应用即可调用 `/health` 并完成扫描/清除

## 5. 手工 QA

- [ ] 按 `docs/manual-qa.md` 走核心路径
- [ ] 多页项目创建/切换
- [ ] glyph 标注（手动 + OCR mock）
- [ ] handwritingGlyph 渲染 + 缺字 fallback
- [ ] PNG/PDF/ZIP 导出
- [ ] 保存/加载项目
- [ ] Ctrl+Z/Y 撤销重做
- [ ] dirty/clean 提示
- [ ] 空状态引导

## 6. demo 工程

- [ ] `storage/samples/demo-project.json` 可加载
- [ ] 含 2 页 + glyph + 缺字示例
- [ ] 用 `scripts/gen_demo_project.py` 可重新生成

## 7. 文档

- [ ] CHANGELOG.md 更新
- [ ] docs/manual-qa.md 完整
- [ ] docs/performance.md 更新
- [ ] docs/product-boundary.md 合规边界完整
- [ ] README 快速开始准确

## 8. Git

- [ ] `git status` clean
- [ ] commit message 规范
- [ ] push 到远程
- [ ] （可选）tag：`git tag v0.8.0-beta && git push origin v0.8.0-beta`

## 9. 合规复核

- [ ] 无签名/证件/合同/票据/考试冒充功能
- [ ] 文案无「伪造」「冒充」「绕过检测」
- [ ] product-boundary.md 完整
