import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { FormData } from "undici";

import { getLlmFetch } from "../llm-fetch.js";
import { resolveProviderEndpointUrl } from "../provider-tools/resolve.js";
import { readJsonDotPathValue } from "../provider-tools/types.js";
import type { FileUploadConfig } from "./config.js";

// The declaration shape and its validator live in ./config.js (free of Node dependencies) so the
// provider-presets loader stays importable from renderer bundles; re-exported here to keep the
// existing "@spiritagent/agent-core/file-upload" API surface unchanged.
export { FileUploadConfigError, validateFileUploadConfig } from "./config.js";
export type { FileUploadConfig } from "./config.js";

type FetchFn = typeof fetch;

export type UploadDeclaredFileResult =
  | { kind: "uploaded"; ref: string }
  /** The declared purpose map does not cover this content purpose: do not upload, go inline. */
  | { kind: "inline" }
  | { kind: "failed"; error: string };

export interface DeclaredFileUploadConnection {
  apiBase: string;
  apiKey: string;
  fetchImpl?: FetchFn;
}

const uploadCache = new Map<string, string>();

/**
 * Uploads one local file per the declaration: POST multipart/form-data with a `file` field
 * (bytes + basename), optional mapped `purpose`, and Bearer auth. Successful uploads are cached
 * by endpoint + path + mtime.
 */
export async function uploadDeclaredFile(
  config: FileUploadConfig,
  connection: DeclaredFileUploadConnection,
  absolutePath: string,
  contentPurpose?: string,
): Promise<UploadDeclaredFileResult> {
  let purposeField: string | undefined;
  if (typeof config.purpose === "string") {
    purposeField = config.purpose;
  } else if (config.purpose !== undefined) {
    const mapped = contentPurpose === undefined ? undefined : config.purpose[contentPurpose];
    if (mapped === undefined) {
      return { kind: "inline" };
    }
    purposeField = mapped;
  }

  let endpoint: string;
  try {
    endpoint = resolveProviderEndpointUrl(connection.apiBase, config);
  } catch (error) {
    return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
  }

  let metadata;
  try {
    metadata = await stat(absolutePath);
  } catch (error) {
    return {
      kind: "failed",
      error: `Cannot read the file to upload: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (config.maxBytes !== undefined && metadata.size > config.maxBytes) {
    return {
      kind: "failed",
      error: `File size ${metadata.size} bytes exceeds the ${config.maxBytes} byte upload limit.`,
    };
  }

  const cacheKey = `${endpoint}\0${absolutePath}\0${metadata.mtimeMs}`;
  const cached = uploadCache.get(cacheKey);
  if (cached !== undefined) {
    return { kind: "uploaded", ref: cached };
  }

  const bytes = await readFile(absolutePath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), basename(absolutePath));
  if (purposeField !== undefined) {
    form.append("purpose", purposeField);
  }

  const fetchImpl = connection.fetchImpl ?? getLlmFetch();
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.apiKey.trim()}`,
      },
      // Must use undici's FormData: getLlmFetch uses the undici package's fetch, which is not the same
      // implementation as the global FormData; the global FormData would be stringified as a plain object,
      // losing the multipart boundary header. The global fetch types do not accept undici FormData,
      // so this assertion bridges the gap.
      body: form as unknown as BodyInit,
    });
  } catch (error) {
    return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      kind: "failed",
      error: `File upload failed (${response.status}): ${body.trim() || response.statusText}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: "failed", error: "File upload returned a non-JSON response." };
  }

  const idPath = config.idPath?.trim() || "id";
  const rawId = readJsonDotPathValue(payload, idPath);
  const fileId =
    typeof rawId === "string" && rawId.trim().length > 0
      ? rawId.trim()
      : typeof rawId === "number" && Number.isFinite(rawId)
        ? String(rawId)
        : undefined;
  if (fileId === undefined) {
    return { kind: "failed", error: `File upload response had no file id at "${idPath}".` };
  }

  const ref = config.refTemplate.replaceAll("{id}", fileId);
  uploadCache.set(cacheKey, ref);
  return { kind: "uploaded", ref };
}

/** @internal Test helper */
export function clearDeclaredFileUploadCacheForTests(): void {
  uploadCache.clear();
}
