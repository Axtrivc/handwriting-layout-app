import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = resolve(root, "apps", "web", "node_modules", "vite", "bin", "vite.js");
const chromiumCandidates = [
  process.env.CHROMIUM_PATH,
  process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : null,
  process.platform === "win32" ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : null,
  process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : null,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter(Boolean);
const chromium = chromiumCandidates.find(path => existsSync(path));
if (!chromium) {
  console.error("未找到 Chrome/Chromium，请通过 CHROMIUM_PATH 指定可执行文件。");
  process.exit(1);
}

async function reachable() {
  try {
    return (await fetch("http://127.0.0.1:5173", { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

if (await reachable()) {
  console.error("端口 5173 已被占用，请先停止现有 Vite 服务。");
  process.exit(1);
}

const vite = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--strictPort"], {
  cwd: resolve(root, "apps", "web"),
  stdio: "ignore",
  shell: false,
  windowsHide: true,
});
let serverError = "";
vite.once("error", error => { serverError = error.message; });
vite.once("exit", code => { if (code) serverError = `Vite 退出（${code}）`; });

try {
  const deadline = Date.now() + 15_000;
  while (!(await reachable()) && Date.now() < deadline && !serverError) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await reachable())) throw new Error(serverError || "Vite 启动超时");

  const tests = [
    "test_desktop_save_ui.cjs",
    "test_draft_ui.cjs",
    "test_project_files_ui.cjs",
    "test_text_flow_ui.cjs",
    "test_export_ui.cjs",
  ];
  for (const test of tests) {
    console.log(`\n>>> ${test}`);
    const result = spawnSync(process.execPath, [resolve(root, "scripts", test)], {
      cwd: root,
      stdio: "inherit",
      shell: false,
      env: { ...process.env, CHROMIUM_PATH: chromium },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${test} 失败（${result.status ?? 1}）`);
  }
  console.log(`\nPASS: ${tests.length} browser suites completed`);
} finally {
  vite.kill("SIGTERM");
}
