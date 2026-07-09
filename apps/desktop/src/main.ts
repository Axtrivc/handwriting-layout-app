/**
 * Electron 主进程入口。
 *
 * 职责：创建 BrowserWindow，加载前端（开发模式连 Vite，生产模式加载 web 构建产物），
 * 并把后端地址注入到渲染进程的 window.__API_BASE__。
 */
import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

// 是否开发模式：由环境变量控制
const isDev = !!process.env.HW_DEV;
// 前端 dev server 地址
const DEV_SERVER_URL = process.env.HW_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
// 后端 FastAPI 地址，注入到渲染进程
const API_BASE = process.env.HW_API_BASE ?? "http://127.0.0.1:8001";

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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
  });

  if (isDev) {
    await mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const file = join(__dirname, "..", "..", "web", "dist", "index.html");
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
