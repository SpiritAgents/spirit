import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cloneLlmProviderState,
  llmMessageHasMedia,
  llmMessageTextContent,
  type JsonObject,
  type JsonValue,
  type LlmMessage,
} from "../ports.js";
import { uploadDeclaredFile } from "../file-upload/uploader.js";
import type { FileUploadConfig } from "../file-upload/config.js";
import { getLlmFetch } from "../llm-fetch.js";
import {
  pathToLocalVideoReference,
  resolveLocalMediaPath,
} from "./openai-multimodal-media-path.js";

export function llmHistoryToOpenAiMessages(
  history: LlmMessage[],
  assetRoot = process.cwd(),
): JsonObject[] {
  return history.map((message) => llmMessageToOpenAiMessage(message, assetRoot));
}

export function llmMessageToOpenAiMessage(message: LlmMessage, assetRoot: string): JsonObject {
  if (
    message.role === "assistant" &&
    Array.isArray(message.toolCalls) &&
    message.toolCalls.length > 0
  ) {
    const textContent = llmMessageTextContent(message.content);
    return {
      ...llmMessageProviderState(message),
      role: "assistant",
      content: textContent.length > 0 ? textContent : null,
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: toolCall.argumentsJson,
        },
      })),
    };
  }

  if (message.role === "user" && llmMessageHasMedia(message.content)) {
    const parts: JsonValue[] = [];

    for (const part of message.content) {
      if (part.type === "text" && part.text.length > 0) {
        parts.push({ type: "text", text: part.text });
        continue;
      }

      if (part.type === "image") {
        parts.push({
          type: "image_url",
          image_url: {
            url: pathToImageUrl(part.path, assetRoot),
          },
        });
        continue;
      }

      if (part.type === "video") {
        parts.push({
          type: "video_url",
          video_url: {
            url: pathToLocalVideoReference(part.path, assetRoot),
          },
        });
        continue;
      }

      if (part.type === "audio" || part.type === "document") {
        const path = resolveLocalMediaPath(part.path, assetRoot);
        parts.push({
          type: "local_file",
          local_file: {
            path,
            filename: basename(path),
            mediaType: part.type === "document" ? "application/pdf" : audioMediaType(path),
            assetKind: part.type,
          },
        });
      }
    }

    if (parts.length === 0) {
      return { role: message.role, content: "" };
    }

    return {
      role: message.role,
      content: parts,
    };
  }

  return {
    ...llmMessageProviderState(message),
    role: message.role,
    content: llmMessageTextContent(message.content),
    ...(message.toolCallId !== undefined ? { tool_call_id: message.toolCallId } : {}),
  };
}

function audioMediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".ogg":
      return "audio/ogg";
    case ".flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

/** Minimal structural read of a transport config for declaration-driven media resolution. */
export interface DeclaredMediaConfig {
  apiKey: string;
  baseUrl?: string;
  fileUpload?: FileUploadConfig;
  modelCapabilities?: { imageInput?: true; videoInput?: true };
  options?: Record<string, unknown>;
}

const INLINE_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/bmp",
  "image/gif",
  "image/x-icon",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function supportedInlineImageMime(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const mime = value.split(";", 1)[0]?.trim().toLowerCase();
  if (mime === "image/jpg") {
    return "image/jpeg";
  }
  return mime !== undefined && INLINE_IMAGE_MIME_TYPES.has(mime) ? mime : undefined;
}

function inlineImageDataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function readInlineImageFile(path: string): string {
  const mimeType = supportedInlineImageMime(guessImageMimeFromPath(path));
  if (mimeType === undefined) {
    throw new Error(`Unsupported inline image format for ${path}.`);
  }
  return inlineImageDataUrl(mimeType, readFileSync(path));
}

async function downloadInlineImage(url: string): Promise<string> {
  const response = await getLlmFetch()(url);
  if (!response.ok) {
    throw new Error(`Image download failed (HTTP ${String(response.status)}).`);
  }
  const mimeType =
    supportedInlineImageMime(response.headers.get("content-type")) ??
    supportedInlineImageMime(guessImageMimeFromPath(new URL(url).pathname));
  if (mimeType === undefined) {
    throw new Error("The remote image content type is not supported for inline image input.");
  }
  return inlineImageDataUrl(mimeType, new Uint8Array(await response.arrayBuffer()));
}

/**
 * `options.inlineImageInput`: resolve local files and supported remote images to base64 data URLs
 * before AI SDK serialization. This declaration is for Chat Completions providers that reject
 * external image URLs and file IDs; no provider identity is consulted on the runtime path.
 */
