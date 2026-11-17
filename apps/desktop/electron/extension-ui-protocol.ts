import { readFile } from "node:fs/promises";
import path from "node:path";

import { product } from "@spiritagent/product";

export const SPIRIT_EXTENSION_UI_HOST = "extension-ui";

export type ExtensionUiProtocolRequest =
  | { kind: "page-runtime" }
  | {
      kind: "tab" | "view";
      extensionId: string;
      contributionId: string;
      instanceId: string;
      assetPath: string;
    }
  | { kind: "tab-icon"; extensionId: string; iconPath: string }
  | { kind: "invalid"; reason: string };

export function parseExtensionUiUrl(url: URL): ExtensionUiProtocolRequest {
  if (url.hostname !== SPIRIT_EXTENSION_UI_HOST) {
    return { kind: "invalid", reason: "unexpected host" };
  }

  const pathname = url.pathname.replace(/^\/+/u, "");
  if (pathname === "page-runtime.js") {
    return { kind: "page-runtime" };
  }
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "tab" || segments[0] === "view") {
    if (segments.length < 5) {
      return { kind: "invalid", reason: "missing page identity" };
    }
    const extensionId = decodeSegment(segments[1]!);
    const contributionId = decodeSegment(segments[2]!);
    const instanceId = decodeSegment(segments[3]!);
    const assetSegments = segments.slice(4).map(decodeSegment);
    if (
      !isSafeExtensionId(extensionId) ||
      !isSafeContributionId(contributionId) ||
      !isSafeIdentitySegment(instanceId) ||
      !isSafeRelativeAssetPath(assetSegments)
    ) {
      return { kind: "invalid", reason: "illegal page identity or asset path" };
    }
    return {
      kind: segments[0],
      extensionId,
      contributionId,
      instanceId,
      assetPath: assetSegments.join("/"),
    };
  }
  if (segments[0] === "tab-icon") {
    if (segments.length < 3) {
      return { kind: "invalid", reason: "missing tab icon identity" };
    }
    const extensionId = decodeSegment(segments[1]!);
    const iconSegments = segments.slice(2).map(decodeSegment);
    if (!isSafeExtensionId(extensionId) || !isSafeRelativeAssetPath(iconSegments)) {
      return { kind: "invalid", reason: "illegal tab icon identity" };
    }
    return { kind: "tab-icon", extensionId, iconPath: iconSegments.join("/") };
  }
  return { kind: "invalid", reason: "unknown path" };
}

function isSafeIdentitySegment(part: string): boolean {
  return (
    part.length > 0 && part !== "." && part !== ".." && !part.includes("\\") && !part.includes("/")
  );
}

/** Composite identity: `<sourceId>/<name>`. */
function isSafeExtensionId(value: string): boolean {
  if (value.includes("\\") || value.includes("..")) {
    return false;
  }
  const parts = value.split("/");
  return parts.length >= 2 && parts.every(isSafeIdentitySegment);
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function isSafeContributionId(value: string): boolean {
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(value);
}

function isSafeRelativeAssetPath(segments: readonly string[]): boolean {
  return (
    segments.length > 0 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !segment.includes("\\") &&
        !segment.includes("/") &&
        !segment.includes("\0"),
    )
  );
}

export function injectExtensionPageRuntime(html: string): string {
  const runtime = `<script src="${product.urlProtocol}://extension-ui/page-runtime.js"></script>`;
  if (/<head(?:\s[^>]*)?>/iu.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/iu, (head) => `${head}${runtime}`);
  }
  return `${runtime}${html}`;
}

export function shouldBlockExtensionTabNavigation(currentUrl: string, targetUrl: string): boolean {
  return (
    (currentUrl.startsWith(`${product.urlProtocol}://extension-ui/tab/`) ||
      currentUrl.startsWith(`${product.urlProtocol}://extension-ui/view/`)) &&
    targetUrl !== currentUrl
  );
}

export const EXTENSION_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const EXTENSION_ASSET_MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export function extensionAssetMimeType(filePath: string): string {
  return (
    EXTENSION_ASSET_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
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
