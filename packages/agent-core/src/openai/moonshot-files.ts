import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { FormData } from "undici";

import { getLlmFetch } from "../llm-fetch.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";

/** Moonshot AI video understanding: uploaded via the Files API, purpose must be video. */
const DEFAULT_MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1";

const uploadCache = new Map<string, string>();

export function normalizeOpenAiCompatibleApiBase(baseUrl: string | undefined): string {
  return (baseUrl ?? "").trim().replace(/\/+$/, "");
}

export function normalizeMoonshotApiBase(baseUrl: string | undefined): string {
  return normalizeOpenAiCompatibleApiBase(baseUrl ?? DEFAULT_MOONSHOT_BASE_URL);
}

/** OpenAI-compatible Files API (purpose=video) → `ms://{fileId}`, for Moonshot and other vendors supporting Files uploads. */
export async function uploadOpenAiCompatibleVideoFile(
  config: Pick<OpenAiTransportConfig, "apiKey" | "baseUrl">,
  absolutePath: string,
): Promise<string> {
  const apiBase = normalizeOpenAiCompatibleApiBase(config.baseUrl);
  if (!apiBase) {
    throw new Error("Video upload requires baseUrl");
  }

  const metadata = await stat(absolutePath);
  const cacheKey = `${apiBase}\0${absolutePath}\0${metadata.mtimeMs}`;
  const cached = uploadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const bytes = await readFile(absolutePath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), basename(absolutePath));
  form.append("purpose", "video");

  const response = await getLlmFetch()(`${apiBase}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    // Must use undici's FormData: getLlmFetch uses the undici package's fetch, which is not the same
    // implementation as the global FormData; the global FormData would be stringified as a plain object,
    // losing the multipart boundary header (Moonshot reports Content-Type isn't multipart/form-data).
    // The global fetch types do not accept undici FormData, so this assertion bridges the gap.
    body: form as unknown as BodyInit,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Video upload failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
    throw new Error("Video upload returned no file id");
  }

  const url = `ms://${payload.id.trim()}`;
  uploadCache.set(cacheKey, url);
  return url;
}

export async function uploadMoonshotVideoFile(
  config: Pick<OpenAiTransportConfig, "apiKey" | "baseUrl">,
  absolutePath: string,
): Promise<string> {
  return uploadOpenAiCompatibleVideoFile(
    { ...config, baseUrl: config.baseUrl ?? DEFAULT_MOONSHOT_BASE_URL },
    absolutePath,
  );
}

export function clearMoonshotVideoUploadCache(): void {
  uploadCache.clear();
}

export const clearOpenAiCompatibleVideoUploadCache = clearMoonshotVideoUploadCache;
