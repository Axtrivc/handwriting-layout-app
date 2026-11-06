/**
 * Electron 主进程入口。
 *
 * 职责：创建 BrowserWindow，加载前端（dev 连 Vite、prod 加载 web 构建产物），
 * 注入后端地址，启动或复用本地后端，并在不可用时提示用户。
 */
import { app, BrowserWindow, shell, dialog, ipcMain } from "electron";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { startBackend, stopBackend } from "./backend";
import { APP_ORIGIN, registerAppProtocol, registerPrivilegedAppScheme } from "./appProtocol";

registerPrivilegedAppScheme();

// 是否开发模式：由环境变量控制
const isDev = !!process.env.HW_DEV;
// 前端 dev server 地址
const DEV_SERVER_URL = process.env.HW_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
// 后端 FastAPI 地址，注入到渲染进程
const API_BASE = process.env.HW_API_BASE ?? "http://127.0.0.1:8001";
if (process.env.HW_USER_DATA_PATH) app.setPath("userData", process.env.HW_USER_DATA_PATH);

let mainWindow: BrowserWindow | null = null;
let backendCheckDone = false;

function openExternal(url: string): void {
  try {
    const protocol = new URL(url).protocol;
    if (protocol === "https:" || protocol === "http:") void shell.openExternal(url);
  } catch {
    // Ignore malformed or unsupported links rather than passing them to the OS.
  }
}

async function writeTextAtomic(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

ipcMain.handle("project:save", async (event, payload: { filename?: unknown; contents?: unknown }) => {
  if (typeof payload?.filename !== "string" || typeof payload.contents !== "string") {
    throw new Error("保存参数无效");
  }
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner) throw new Error("保存窗口已关闭");
  const result = await dialog.showSaveDialog(owner, {
    title: "保存项目",
    defaultPath: payload.filename,
    filters: [{ name: "Handwriting Layout 项目", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { status: "canceled" as const };

  const filePath = result.filePath;
  await writeTextAtomic(filePath, payload.contents);
  return { status: "saved" as const, path: filePath };
});

const draftPath = () => join(app.getPath("userData"), "project-draft.json");

ipcMain.handle("project:draft:write", async (_event, payload: { contents?: unknown }) => {
  if (typeof payload?.contents !== "string") throw new Error("草稿内容无效");
  const updatedAt = new Date().toISOString();
  await writeTextAtomic(draftPath(), JSON.stringify({ version: 1, updatedAt, contents: payload.contents }));
  return { status: "saved" as const, updatedAt };
});

ipcMain.handle("project:draft:read", async () => {
  try {
    const draft = JSON.parse(await readFile(draftPath(), "utf8")) as { contents?: unknown; updatedAt?: unknown };
    if (typeof draft.contents !== "string" || typeof draft.updatedAt !== "string") {
      throw new Error("自动草稿格式无效");
    }
    return { contents: draft.contents, updatedAt: draft.updatedAt };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
});

ipcMain.handle("project:draft:discard", async () => {
  await unlink(draftPath()).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});

/** 复用已有后端或启动随应用提供的后端。 */
async function checkBackend(): Promise<void> {
  if (backendCheckDone) return;
  backendCheckDone = true;
  try {
    await startBackend(API_BASE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // 后端可用，无需提示
  } catch {
    // 后端不可用，提示用户
    void dialog.showMessageBox(mainWindow!, {
      type: "warning",
      title: "后端未连接",
      message: "无法连接到本地后端服务",
      detail: `应用已启动，但后端（${API_BASE}）不可用。\n\n清除字迹、字形切割、OCR 等功能需要后端。\n\n请另开终端运行：\n  cd services/api\n  .venv/Scripts/python.exe -m uvicorn app.main:app --port 8001\n\n或：pnpm dev:api\n\n前端编辑、导出 PNG/PDF 不需要后端，可继续使用。`,
      buttons: ["知道了"],
    });
  }
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Handwriting Layout",
    backgroundColor: "#f5f5f7",
    webPreferences: {
      // 仅通过受限 preload 桥暴露原生保存能力。
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
    },
  });

  // 外链在系统浏览器打开，非 HTTP(S) 协议不交给操作系统。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev ? url.startsWith(DEV_SERVER_URL) : url.startsWith(`${APP_ORIGIN}/`);
    if (!allowed) {
      event.preventDefault();
      openExternal(url);
    }
  });

  // 把后端地址注入到渲染进程的 window.__API_BASE__
  mainWindow.webContents.on("dom-ready", () => {
    void mainWindow?.webContents.executeJavaScript(
      `window.__API_BASE__ = ${JSON.stringify(API_BASE)};`,
    );
    // 启动后检查后端（仅一次）
    void checkBackend();
  });

  if (isDev) {
    await mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // 通过受控标准协议加载打包的 web-dist，避免 file:// 的 opaque Origin。
    await mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }
}

app.whenReady().then(() => {
  registerAppProtocol();
  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void stopBackend();
});
