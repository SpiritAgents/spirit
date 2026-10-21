import { createGateway, type GatewayVideoModelId } from "@ai-sdk/gateway";
import { experimental_generateVideo as generateVideo } from "ai";

import { getLlmFetch } from "../llm-fetch.js";
import type { OpenAiVideoGenerationConfig } from "../openai/openai-compat.js";
import {
  DEFAULT_VIDEO_GENERATION_DURATION,
  type GeneratedVideoFile,
  type GeneratedVideoSaveRequest,
  type ToolExecutionOutput,
  type VideoGenerationRequest,
} from "../ports.js";
import { buildGeneratedVideoToolOutput } from "./output.js";
import type { VideoGenerationBackend } from "./types.js";

/** Gateway video uses the v3 AI protocol (default `…/v3/ai/video-model`); the chat preset `/v1` baseUrl cannot be used. */
export function resolveAiGatewayVideoProviderOptions(
  config: Pick<OpenAiVideoGenerationConfig, "apiKey" | "baseUrl">,
): { apiKey: string } {
  return { apiKey: config.apiKey };
}

/** MiniMax H3 text-to-video via Gateway falls back to adaptive when ratio is omitted, and the upstream returns 2013. Other Gateway video models can omit ratio normally. */
export const MINIMAX_H3_GATEWAY_DEFAULT_ASPECT_RATIO = "16:9" as const;

export function isMinimaxH3GatewayVideoModel(model: string): boolean {
  const bareId = model.trim().toLowerCase().split("/").at(-1) ?? "";
  return bareId === "minimax-h3";
}

export function resolveAiGatewayVideoAspectRatio(
  model: string,
  aspectRatio: string | undefined,
): `${number}:${number}` | undefined {
  const trimmed = aspectRatio?.trim();
  if (trimmed) {
    return trimmed as `${number}:${number}`;
  }

  if (isMinimaxH3GatewayVideoModel(model)) {
    return MINIMAX_H3_GATEWAY_DEFAULT_ASPECT_RATIO;
  }

  return undefined;
}

/** Veo text-to-video via Gateway only supports 4/6/8 seconds; the global default of 5 seconds triggers an upstream duration validation failure. */
export const VEO_GATEWAY_SUPPORTED_DURATIONS = [4, 6, 8] as const;

export function isVeoGatewayVideoModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return /\/veo[-.]/.test(normalized);
}

export function snapToNearestVeoGatewayDuration(duration: number): number {
  let best: number = VEO_GATEWAY_SUPPORTED_DURATIONS[0];
  let bestDistance = Math.abs(duration - best);

  for (const candidate of VEO_GATEWAY_SUPPORTED_DURATIONS) {
    const distance = Math.abs(duration - candidate);
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

export function resolveAiGatewayVideoDuration(model: string, duration: number | undefined): number {
  const resolved = duration ?? DEFAULT_VIDEO_GENERATION_DURATION;
  if (!isVeoGatewayVideoModel(model)) {
    return resolved;
  }

  if ((VEO_GATEWAY_SUPPORTED_DURATIONS as readonly number[]).includes(resolved)) {
    return resolved;
  }

  return snapToNearestVeoGatewayDuration(resolved);
}

export class AiSdkGatewayVideoBackend implements VideoGenerationBackend {
  readonly id = "vercel-gateway-videos";

  async generate(
    config: OpenAiVideoGenerationConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const provider = createGateway({
      ...resolveAiGatewayVideoProviderOptions(config),
      fetch: getLlmFetch(),
    });

    console.error("[agent-core][generate-video] request.start", {
      adapter: this.id,
      model: config.model,
      profileBaseUrl: config.baseUrl,
    });

    const aspectRatio = resolveAiGatewayVideoAspectRatio(config.model, request.aspectRatio);
    const duration = resolveAiGatewayVideoDuration(config.model, request.duration);

    const result = await generateVideo({
      model: provider.video(config.model as GatewayVideoModelId),
      prompt: request.prompt,
      duration,
      ...(aspectRatio ? { aspectRatio } : {}),
      // Gateway Seedance uses labels like 720p/1080p, while the SDK type is still WxH.
      ...(request.resolution ? { resolution: request.resolution as never } : {}),
      maxRetries: 0,
    });

    const video = result.videos[0];
    if (!video) {
      throw new Error("AI Gateway video generation returned no video.");
    }

    const saved = await saveGeneratedVideo({
      data: video.uint8Array,
      mediaType: video.mediaType,
      prompt: request.prompt,
      model: config.model,
    });

    console.error("[agent-core][generate-video] request.success", {
      adapter: this.id,
      model: config.model,
      savedPath: saved.path,
      mimeType: saved.mimeType,
    });

    return buildGeneratedVideoToolOutput(saved, config, request);
  }
}
