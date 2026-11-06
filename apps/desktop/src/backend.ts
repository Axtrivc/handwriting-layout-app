import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

let backendProcess: ChildProcess | null = null;

async function healthy(apiBase: string, timeoutMs = 800): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function localPort(apiBase: string): string | null {
  const url = new URL(apiBase);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) return null;
  const port = Number(url.port || "8001");
  return Number.isInteger(port) && port > 0 && port <= 65535 ? String(port) : null;
}

function spawnBackend(apiBase: string): ChildProcess | null {
  const port = localPort(apiBase);
  if (!port) return null;
  const options: SpawnOptions = {
    env: { ...process.env, HW_API_HOST: "127.0.0.1", HW_API_PORT: port },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    shell: false,
  };
  if (process.resourcesPath && !process.env.HW_DEV) {
    const executable = join(process.resourcesPath, "backend", "hw-api",
      process.platform === "win32" ? "hw-api.exe" : "hw-api");
    if (existsSync(executable)) {
      options.env = { ...options.env, PATH: `${dirname(executable)}${delimiter}${process.env.PATH ?? ""}` };
      // Fixed executable names; no request data is interpolated into a command line.
      return process.platform === "win32"
        ? spawn("hw-api.exe", [], options)
        : spawn("hw-api", [], options);
    }
  }
  const root = join(__dirname, "..", "..", "..");
  const cwd = join(root, "services", "api");
  const pythonDir = join(cwd, ".venv", process.platform === "win32" ? "Scripts" : "bin");
  const python = join(pythonDir, process.platform === "win32" ? "python.exe" : "python");
  if (!existsSync(python)) return null;
  options.env = { ...options.env, PATH: `${pythonDir}${delimiter}${process.env.PATH ?? ""}` };
  return process.platform === "win32"
    ? spawn("python.exe", ["launcher.py"], { ...options, cwd })
    : spawn("python", ["launcher.py"], { ...options, cwd });
}

/** Reuse an existing API or start the bundled/development backend and wait for readiness. */
export async function startBackend(apiBase: string): Promise<void> {
  if (backendProcess || await healthy(apiBase)) return;
  if (process.env.HW_API_EXTERNAL === "1") return;
  const child = spawnBackend(apiBase);
  if (!child) throw new Error("未找到可启动的本地后端");

  let startupError = "";
  backendProcess = child;
  child.stderr?.on("data", chunk => console.error(`[api] ${String(chunk).trim()}`));
  child.once("error", error => { startupError = error.message; });
  child.once("exit", code => {
    if (backendProcess === child) backendProcess = null;
    if (code && !startupError) startupError = `后端进程退出（${code}）`;
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (startupError) break;
    if (await healthy(apiBase)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await stopBackend();
  throw new Error(startupError || "本地后端启动超时");
}

export async function stopBackend(): Promise<void> {
  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  child.kill("SIGTERM");
}
