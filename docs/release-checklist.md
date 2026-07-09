# Release Checklist

发布前逐项检查。全部通过后方可 tag release。

## 1. 依赖与构建

- [ ] `pnpm install` 无错误
- [ ] `pnpm typecheck` 3 包全部 Done
- [ ] `pnpm lint` 0 错误 0 警告
- [ ] `pnpm build` 成功
- [ ] 确认 jspdf/jszip 仍为独立懒加载 chunk（检查 build 输出）

## 2. Python 后端

- [ ] venv 依赖可装：`pip install -r services/api/requirements.txt`
- [ ] `python services/api/scripts/test_glyph.py` 通过
- [ ] `python services/api/scripts/test_detect.py` 通过
- [ ] `python services/api/scripts/test_ocr.py` 通过（unavailable）
- [ ] `HW_OCR_MOCK=1 python services/api/scripts/test_ocr.py` 通过（mock）
- [ ] 启动后端：`pnpm dev:api`，`/health` 返回 ok

## 3. Node 测试

- [ ] `node scripts/test_multipage.mjs` 通过（多页）
- [ ] `node scripts/test_export_history.mjs` 通过（导出/历史）
- [ ] `node scripts/test_ocr_lazy.mjs` 通过（OCR/懒加载）
- [ ] `node scripts/test_handwriting_r4.mjs` 通过（手写系统）

## 4. 桌面

- [ ] `pnpm build:desktop` 成功，dist/main.cjs 生成
- [ ] desktop typecheck 通过
- [ ] prod 加载验证：`pnpm --filter @hw-layout/desktop start` 能加载 web/dist
- [ ] dev 模式：`pnpm dev:desktop` 能加载 vite
- [ ] 后端不可用时弹窗提示

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
