import { isPlainJsonObject } from "../provider-tools/types.js";

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
