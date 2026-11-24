import type { Tool as ExtAppsTool } from "@modelcontextprotocol/client";
import {
  getToolUiResourceUri,
  isToolVisibilityAppOnly,
  isToolVisibilityModelOnly,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/app-bridge";

import type { JsonValue } from "../ports.js";
import { McpConfigError } from "./errors.js";

export const MCP_APP_MAX_HTML_BYTES = 10 * 1024 * 1024;
export const MCP_APP_MAX_CONCURRENCY_PER_SERVER = 4;

export type McpToolVisibility = "model" | "app";

export interface McpToolUiMeta {
  resourceUri?: string;
  visibility?: McpToolVisibility[];
  appOnly: boolean;
  modelOnly: boolean;
}

export interface McpAppResourceCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export interface McpAppResourcePermissions {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
}

export interface McpAppResourceUiMeta {
  csp?: McpAppResourceCsp;
  permissions?: McpAppResourcePermissions;
  domain?: string;
  prefersBorder?: boolean;
}

export interface McpAppResourcePayload {
  uri: string;
  mimeType: string;
  html: string;
  uiMeta?: McpAppResourceUiMeta;
}

export function isMcpAppHtmlMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) {
    return false;
  }
  const normalized = mimeType
    .toLowerCase()
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (normalized[0] !== "text/html") {
    return false;
  }
  return normalized.includes("profile=mcp-app");
}

export function isMcpAppUiResource(
  resource: { uri: string; mimeType?: string },
  referencedUiUris?: ReadonlySet<string>,
): boolean {
  if (resource.uri.startsWith("ui://")) {
    return true;
  }
  if (isMcpAppHtmlMimeType(resource.mimeType)) {
    return true;
  }
  if (referencedUiUris?.has(resource.uri)) {
    return true;
  }
  return false;
}

export function parseMcpToolUiMeta(tool: {
  _meta?: Record<string, unknown>;
}): McpToolUiMeta | undefined {
  const extTool = tool as ExtAppsTool;
  let resourceUri: string | undefined;
  try {
    resourceUri = getToolUiResourceUri(extTool);
  } catch {
    // Ignore malformed or non-ui:// resourceUri values from remote MCP servers so
    // a single bad tool entry cannot break tool discovery for the whole server.
    resourceUri = undefined;
  }
  const appOnly = isToolVisibilityAppOnly(extTool);
  const modelOnly = isToolVisibilityModelOnly(extTool);
  const rawVisibility = readRawVisibility(tool["_meta"]);

  if (!resourceUri && !appOnly && !modelOnly && !rawVisibility) {
    return undefined;
  }

  return {
    ...(resourceUri ? { resourceUri } : {}),
    ...(rawVisibility ? { visibility: rawVisibility } : {}),
    appOnly,
    modelOnly,
  };
}

export function extractResourceUriFromToolResult(result: JsonValue): string | undefined {
  if (!isRecord(result) || !isRecord(result["_meta"])) {
    return undefined;
  }
  const meta = result["_meta"];
  if (isRecord(meta.ui) && typeof meta.ui.resourceUri === "string") {
    const uri = meta.ui.resourceUri.trim();
    if (uri.startsWith("ui://")) {
      return uri;
    }
  }
  if (typeof meta["ui/resourceUri"] === "string") {
    const uri = meta["ui/resourceUri"].trim();
    if (uri.startsWith("ui://")) {
      return uri;
    }
  }
  return undefined;
}

export function parseMcpAppResourceResult(
  requestedUri: string,
  result: JsonValue,
): McpAppResourcePayload {
  if (!isRecord(result) || !Array.isArray(result.contents) || result.contents.length === 0) {
    throw new McpConfigError(`MCP App resource returned no contents: ${requestedUri}`);
  }

  const first = result.contents.find(
    (entry) =>
      isRecord(entry) && (typeof entry.text === "string" || typeof entry.blob === "string"),
  );
  if (!isRecord(first)) {
    throw new McpConfigError(`MCP App resource has no readable HTML payload: ${requestedUri}`);
  }

  const uri = typeof first.uri === "string" && first.uri.trim() ? first.uri.trim() : requestedUri;
  const mimeType =
    typeof first.mimeType === "string" && first.mimeType.trim()
      ? first.mimeType.trim()
      : RESOURCE_MIME_TYPE;

  let html: string;
  if (typeof first.text === "string") {
    html = first.text;
  } else if (typeof first.blob === "string") {
    html = Buffer.from(first.blob, "base64").toString("utf8");
  } else {
    throw new McpConfigError(`MCP App resource has no HTML text or blob: ${uri}`);
  }

  if (Buffer.byteLength(html, "utf8") > MCP_APP_MAX_HTML_BYTES) {
    throw new McpConfigError(
      `MCP App resource exceeds maximum size of ${MCP_APP_MAX_HTML_BYTES} bytes: ${uri}`,
    );
  }

  const uiMeta = parseMcpAppResourceUiMeta(first["_meta"]);
  return {
    uri,
    mimeType,
    html,
    ...(uiMeta ? { uiMeta } : {}),
  };
}

export function parseMcpAppResourceUiMeta(meta: unknown): McpAppResourceUiMeta | undefined {
  if (!isRecord(meta) || !isRecord(meta.ui)) {
    return undefined;
  }
  const ui = meta.ui;
  const csp = parseCsp(ui.csp);
  const permissions = parsePermissions(ui.permissions);
  const domain = typeof ui.domain === "string" && ui.domain.trim() ? ui.domain.trim() : undefined;
  const prefersBorder = typeof ui.prefersBorder === "boolean" ? ui.prefersBorder : undefined;

  if (!csp && !permissions && domain === undefined && prefersBorder === undefined) {
    return undefined;
  }

  return {
    ...(csp ? { csp } : {}),
    ...(permissions ? { permissions } : {}),
    ...(domain !== undefined ? { domain } : {}),
    ...(prefersBorder !== undefined ? { prefersBorder } : {}),
  };
}

function readRawVisibility(
  meta: Record<string, unknown> | undefined,
): McpToolVisibility[] | undefined {
  if (!meta || !isRecord(meta.ui) || !Array.isArray(meta.ui.visibility)) {
    return undefined;
  }
  const filtered = meta.ui.visibility.filter(
    (entry): entry is McpToolVisibility => entry === "model" || entry === "app",
  );
  return filtered.length > 0 ? filtered : undefined;
}

function parseCsp(value: unknown): McpAppResourceCsp | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const connectDomains = readStringArray(value.connectDomains);
  const resourceDomains = readStringArray(value.resourceDomains);
  const frameDomains = readStringArray(value.frameDomains);
  const baseUriDomains = readStringArray(value.baseUriDomains);
  if (!connectDomains && !resourceDomains && !frameDomains && !baseUriDomains) {
    return undefined;
  }
  return {
    ...(connectDomains ? { connectDomains } : {}),
    ...(resourceDomains ? { resourceDomains } : {}),
    ...(frameDomains ? { frameDomains } : {}),
    ...(baseUriDomains ? { baseUriDomains } : {}),
  };
}

function parsePermissions(value: unknown): McpAppResourcePermissions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: McpAppResourcePermissions = {};
  if (isRecord(value.camera)) out.camera = {};
  if (isRecord(value.microphone)) out.microphone = {};
  if (isRecord(value.geolocation)) out.geolocation = {};
  if (isRecord(value.clipboardWrite)) out.clipboardWrite = {};
  return Object.keys(out).length > 0 ? out : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return strings.length > 0 ? strings : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
