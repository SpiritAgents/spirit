import { getLlmFetch } from "../llm-fetch.js";
import type { OpenAiImageGenerationConfig } from "../openai/openai-compat.js";
import { buildGeneratedImageToolOutput } from "./output.js";
import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  ImageGenerationRequest,
  ToolExecutionOutput,
} from "../ports.js";

interface SiliconFlowImageGenerationResponse {
  images?: Array<{ url?: string }>;
}

const SILICONFLOW_IMAGE_SIZE_VALUES = new Set(["1280x720", "720x1280", "960x960", "1024x1024"]);

export function mapSiliconFlowImageSize(size: string | undefined): string | undefined {
  if (!size) {
    return undefined;
  }
  const normalized = size.trim();
  if (SILICONFLOW_IMAGE_SIZE_VALUES.has(normalized)) {
    return normalized;
  }
  return undefined;
}

export async function generateSiliconFlowImage(
  config: OpenAiImageGenerationConfig,
  request: ImageGenerationRequest,
  saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
): Promise<ToolExecutionOutput> {
  const baseUrl = (config.baseUrl ?? "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("The siliconflow-images API shape requires a baseUrl.");
  }
  const createUrl = `${baseUrl}/images/generations`;
  const imageSize = mapSiliconFlowImageSize(request.size);

  console.error("[agent-core][generate-image] request.start", {
    adapter: "siliconflow-images",
    model: config.model,
    baseUrl,
    createUrl,
    size: request.size,
    imageSize,
  });

  const createResponse = await getLlmFetch()(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt: request.prompt,
      ...(imageSize ? { image_size: imageSize } : {}),
    }),
  });

  if (!createResponse.ok) {
    const body = await createResponse.text();
    throw new Error(`SiliconFlow image generation failed (${createResponse.status}): ${body}`);
  }

  const created = (await createResponse.json()) as SiliconFlowImageGenerationResponse;
  const imageUrl = created.images?.[0]?.url?.trim();
  if (!imageUrl) {
    throw new Error("SiliconFlow image generation returned no image URL.");
  }

  const downloadResponse = await fetch(imageUrl);
  if (!downloadResponse.ok) {
    const body = await downloadResponse.text();
    throw new Error(`SiliconFlow image download failed (${downloadResponse.status}): ${body}`);
  }

  const mediaType =
    downloadResponse.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const data = new Uint8Array(await downloadResponse.arrayBuffer());
  const saved = await saveGeneratedImage({
    data,
    mediaType,
    prompt: request.prompt,
    model: config.model,
  });

  console.error("[agent-core][generate-image] request.success", {
    adapter: "siliconflow-images",
    model: config.model,
    mimeType: saved.mimeType,
  });

  return buildGeneratedImageToolOutput(saved, config.model);
}
