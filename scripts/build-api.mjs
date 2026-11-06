import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = resolve(root, "services", "api");
const python = process.platform === "win32"
  ? resolve(apiDir, ".venv", "Scripts", "python.exe")
  : resolve(apiDir, ".venv", "bin", "python");

if (!existsSync(python)) {
  console.error("未找到 services/api/.venv，请先按 README 创建 Python 环境。");
  process.exit(1);
}

const workDir = resolve(apiDir, "build", "pyinstaller");
mkdirSync(workDir, { recursive: true });
const hasRapidOCR = spawnSync(python, ["-c", "import rapidocr_onnxruntime"], {
  cwd: apiDir,
  stdio: "ignore",
  shell: false,
}).status === 0;
const args = [
  "-m", "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onedir",
  "--name", "hw-api",
  "--distpath", resolve(apiDir, "dist"),
  "--workpath", workDir,
  "--specpath", workDir,
  "--paths", apiDir,
  "--paths", resolve(root, "services", "vision"),
  "--collect-submodules", "app",
  "--collect-submodules", "vision",
  "--collect-submodules", "uvicorn",
];
if (hasRapidOCR) args.push("--collect-all", "rapidocr_onnxruntime");
args.push(resolve(apiDir, "launcher.py"));

console.log(`构建本地 API${hasRapidOCR ? "（含 RapidOCR）" : "（不含可选 OCR）"}…`);
const result = spawnSync(python, args, {
  cwd: apiDir,
  stdio: "inherit",
  shell: false,
  env: { ...process.env, PYTHONUTF8: "1" },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const executable = resolve(apiDir, "dist", "hw-api", process.platform === "win32" ? "hw-api.exe" : "hw-api");
if (!existsSync(executable)) {
  console.error(`PyInstaller 未生成预期文件：${executable}`);
  process.exit(1);
}
console.log(`API 构建完成：${executable}`);
