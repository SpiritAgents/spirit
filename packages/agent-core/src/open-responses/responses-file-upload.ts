import type { JsonObject } from "../ports.js";
import { readFile } from "node:fs/promises";

import {
  uploadDeclaredFile,
  uploadDeclaredFileBytes,
  type DeclaredFileUploadConnection,
} from "../file-upload/uploader.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";
import {
  decodeDataUrl,
  MAX_IMAGE_INPUTS,
  MAX_PDF_PAGES_PER_DOCUMENT,
  pdfPageCount,
  validateAudioBytes,
  validateImageDataUrl,
  validateMp4Bytes,
} from "../openai/media-input-validation.js";

const TOKEN_KIND = "spirit-responses-local-file-v1";

export interface ResponsesLocalFileToken {
  path: string;
  filename: string;
  mediaType: string;
  assetKind: "audio" | "document" | "video";
}

export function buildResponsesLocalFileToken(token: ResponsesLocalFileToken): string {
  return Buffer.from(JSON.stringify({ kind: TOKEN_KIND, ...token }), "utf8").toString("base64");
}

export function readResponsesLocalFileToken(data: string): ResponsesLocalFileToken | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.kind !== TOKEN_KIND ||
      typeof record.path !== "string" ||
      typeof record.filename !== "string" ||
      typeof record.mediaType !== "string" ||
      (record.assetKind !== "audio" &&
        record.assetKind !== "document" &&
        record.assetKind !== "video")
    ) {
      return undefined;
    }
    return {
      path: record.path,
      filename: record.filename,
      mediaType: record.mediaType,
      assetKind: record.assetKind,
    };
  } catch {
    return undefined;
  }
}

export function isJsonRequestObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolves SDK file parts into Files API references and enforces the declared media budget. */
export function createResponsesFileUploadFetch(
  config: OpenResponsesTransportConfig,
  fetchFn: typeof fetch,
): typeof fetch {
  if (config.options?.responsesFileUpload !== true || !config.fileUpload) {
    return fetchFn;
  }
  const uploadConfig = config.fileUpload;

  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes("/responses") || typeof init?.body !== "string") {
      return fetchFn(input, init);
    }
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return fetchFn(input, init);
    }
    if (!isJsonRequestObject(body) || !Array.isArray(body.input)) {
      return fetchFn(input, init);
    }

    let imageBudget = 0;
    const connection: DeclaredFileUploadConnection = {
      apiBase: config.baseUrl ?? "",
      apiKey: config.apiKey,
      fetchImpl: fetchFn,
    };
    for (const item of body.input) {
      if (!isJsonRequestObject(item) || item.role !== "user" || !Array.isArray(item.content)) {
        continue;
      }
      for (let index = 0; index < item.content.length; index += 1) {
        const part = item.content[index];
        if (!isJsonRequestObject(part)) {
          continue;
        }
        if (part.type === "input_image") {
          imageBudget += 1;
          assertMediaBudget(imageBudget);
          if (typeof part.image_url === "string" && part.image_url.startsWith("data:")) {
            validateImageDataUrl(part.image_url);
          }
          continue;
        }
        if (part.type !== "input_file" || typeof part.file_data !== "string") {
          continue;
        }
        const dataUrl = decodeDataUrl(part.file_data);
        if (!dataUrl) {
          continue;
        }
        const token = readResponsesLocalFileToken(Buffer.from(dataUrl.bytes).toString("base64"));
        if (!token) {
          continue;
        }

        if (/^https?:\/\//i.test(token.path)) {
          if (token.assetKind !== "video") {
            throw new Error("Remote audio and PDF inputs must be uploaded as local files.");
          }
          item.content[index] = {
            type: "input_video",
            video_url: { url: token.path },
          };
          continue;
        }

        const isInlineData = token.path.startsWith("data:");
        const bytes = isInlineData ? decodeDataUrl(token.path)?.bytes : await readFile(token.path);
        if (!bytes) {
          throw new Error(
            `Cannot decode ${token.assetKind} input ${JSON.stringify(token.filename)}.`,
          );
        }
        validateFileToken(token, bytes);
        if (token.assetKind === "document") {
          imageBudget += Math.min(pdfPageCount(bytes), MAX_PDF_PAGES_PER_DOCUMENT);
          assertMediaBudget(imageBudget);
        }
        const uploaded = isInlineData
          ? await uploadDeclaredFileBytes(
              uploadConfig,
              connection,
              bytes,
              token.filename,
              token.assetKind,
            )
          : await uploadDeclaredFile(uploadConfig, connection, token.path, token.assetKind);
        if (uploaded.kind !== "uploaded") {
          throw new Error(
            uploaded.kind === "failed"
              ? uploaded.error
              : `The Files declaration does not accept ${token.assetKind} input.`,
          );
        }
        item.content[index] = { type: "input_file", file_id: uploaded.ref };
      }
    }
    return fetchFn(input, { ...init, body: JSON.stringify(body) });
  };
}

function assertMediaBudget(imageBudget: number): void {
  if (imageBudget > MAX_IMAGE_INPUTS) {
    throw new Error(
      `Image and PDF page input exceeds the ${MAX_IMAGE_INPUTS}-item request budget.`,
    );
  }
}

function validateFileToken(token: ResponsesLocalFileToken, bytes: Uint8Array): void {
  switch (token.assetKind) {
    case "audio":
      validateAudioBytes(token.mediaType, bytes);
      return;
    case "document":
      if (token.mediaType !== "application/pdf") {
        throw new Error("Document input must use application/pdf.");
      }
      pdfPageCount(bytes);
      return;
    case "video":
      if (token.mediaType !== "video/mp4") {
        throw new Error("Video input must use video/mp4.");
      }
      validateMp4Bytes(bytes);
  }
}
