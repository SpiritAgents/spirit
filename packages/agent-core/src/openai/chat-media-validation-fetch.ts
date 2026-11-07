import { readFile } from "node:fs/promises";

import type { OpenAiTransportConfig } from "./openai-compat.js";
import {
  decodeDataUrl,
  MAX_IMAGE_INPUTS,
  MAX_INLINE_IMAGE_BYTES,
  validateImageDataUrl,
  validateMp4Bytes,
} from "./media-input-validation.js";
import { isJsonObject } from "../tool-agent.js";
import type { JsonValue } from "../ports.js";

/** Validates raw Chat messages after the SDK video-passthrough stash has been restored. */
export function createChatMediaValidationFetch(
  config: Pick<OpenAiTransportConfig, "options">,
  fetchFn: typeof fetch,
): typeof fetch {
  if (config.options?.chatMediaValidation !== true) {
    return fetchFn;
  }
  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes("/chat/completions") || typeof init?.body !== "string") {
      return fetchFn(input, init);
    }
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return fetchFn(input, init);
    }
    const jsonBody = body as JsonValue;
    if (!isJsonObject(jsonBody) || !Array.isArray(jsonBody.messages)) {
      return fetchFn(input, init);
    }
    let imageCount = 0;
    for (const message of jsonBody.messages) {
      if (!isJsonObject(message) || message.role !== "user" || !Array.isArray(message.content)) {
        continue;
      }
      for (const part of message.content) {
        if (!isJsonObject(part)) {
          continue;
        }
        if (part.type === "local_file") {
          throw new Error(
            "Audio and PDF input require the Responses transport with Files API upload.",
          );
        }
        if (part.type === "image_url") {
          imageCount += 1;
          if (
            isJsonObject(part.image_url) &&
            typeof part.image_url.url === "string" &&
            part.image_url.url.startsWith("data:")
          ) {
            validateImageDataUrl(part.image_url.url);
          }
        }
        if (
          part.type === "video_url" &&
          isJsonObject(part.video_url) &&
          typeof part.video_url.url === "string"
        ) {
          const value = part.video_url.url;
          if (value.startsWith("data:")) {
            const decoded = decodeDataUrl(value);
            if (!decoded || decoded.mediaType !== "video/mp4") {
              throw new Error("Chat video input must use a video/mp4 data URL.");
            }
            if (decoded.bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
              throw new Error("Inline video input exceeds the 50 MB limit.");
            }
            validateMp4Bytes(decoded.bytes);
          } else if (/^https?:\/\//i.test(value)) {
            if (!new URL(value).pathname.toLowerCase().endsWith(".mp4")) {
              throw new Error("Chat video input must reference an MP4 URL.");
            }
          } else if (!value.startsWith("ms://")) {
            validateMp4Bytes(await readFile(value));
          }
        }
      }
    }
    if (imageCount > MAX_IMAGE_INPUTS) {
      throw new Error(`Image input exceeds the ${MAX_IMAGE_INPUTS}-image request limit.`);
    }
    return fetchFn(input, init);
  };
}
