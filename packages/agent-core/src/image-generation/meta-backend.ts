import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { getLlmFetch } from "../llm-fetch.js";
import type { OpenAiImageGenerationConfig } from "../openai/openai-compat.js";
import { buildGeneratedImagesToolOutput } from "./output.js";
import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  ImageGenerationReferenceImage,
  ImageGenerationRequest,
  JsonObject,
  JsonValue,
  ToolExecutionOutput,
} from "../ports.js";
import { isJsonObject } from "../tool-agent.js";

interface MetaImageResultItem {
  b64_json?: string;
  url?: string;
}

export async function generateMetaImage(
  config: OpenAiImageGenerationConfig,
  request: ImageGenerationRequest,
  saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
): Promise<ToolExecutionOutput> {
  const baseUrl = config.baseUrl?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("The meta-images API shape requires a baseUrl.");
  }
  const references = request.referenceImages ?? [];
  const count = request.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new Error("Muse Image generation count must be between 1 and 10.");
  }
  if (references.length > 10) {
    throw new Error("Muse Image editing accepts between 1 and 10 reference images.");
  }
  if (!/^\d+x\d+$/i.test(request.size)) {
    throw new Error("Muse Image size must use WxH aspect-ratio dimensions.");
  }
  if (
    request.reasoningStrength !== undefined &&
    !["low", "high"].includes(request.reasoningStrength)
  ) {
    throw new Error("Muse Image reasoning strength must be low or high.");
  }

  const editing = references.length > 0;
  const body: JsonObject = {
    model: config.model,
    prompt: request.prompt,
    n: count,
    size: request.size,
    response_format: request.responseFormat ?? "b64_json",
    ...(request.outputFormat !== undefined ? { output_format: request.outputFormat } : {}),
    ...(request.reasoningStrength !== undefined
      ? { reasoning_strength: request.reasoningStrength }
      : {}),
    ...(editing ? { images: await Promise.all(references.map(readReferenceImage)) } : {}),
  };
  // Muse Image rejects OpenAI's moderation field; it is deliberately never forwarded.
  const response = await getLlmFetch()(`${baseUrl}/images/${editing ? "edits" : "generations"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Muse Image request failed (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as JsonValue;
  if (!isJsonObject(payload) || !Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error("Muse Image returned no images.");
  }
  const outputFormat =
    payload.output_format === "webp" ||
    payload.output_format === "png" ||
    payload.output_format === "jpeg"
      ? payload.output_format
      : (request.outputFormat ?? "webp");
  const mediaType = `image/${outputFormat === "jpeg" ? "jpeg" : outputFormat}`;
  const saved: GeneratedImageFile[] = [];
  for (const rawItem of payload.data) {
    if (!isJsonObject(rawItem)) {
      throw new Error("Muse Image returned an invalid image entry.");
    }
    const item = rawItem as MetaImageResultItem;
    const data = await readImageResult(item);
    saved.push(
      await saveGeneratedImage({
        data,
        mediaType,
        prompt: request.prompt,
        model: config.model,
      }),
    );
  }
  return buildGeneratedImagesToolOutput(saved, config.model);
}

async function readReferenceImage(reference: ImageGenerationReferenceImage): Promise<JsonValue> {
  if (reference.fileId?.trim()) {
    return { file_id: reference.fileId.trim() };
  }
  if (reference.url?.trim()) {
    return { image_url: reference.url.trim() };
  }
  if (reference.path?.trim()) {
    const path = reference.path.trim();
    const bytes = await readFile(path);
    const mediaType = reference.mediaType ?? imageMediaTypeFromPath(path);
    return { image_url: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}` };
  }
  if (reference.data && reference.data.byteLength > 0) {
    const mediaType = reference.mediaType ?? "image/png";
    return {
      image_url: `data:${mediaType};base64,${Buffer.from(reference.data).toString("base64")}`,
    };
  }
  throw new Error("Each Muse Image reference requires a path, URL, file ID, or bytes.");
}

function imageMediaTypeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

async function readImageResult(item: MetaImageResultItem): Promise<Uint8Array> {
  if (item.b64_json?.trim()) {
    return new Uint8Array(Buffer.from(item.b64_json, "base64"));
  }
  if (item.url?.trim()) {
    const response = await getLlmFetch()(item.url.trim());
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Muse Image download failed (${response.status}): ${body}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error("Muse Image result had neither b64_json nor url.");
}
