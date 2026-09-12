import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { FormData } from "undici";

import { getLlmFetch } from "../llm-fetch.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";
import { normalizeOpenAiCompatibleApiBase } from "./moonshot-files.js";

/**
 * StepFun video understanding: uploaded via the Files API, purpose must be storage.
 * Docs: https://platform.stepfun.com/docs/zh/api-reference/files/create
 * Local images stay on the Base64 image_url path and are not uploaded here.
 */
const DEFAULT_STEPFUN_FILES_API_BASE = "https://api.stepfun.com/v1";
const STEPFUN_VIDEO_UPLOAD_MAX_BYTES = 128 * 1024 * 1024;

const uploadCache = new Map<string, string>();

export function normalizeStepfunFilesApiBase(baseUrl: string | undefined): string {
  const trimmed = normalizeOpenAiCompatibleApiBase(baseUrl ?? DEFAULT_STEPFUN_FILES_API_BASE);
  return trimmed || DEFAULT_STEPFUN_FILES_API_BASE;
}

export async function uploadStepfunVideoFile(
  config: Pick<OpenAiTransportConfig, "apiKey" | "baseUrl">,
  absolutePath: string,
): Promise<string> {
  const apiBase = normalizeStepfunFilesApiBase(config.baseUrl);
  const metadata = await stat(absolutePath);
  if (metadata.size > STEPFUN_VIDEO_UPLOAD_MAX_BYTES) {
    throw new Error("StepFun video upload exceeds the 128 MB limit");
  }

  const cacheKey = `${absolutePath}\0${metadata.mtimeMs}`;
  const cached = uploadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const bytes = await readFile(absolutePath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), basename(absolutePath));
  form.append("purpose", "storage");

  const response = await getLlmFetch()(`${apiBase}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    // Must use undici's FormData: getLlmFetch uses the undici package's fetch, which is not the same
    // implementation as the global FormData; the global FormData would be stringified as a plain object,
    // losing the multipart boundary header.
    // The global fetch types do not accept undici FormData, so this assertion bridges the gap.
    body: form as unknown as BodyInit,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`StepFun video upload failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
    throw new Error("StepFun video upload returned no file id");
  }

  const url = `stepfile://${payload.id.trim()}`;
  uploadCache.set(cacheKey, url);
  return url;
}

export function clearStepfunVideoUploadCache(): void {
  uploadCache.clear();
}
