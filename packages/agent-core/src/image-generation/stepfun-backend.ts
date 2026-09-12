import { getLlmFetch } from "../llm-fetch.js";
import type { OpenAiImageGenerationConfig } from "../openai/openai-compat.js";
import { normalizeGeneratedImageMarkdownRef } from "../openai/ai-sdk-transport.js";
import { resolveStepfunV1Url } from "../stepfun/stepfun-api-hosts.js";
import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  ImageGenerationRequest,
  ToolExecutionOutput,
} from "../ports.js";
import { createLlmMessageContentFromTextAndImages } from "../ports.js";

export const STEPFUN_IMAGE_GENERATION_URL = resolveStepfunV1Url(undefined, "/images/generations");

function resolveStepfunImageGenerationUrl(config: OpenAiImageGenerationConfig): string {
  return resolveStepfunV1Url(config.baseUrl, "/images/generations");
}

interface StepfunImageGenerationResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
}

export function mapStepfunImageSize(model: string, size: string | undefined): string | undefined {
  if (!size) {
    return undefined;
  }

  const normalized = size.trim();
  const match = /^(\d+)x(\d+)$/i.exec(normalized);
  if (!match) {
    return normalized;
  }

  const width = match[1];
  const height = match[2];
  if (model.trim() === "step-image-edit-2") {
    return `${height}x${width}`;
  }

  return `${width}x${height}`;
}

function decodeBase64Image(data: string): Uint8Array {
  return Uint8Array.from(Buffer.from(data, "base64"));
}

async function requestStepfunImage(
  config: OpenAiImageGenerationConfig,
  request: ImageGenerationRequest,
  responseFormat: "b64_json" | "url",
): Promise<StepfunImageGenerationResponse> {
  const mappedSize = mapStepfunImageSize(config.model, request.size);
  const createUrl = resolveStepfunImageGenerationUrl(config);
  const createResponse = await getLlmFetch()(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt: request.prompt,
      response_format: responseFormat,
      ...(mappedSize ? { size: mappedSize } : {}),
    }),
  });

  if (!createResponse.ok) {
    const body = await createResponse.text();
    throw new Error(`StepFun image generation failed (${createResponse.status}): ${body}`);
  }

  return (await createResponse.json()) as StepfunImageGenerationResponse;
}

export async function generateStepfunImage(
  config: OpenAiImageGenerationConfig,
  request: ImageGenerationRequest,
  saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
): Promise<ToolExecutionOutput> {
  console.error("[agent-core][generate-image] request.start", {
    adapter: "stepfun",
    model: config.model,
    createUrl: resolveStepfunImageGenerationUrl(config),
    size: request.size,
    mappedSize: mapStepfunImageSize(config.model, request.size),
  });

  let created: StepfunImageGenerationResponse;
  try {
    created = await requestStepfunImage(config, request, "b64_json");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("StepFun image generation failed")) {
      throw error;
    }
    created = await requestStepfunImage(config, request, "url");
  }

  const first = created.data?.[0];
  const b64 = first?.b64_json?.trim();
  if (b64) {
    const data = decodeBase64Image(b64);
    const saved = await saveGeneratedImage({
      data,
      mediaType: "image/png",
      prompt: request.prompt,
      model: config.model,
    });
    console.error("[agent-core][generate-image] request.success", {
      adapter: "stepfun",
      model: config.model,
      mimeType: saved.mimeType,
      responseFormat: "b64_json",
    });
    return buildStepfunImageToolOutput(saved, config.model);
  }

  const imageUrl = first?.url?.trim();
  if (!imageUrl) {
    throw new Error("StepFun image generation returned no image data.");
  }

  const downloadResponse = await fetch(imageUrl);
  if (!downloadResponse.ok) {
    const body = await downloadResponse.text();
    throw new Error(`StepFun image download failed (${downloadResponse.status}): ${body}`);
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
    adapter: "stepfun",
    model: config.model,
    mimeType: saved.mimeType,
  });

  return buildStepfunImageToolOutput(saved, config.model);
}

function buildStepfunImageToolOutput(
  saved: GeneratedImageFile,
  model: string,
): ToolExecutionOutput {
  const summaryLines = ["[generated image]"];
  const markdownRef = normalizeGeneratedImageMarkdownRef(saved.markdownRef);
  summaryLines.push(
    `image_ref: ${markdownRef}`,
    `read_file_path: ${markdownRef}`,
    `embed_markdown: ![Generated image](${markdownRef})`,
  );
  summaryLines.push(`mime_type: ${saved.mimeType}`, `model: ${model}`);
  const summaryText = summaryLines.join("\n");

  return {
    content: createLlmMessageContentFromTextAndImages(summaryText, [saved.path]),
    summaryText,
  };
}
