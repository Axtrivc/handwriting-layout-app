import { app, net, protocol } from "electron";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const APP_ORIGIN = "hw-app://app";
const APP_SCHEME = "hw-app";

export function registerPrivilegedAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  }]);
}

function webRoot(): string {
  return app.isPackaged
    ? resolve(process.resourcesPath, "web-dist")
    : resolve(__dirname, "..", "..", "web", "dist");
}

export async function handleAppRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== "app") {
    return new Response("Not found", { status: 404 });
  }
  let relative: string;
  try {
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  } catch {
    return new Response("Invalid path", { status: 400 });
  }
  if (relative.includes("\0")) return new Response("Invalid path", { status: 400 });
  const root = webRoot();
  const file = resolve(root, relative);
  if (!file.startsWith(`${root}${sep}`)) return new Response("Forbidden", { status: 403 });
  try {
    return await net.fetch(pathToFileURL(file).toString());
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, handleAppRequest);
}
