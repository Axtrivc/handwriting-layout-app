/**
 * Electron 主进程入口。
 *
 * 职责：创建 BrowserWindow，加载前端（dev 连 Vite、prod 加载 web 构建产物），
 * 注入后端地址，并在启动时检查后端是否可用（方案 A：不可用时提示用户）。
 */
import { app, BrowserWindow, shell, dialog } from "electron";
import { join } from "node:path";

// 是否开发模式：由环境变量控制
const isDev = !!process.env.HW_DEV;
// 前端 dev server 地址
const DEV_SERVER_URL = process.env.HW_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
// 后端 FastAPI 地址，注入到渲染进程
const API_BASE = process.env.HW_API_BASE ?? "http://127.0.0.1:8001";

let mainWindow: BrowserWindow | null = null;
let backendCheckDone = false;

/** 检查后端是否可用（方案 A：仅提示，不自动拉起）。 */
async function checkBackend(): Promise<void> {
  if (backendCheckDone) return;
  backendCheckDone = true;
  try {
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
      // MVP 阶段关闭 nodeIntegration，保持 contextIsolation
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 外链在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
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
    // 生产模式：加载 web 构建产物
    // 打包后：web-dist 在 process.resourcesPath（electron-builder extraResources）
    // 开发仓库：apps/web/dist 相对 apps/desktop/dist
    let file: string;
    if (app.isPackaged) {
      file = join(process.resourcesPath, "web-dist", "index.html");
    } else {
      file = join(__dirname, "..", "..", "web", "dist", "index.html");
    }
    await mainWindow.loadFile(file);
  }
}

app.whenReady().then(() => {
  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
