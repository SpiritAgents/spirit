import { readFileSync } from "node:fs";
import { extname } from "node:path";

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

/** Minimal structural read of a transport config for declaration-driven media resolution. */
export interface DeclaredMediaConfig {
  apiKey: string;
  baseUrl?: string;
  fileUpload?: FileUploadConfig;
  modelCapabilities?: { videoInput?: true };
}

/**
 * A URL already carrying a wire scheme (`https://`, `data:`, or an upstream reference scheme such
 * as `ms://` / `stepfile://` / `mm_file://`) passes through literally; anything else is a local
 * path. Windows drive letters (`C:\…`) are not schemes.
 */
function urlHasWireScheme(url: string): boolean {
  return /^data:/i.test(url) || /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

function pathToInlineVideoDataUrl(absolutePath: string): string {
  const bytes = readFileSync(absolutePath);
  const base64 = Buffer.from(bytes).toString("base64");
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
      rawVideoUrl["url"] = pathToInlineVideoDataUrl(absolutePath);
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
