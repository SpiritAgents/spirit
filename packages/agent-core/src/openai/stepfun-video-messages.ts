import type { JsonObject, JsonValue } from "../ports.js";
import {
  resolveOpenAiModelCompatibilityProfile,
  type OpenAiTransportConfig,
} from "./openai-compat.js";
import { resolveLocalMediaPath } from "./openai-multimodal-media-path.js";
import { uploadStepfunVideoFile } from "./stepfun-files.js";

/** StepFun: uploads local video paths via the Files API (purpose=storage) and rewrites them as stepfile:// references. */
export async function resolveStepfunVideoUrlsInOpenAiMessages(
  config: OpenAiTransportConfig,
  messages: JsonValue[],
  assetRoot = process.cwd(),
): Promise<void> {
  if (config.llmVendor !== "stepfun") {
    return;
  }

  const profile = resolveOpenAiModelCompatibilityProfile(config);
  if (!profile.capabilities.videoInput) {
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
      if (!needsStepfunVideoUpload(url)) {
        continue;
      }

      const absolutePath = resolveLocalMediaPath(url, assetRoot);
      rawVideoUrl["url"] = await uploadStepfunVideoFile(config, absolutePath);
    }
  }
}

function needsStepfunVideoUpload(url: string): boolean {
  return (
    url.length > 0 &&
    !url.startsWith("http://") &&
    !url.startsWith("https://") &&
    !url.startsWith("data:") &&
    !url.startsWith("stepfile://")
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
