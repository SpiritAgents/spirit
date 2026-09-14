import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { FormData } from "undici";

import { getLlmFetch } from "../llm-fetch.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";
import { normalizeOpenAiCompatibleApiBase } from "./moonshot-files.js";

/**
 * MiniMax video understanding: uploaded via the Files API, purpose must be video_understanding.
 * Docs: https://platform.minimaxi.com/docs/api-reference/file-management-upload
 * Image upload is left for a later unification pass; it does not use the Files API here.
 */
const DEFAULT_MINIMAX_FILES_API_BASE = "https://api.minimax.io/v1";

const uploadCache = new Map<string, string>();

/** Derives the Files API root (`.../v1`) from the Chat / Anthropic baseUrl. */
export function normalizeMinimaxFilesApiBase(baseUrl: string | undefined): string {
  const trimmed = normalizeOpenAiCompatibleApiBase(baseUrl ?? DEFAULT_MINIMAX_FILES_API_BASE);
  if (!trimmed) {
    return DEFAULT_MINIMAX_FILES_API_BASE;
  }

  const withoutAnthropic = trimmed.replace(/\/anthropic\/v1$/i, "/v1");
  if (withoutAnthropic !== trimmed) {
    return withoutAnthropic;
  }

  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export async function uploadMinimaxVideoFile(
  config: Pick<OpenAiTransportConfig, "apiKey" | "baseUrl">,
  absolutePath: string,
): Promise<string> {
  const apiBase = normalizeMinimaxFilesApiBase(config.baseUrl);
  if (!apiBase) {
    throw new Error("MiniMax video upload requires baseUrl");
  }

  const metadata = await stat(absolutePath);
  const cacheKey = `${absolutePath}\0${metadata.mtimeMs}`;
  const cached = uploadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const bytes = await readFile(absolutePath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), basename(absolutePath));
  form.append("purpose", "video_understanding");

  const response = await getLlmFetch()(`${apiBase}/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    // Must use undici's FormData: getLlmFetch uses the undici package's fetch, which is not the same
    // implementation as the global FormData; the global FormData would be stringified as a plain object,
    // losing the multipart boundary header (MiniMax reports 2013).
    // The global fetch types do not accept undici FormData, so this assertion bridges the gap.
    body: form as unknown as BodyInit,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MiniMax video upload failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as unknown;
  const fileId = readMinimaxUploadedFileId(payload);
  if (!fileId) {
    throw new Error("MiniMax video upload returned no file id");
  }

  const url = `mm_file://${fileId}`;
  uploadCache.set(cacheKey, url);
  return url;
}

/**
 * MiniMax Files API: `{ file: { file_id: <int64> } }`. `file.file_id` is the unique identifier.
 * Docs: https://platform.minimaxi.com/docs/api-reference/file-management-upload
 */
function readMinimaxUploadedFileId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const root = payload as Record<string, unknown>;
  const file =
    typeof root.file === "object" && root.file !== null && !Array.isArray(root.file)
      ? (root.file as Record<string, unknown>)
      : undefined;
  const fileId = file?.file_id;
  if (typeof fileId === "number" && Number.isFinite(fileId)) {
    return String(fileId);
  }
  return undefined;
}

export function clearMinimaxVideoUploadCache(): void {
  uploadCache.clear();
}
