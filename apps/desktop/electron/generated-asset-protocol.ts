import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { net, protocol } from "electron";
import { product } from "@spiritagent/product";

import {
  assertResolvedViewFilePath,
  injectExtensionPageRuntime,
  extensionAssetMimeType,
  EXTENSION_PAGE_CSP,
  parseExtensionUiUrl,
  SPIRIT_EXTENSION_UI_HOST,
} from "./extension-ui-protocol.js";

const SCHEME = product.urlProtocol;
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
      },
    },
  ]);
}

export type ResolveManagedGeneratedAssetPath = (reference: string) => Promise<string | null>;
export type VideoPreviewMimeType = (extension: string) => string | null | undefined;
export type ImagePreviewMimeType = (extension: string) => string | null | undefined;

type ResolvedExtensionFile = { filePath: string; extensionRoot: string };

export interface ExtensionUiHandlerDeps {
  resolveExtensionPageRuntimePath: () => string;
  resolveExtensionViewFile: (
    extensionId: string,
    viewId: string,
  ) => Promise<ResolvedExtensionFile | null>;
  resolveExtensionTabFile: (
    extensionId: string,
    contributionId: string,
  ) => Promise<ResolvedExtensionFile | null>;
  resolveExtensionTabIconFile: (
    extensionId: string,
    iconPath: string,
  ) => Promise<ResolvedExtensionFile | null>;
}

export function installSpiritGeneratedAssetProtocolHandler(deps: {
  resolveManagedGeneratedAssetPath: ResolveManagedGeneratedAssetPath;
  videoPreviewMimeType: VideoPreviewMimeType;
  imagePreviewMimeType: ImagePreviewMimeType;
  resolveExtensionViewFile: (
    extensionId: string,
    viewId: string,
  ) => Promise<{ filePath: string; extensionRoot: string } | null>;
  resolveExtensionPageRuntimePath: () => string;
  resolveExtensionTabFile: ExtensionUiHandlerDeps["resolveExtensionTabFile"];
  resolveExtensionTabIconFile: ExtensionUiHandlerDeps["resolveExtensionTabIconFile"];
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
    resolveExtensionPageRuntimePath: () => string;
    resolveExtensionViewFile: (
      extensionId: string,
      viewId: string,
    ) => Promise<ResolvedExtensionFile | null>;
    resolveExtensionTabFile: ExtensionUiHandlerDeps["resolveExtensionTabFile"];
    resolveExtensionTabIconFile: ExtensionUiHandlerDeps["resolveExtensionTabIconFile"];
  },
): Promise<Response> {
  const parsed = parseExtensionUiUrl(url);
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (parsed.kind === "invalid") {
    return new Response(parsed.reason, { status: 400, headers });
  }

  try {
    if (parsed.kind === "page-runtime") {
      const runtimePath = deps.resolveExtensionPageRuntimePath();
      const body = await readFile(runtimePath);
      return new Response(body, {
        status: 200,
        headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" },
      });
    }

    if (parsed.kind === "tab" || parsed.kind === "view") {
      const resolve =
        parsed.kind === "tab" ? deps.resolveExtensionTabFile : deps.resolveExtensionViewFile;
      const resolved = await resolve(parsed.extensionId, parsed.contributionId);
      if (!resolved) {
        return new Response("Not Found", { status: 404, headers });
      }
      const filePath =
        parsed.assetPath === "index.html"
          ? resolved.filePath
          : path.join(path.dirname(resolved.filePath), ...parsed.assetPath.split("/"));
      assertResolvedViewFilePath(filePath, resolved.extensionRoot);
      if (parsed.assetPath === "index.html") {
        const body = injectExtensionPageRuntime(await readFile(filePath, "utf8"));
        return new Response(body, {
          status: 200,
          headers: {
            ...headers,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": EXTENSION_PAGE_CSP,
          },
        });
      }
      const body = await readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": extensionAssetMimeType(filePath),
        },
      });
    }

    if (parsed.kind === "tab-icon") {
      const resolved = await deps.resolveExtensionTabIconFile(parsed.extensionId, parsed.iconPath);
      if (!resolved) {
        return new Response("Not Found", { status: 404, headers });
      }
      const filePath = assertResolvedViewFilePath(resolved.filePath, resolved.extensionRoot);
      const body = await readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": extensionAssetMimeType(filePath),
          ...(filePath.toLowerCase().endsWith(".svg")
            ? { "Content-Security-Policy": "default-src 'none'; script-src 'none'" }
            : {}),
        },
      });
    }

    return new Response("Not Found", { status: 404, headers });
  } catch {
    return new Response("Not Found", { status: 404, headers });
  }
}
