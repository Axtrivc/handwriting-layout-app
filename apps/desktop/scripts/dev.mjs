// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
/**
 * Electron 开发启动脚本：
 * 1. 用 esbuild 实时打包 src/main.ts -> dist/main.cjs
 * 2. 以 HW_DEV=1 启动 electron，连接 web 的 vite dev server
 *
 * 前提：apps/web 的 `npm run dev` 已经在运行（端口 5173）。
 */
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

async function main() {
  await build({
    entryPoints: [resolve(root, "src/main.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: resolve(root, "dist/main.cjs"),
    external: ["electron"],
    logLevel: "info",
  });

  const env = {
    ...process.env,
    HW_DEV: "1",
    HW_DEV_SERVER_URL: "http://127.0.0.1:5173",
    HW_API_BASE: process.env.HW_API_BASE ?? "http://127.0.0.1:8001",
  };

  const child = spawn("electron", [".", "--no-sandbox"], {
    cwd: root,
    env,
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