export async function resolveDeclaredImageInputsInMessages(
  config: DeclaredMediaConfig,
  messages: JsonValue[],
  assetRoot = process.cwd(),
): Promise<void> {
  if (config.options?.inlineImageInput !== true || config.modelCapabilities?.imageInput !== true) {
    return;
  }

  for (const message of messages) {
    if (!isJsonObject(message) || message.role !== "user" || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (!isJsonObject(part) || part.type !== "image_url") {
        continue;
      }
      const rawImageUrl = part.image_url;
      if (typeof rawImageUrl !== "object" || rawImageUrl === null || Array.isArray(rawImageUrl)) {
        continue;
      }
      if (typeof rawImageUrl.url !== "string") {
        if (rawImageUrl.file_id !== undefined) {
          throw new Error(
            "This provider accepts images only as base64 data URLs; file IDs are not supported.",
          );
        }
        continue;
      }

      const url = rawImageUrl.url.trim();
      if (!url) {
        continue;
      }
      if (/^data:/i.test(url)) {
        const mimeType = supportedInlineImageMime(url.slice(5).split(";", 1)[0]);
        if (mimeType === undefined || !/^data:[^;]+;base64,/i.test(url)) {
          throw new Error("Inline images must use a supported base64 image data URL.");
        }
        continue;
      }
      if (/^https?:\/\//i.test(url)) {
        rawImageUrl.url = await downloadInlineImage(url);
        continue;
      }
      if (/^file:\/\//i.test(url)) {
        rawImageUrl.url = readInlineImageFile(fileURLToPath(url));
        continue;
      }
      if (urlHasWireScheme(url)) {
        throw new Error(
          "This provider accepts images only as local files, HTTP(S) images, or base64 data URLs.",
        );
      }
      rawImageUrl.url = readInlineImageFile(resolveLocalMediaPath(url, assetRoot));
    }
  }
}

/**
 * A URL already carrying a wire scheme (`https://`, `data:`, or an upstream reference scheme such
 * as `ms://` / `stepfile://` / `mm_file://`) passes through literally; anything else is a local
 * path. Windows drive letters (`C:\…`) are not schemes.
 */
function urlHasWireScheme(url: string): boolean {
  return /^data:/i.test(url) || /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

/**
 * `options.maxInlineMediaBytes`: cap on the base64-encoded inline payload size, enforced before
 * the data URL is built (Xiaomi MiMo's 50 MB inline-video limit is the declaring preset).
 */
function readMaxInlineMediaBytes(config: DeclaredMediaConfig): number | undefined {
  const value = config.options?.maxInlineMediaBytes;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function formatInlineMediaCapMb(maxBytes: number): string {
  const mb = maxBytes / (1024 * 1024);
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
}

function pathToInlineVideoDataUrl(absolutePath: string, maxInlineMediaBytes?: number): string {
  const bytes = readFileSync(absolutePath);
  const base64 = Buffer.from(bytes).toString("base64");
  if (
    maxInlineMediaBytes !== undefined &&
    Buffer.byteLength(base64, "utf8") > maxInlineMediaBytes
  ) {
    throw new Error(
      `Inline video must not exceed ${formatInlineMediaCapMb(maxInlineMediaBytes)} MB after Base64 encoding (the provider entry's options.maxInlineMediaBytes); use a public URL or shorten the video instead.`,
    );
  }
  return `data:${guessVideoMimeFromPath(absolutePath)};base64,${base64}`;
}

function guessVideoMimeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".avi":
      return "video/x-msvideo";
    case ".wmv":
      return "video/x-ms-wmv";
    default:
      return "video/mp4";
  }
}

/**
 * Declaration-driven video input resolution: with a `fileUpload` declaration, local video files
 * upload through it and the produced reference (e.g. `ms://{id}`) goes into the `video_url` field
 * verbatim; when the declared purpose map does not cover `"video"`, or there is no declaration at
 * all, the transport's generic base64 inline path applies. Upload failures throw (a turn error,
 * as before).
 */
export async function resolveDeclaredVideoInputsInMessages(
  config: DeclaredMediaConfig,
  messages: JsonValue[],
  assetRoot = process.cwd(),
): Promise<void> {
  if (config.modelCapabilities?.videoInput !== true) {
    return;
  }
  const maxInlineMediaBytes = readMaxInlineMediaBytes(config);

  for (const message of messages) {
    if (!isJsonObject(message) || message.role !== "user" || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (!isJsonObject(part) || part.type !== "video_url") {
        continue;
      }

      const rawVideoUrl = part["video_url"];
      if (typeof rawVideoUrl !== "object" || rawVideoUrl === null || Array.isArray(rawVideoUrl)) {
        continue;
      }

      const urlValue = rawVideoUrl["url"];
      if (typeof urlValue !== "string") {
        continue;
      }

      const url = urlValue.trim();
      if (url.length === 0 || urlHasWireScheme(url)) {
        continue;
      }

      const absolutePath = resolveLocalMediaPath(url, assetRoot);
      if (config.fileUpload !== undefined) {
        const upload = await uploadDeclaredFile(
          config.fileUpload,
          { apiBase: config.baseUrl ?? "", apiKey: config.apiKey },
          absolutePath,
          "video",
        );
        if (upload.kind === "failed") {
          throw new Error(upload.error);
        }
        if (upload.kind === "uploaded") {
          rawVideoUrl["url"] = upload.ref;
          continue;
        }
        // kind === "inline": the purpose map does not cover video — fall through to inline.
      }
      rawVideoUrl["url"] = pathToInlineVideoDataUrl(absolutePath, maxInlineMediaBytes);
    }
  }
}

function pathToImageUrl(path: string, assetRoot: string): string {
  const normalized = path.trim();
  if (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("file://")
  ) {
    return normalized;
  }

  const absolutePath = resolveLocalMediaPath(normalized, assetRoot);
  const mime = guessImageMimeFromPath(absolutePath);

  try {
    const bytes = readFileSync(absolutePath);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return toFileUrl(absolutePath);
  }
}

function toFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

function guessImageMimeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

function llmMessageProviderState(message: LlmMessage): JsonObject {
  if (message.providerState === undefined) {
    return {};
  }

  return cloneLlmProviderState(message.providerState);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
