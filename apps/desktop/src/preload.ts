import { contextBridge, ipcRenderer } from "electron";

export interface DesktopSaveResult {
  status: "saved" | "canceled";
  path?: string;
}

export interface DesktopDraft {
  contents: string;
  updatedAt: string;
}

contextBridge.exposeInMainWorld("__HW_DESKTOP__", {
  saveProject: (payload: { filename: string; contents: string }): Promise<DesktopSaveResult> =>
    ipcRenderer.invoke("project:save", payload),
  writeDraft: (payload: { contents: string }): Promise<{ status: "saved"; updatedAt: string }> =>
    ipcRenderer.invoke("project:draft:write", payload),
  readDraft: (): Promise<DesktopDraft | null> => ipcRenderer.invoke("project:draft:read"),
  discardDraft: (): Promise<void> => ipcRenderer.invoke("project:draft:discard"),
});
