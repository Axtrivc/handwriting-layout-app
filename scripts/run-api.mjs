// @ts-nocheck
/**
 * 跨平台启动 FastAPI（在 services/api 的 venv 中运行 uvicorn）。
 *
 * 用法：
 *   node scripts/run-api.mjs            # 启动开发服务器（--reload）
 *   node scripts/run-api.mjs --check    # 仅做导入检查（不启动服务）
 *
 * 自动定位 services/api/.venv 下的 python，无需手动激活虚拟环境。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const API_DIR = resolve(REPO_ROOT, "services", "api");

// 候选 venv python 路径（Windows / Unix）
const venvPythonWin = resolve(API_DIR, ".venv", "Scripts", "python.exe");
const venvPythonUnix = resolve(API_DIR, ".venv", "bin", "python");

function pickPython() {
  if (existsSync(venvPythonWin)) return venvPythonWin;
  if (existsSync(venvPythonUnix)) return venvPythonUnix;
  return null;
}

function main() {
  const python = pickPython();
  const checkOnly = process.argv.includes("--check");

  if (!python) {
    console.error(
      "[api] 未找到 services/api/.venv。请先创建：\n" +
        "  cd services/api && python -m venv .venv && " +
        ".venv/Scripts/python.exe -m pip install -r requirements.txt",
    );
    process.exit(1);
  }

  if (checkOnly) {
    // 仅验证 app 能否导入
    const child = spawn(python, ["-c", "import app.main; print('api import OK')"], {
      cwd: API_DIR,
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    return;
  }

  const host = process.env.HW_API_HOST ?? "127.0.0.1";
  const port = process.env.HW_API_PORT ?? "8001";
  const child = spawn(
    python,
    [
      "-m",
      "uvicorn",
      "app.main:app",
      "--reload",
      "--host",
      host,
      "--port",
      port,
    ],
    { cwd: API_DIR, stdio: "inherit", shell: false },
  );
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
