import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { net, protocol } from "electron";

import {
  assertResolvedViewFilePath,
  parseExtensionUiUrl,
  SPIRIT_EXTENSION_UI_HOST,
} from "./extension-ui-protocol.js";

const SCHEME = "spirit";
const GENERATED_HOST = "generated";

export function registerSpiritGeneratedAssetPrivilegedScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true,
      },
    },
  ]);
}

export type ResolveManagedGeneratedAssetPath = (reference: string) => Promise<string | null>;
export type VideoPreviewMimeType = (extension: string) => string | null | undefined;
export type ImagePreviewMimeType = (extension: string) => string | null | undefined;

export function installSpiritGeneratedAssetProtocolHandler(deps: {
  resolveManagedGeneratedAssetPath: ResolveManagedGeneratedAssetPath;
  videoPreviewMimeType: VideoPreviewMimeType;
  imagePreviewMimeType: ImagePreviewMimeType;
  resolveExtensionUiRuntimePath: () => string;
  resolveExtensionViewFile: (
    extensionId: string,
    viewId: string,
  ) => Promise<{ filePath: string; extensionRoot: string } | null>;
}): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname === SPIRIT_EXTENSION_UI_HOST) {
      return handleExtensionUiRequest(url, deps);
    }
    if (url.hostname !== GENERATED_HOST) {
      return new Response("Not Found", { status: 404 });
    }

    const filePath = await deps.resolveManagedGeneratedAssetPath(request.url);
    if (!filePath) {
      return new Response("Not Found", { status: 404 });
    }

    const extension = path.extname(filePath).toLowerCase();
    const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    const kind = segments[0]?.toLowerCase();
    const mimeType =
      kind === "video"
        ? deps.videoPreviewMimeType(extension)
        : kind === "image"
          ? deps.imagePreviewMimeType(extension)
          : null;
    if (!mimeType) {
      return new Response("Unsupported Media Type", { status: 415 });
    }

    try {
      const fileResponse = await net.fetch(pathToFileURL(filePath).href, {
        method: request.method,
        headers: request.headers,
      });

      const headers = new Headers(fileResponse.headers);
      headers.set("Content-Type", mimeType);
      headers.set("Accept-Ranges", "bytes");

      return new Response(fileResponse.body, {
        status: fileResponse.status,
        statusText: fileResponse.statusText,
        headers,
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  });
}

async function handleExtensionUiRequest(
  url: URL,
  deps: {
    resolveExtensionUiRuntimePath: () => string;
    resolveExtensionViewFile: (
      extensionId: string,
      viewId: string,
    ) => Promise<{ filePath: string; extensionRoot: string } | null>;
  },
): Promise<Response> {
  const parsed = parseExtensionUiUrl(url);
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };

  if (parsed.kind === "invalid") {
    return new Response(parsed.reason, { status: 400, headers });
  }

  try {
    if (parsed.kind === "runtime") {
      const body = await readFile(deps.resolveExtensionUiRuntimePath());
      return new Response(body, {
        status: 200,
        headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" },
      });
    }

    const resolved = await deps.resolveExtensionViewFile(parsed.extensionId, parsed.viewId);
    if (!resolved) {
      return new Response("Not Found", { status: 404, headers });
    }
    const filePath = assertResolvedViewFilePath(resolved.filePath, resolved.extensionRoot);
    const body = await readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" },
    });
  } catch {
    return new Response("Not Found", { status: 404, headers });
  }
}
