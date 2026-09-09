import { readFile } from "node:fs/promises";
import path from "node:path";

export const SPIRIT_EXTENSION_UI_HOST = "extension-ui";

export type ExtensionUiProtocolRequest =
  | { kind: "runtime" }
  | { kind: "view"; extensionId: string; viewId: string }
  | { kind: "invalid"; reason: string };

export function parseExtensionUiUrl(url: URL): ExtensionUiProtocolRequest {
  if (url.hostname !== SPIRIT_EXTENSION_UI_HOST) {
    return { kind: "invalid", reason: "unexpected host" };
  }

  const pathname = url.pathname.replace(/^\/+/u, "");
  if (pathname === "runtime.js") {
    return { kind: "runtime" };
  }
  if (pathname === "view") {
    const extensionId = url.searchParams.get("extensionId")?.trim() ?? "";
    const viewId = url.searchParams.get("viewId")?.trim() ?? "";
    if (!extensionId || !viewId) {
      return { kind: "invalid", reason: "missing view identity" };
    }
    if (!isSafeExtensionId(extensionId) || !isSafeViewId(viewId)) {
      return { kind: "invalid", reason: "illegal view identity" };
    }
    return { kind: "view", extensionId, viewId };
  }

  return { kind: "invalid", reason: "unknown path" };
}

function isSafeIdentitySegment(part: string): boolean {
  return part.length > 0 && part !== "." && part !== ".." && !part.includes("\\");
}

/** Composite identity: `<sourceId>/<name>`. */
function isSafeExtensionId(value: string): boolean {
  if (value.includes("\\") || value.includes("..")) {
    return false;
  }
  const parts = value.split("/");
  return parts.length >= 2 && parts.every(isSafeIdentitySegment);
}

function isSafeViewId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

export function assertResolvedViewFilePath(filePath: string, extensionRoot: string): string {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(extensionRoot);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Extension view path escapes the extension directory.");
  }
  return resolvedFile;
}

export async function readExtensionUiRuntime(runtimeFilePath: string): Promise<string> {
  return readFile(runtimeFilePath, "utf8");
}
