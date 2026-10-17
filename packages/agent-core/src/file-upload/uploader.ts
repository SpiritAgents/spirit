import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { FormData } from "undici";

import { getLlmFetch } from "../llm-fetch.js";
import { resolveProviderEndpointUrl } from "../provider-tools/resolve.js";
import { isPlainJsonObject, readJsonDotPathValue } from "../provider-tools/types.js";

type FetchFn = typeof fetch;

/**
 * Purpose-agnostic upload declaration (`fileUpload`): uploads a local file that should not go
 * inline and yields the reference the upstream server resolves (`refTemplate`).
 */
export interface FileUploadConfig {
  /** Upload path joined onto the provider `apiBase`; overridden by `url`. */
  path?: string;
  /** Absolute upload URL; overrides `path`. At least one of `path` / `url` is required. */
  url?: string;
  /**
   * `purpose` form field: a string is sent for every content purpose; a map sends the mapped value
   * for the given content purpose, and a purpose absent from the map is not uploaded (goes inline);
   * absent = no purpose field is sent.
   */
  purpose?: string | Record<string, string>;
  /** Dot path of the file id in the upload response JSON; defaults to `"id"`. */
  idPath?: string;
  /** Reference template; must contain `{id}` (e.g. `ms://{id}`). */
  refTemplate: string;
  /** Local pre-upload size limit; exceeding it fails the upload. */
  maxBytes?: number;
}

export class FileUploadConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileUploadConfigError";
  }
}

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

function hasNonBlankString(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0;
}

/** Fail-fast validation of a `fileUpload` declaration. */
export function validateFileUploadConfig(config: unknown): FileUploadConfig {
  const context = "fileUpload";
  if (!isPlainJsonObject(config)) {
    throw new FileUploadConfigError(`${context} must be an object.`);
  }
  for (const key of ["path", "url", "idPath", "refTemplate"] as const) {
    if (config[key] !== undefined && typeof config[key] !== "string") {
      throw new FileUploadConfigError(`${context}: ${JSON.stringify(key)} must be a string.`);
    }
  }
  if (!hasNonBlankString(config, "path") && !hasNonBlankString(config, "url")) {
    throw new FileUploadConfigError(`${context} requires at least one of "path" or "url".`);
  }
  if (config.purpose !== undefined) {
    const purpose = config.purpose;
    const validMap = isPlainJsonObject(purpose)
      ? Object.values(purpose).every((value) => typeof value === "string")
      : false;
    if (typeof purpose !== "string" && !validMap) {
      throw new FileUploadConfigError(
        `${context}: "purpose" must be a string or an object mapping content purposes to strings.`,
      );
    }
  }
  const refTemplate = config.refTemplate;
  if (typeof refTemplate !== "string" || refTemplate.trim().length === 0) {
    throw new FileUploadConfigError(`${context} requires a non-empty "refTemplate" string.`);
  }
  if (!refTemplate.includes("{id}")) {
    throw new FileUploadConfigError(
      `${context}: "refTemplate" must contain the "{id}" placeholder.`,
    );
  }
  const maxBytes = config.maxBytes;
  if (maxBytes !== undefined) {
    if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new FileUploadConfigError(`${context}: "maxBytes" must be a positive number.`);
    }
  }
  return config as unknown as FileUploadConfig;
}

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
