import { getLlmFetch } from "../llm-fetch.js";
import type { OpenAiVideoGenerationConfig } from "../openai/openai-compat.js";
import type {
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ToolExecutionOutput,
  VideoGenerationRequest,
} from "../ports.js";
import { pollUntil } from "./poll.js";
import { buildGeneratedVideoToolOutput } from "./output.js";
import type { VideoGenerationBackend } from "./types.js";

interface DeepInfraVideoCreateResponse {
  id?: string;
}

interface DeepInfraVideoStatusResponse {
  status?: string;
  error?: string | { message?: string };
  data?: Array<{
    video_url?: string;
    url?: string;
    output_url?: string;
  }>;
}

/**
 * The deepinfra-videos shape lives at the site root `/v1/videos` (not under the OpenAI-compatible
 * root `/v1/openai`). Connection configs store …/v1/openai, so the trailing /openai is stripped.
 */
export function resolveDeepInfraVideoApiBase(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("The deepinfra-videos API shape requires a baseUrl.");
  }
  return trimmed.endsWith("/openai") ? trimmed.slice(0, -"/openai".length) : trimmed;
}

function readDeepInfraVideoUrl(payload: DeepInfraVideoStatusResponse): string | undefined {
  if (!Array.isArray(payload.data)) {
    return undefined;
  }
  for (const item of payload.data) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const candidate = item.video_url ?? item.url ?? item.output_url;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function readDeepInfraVideoError(payload: DeepInfraVideoStatusResponse): string | undefined {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (
    typeof error === "object" &&
    error !== null &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  return undefined;
}

export class DeepInfraVideosBackend implements VideoGenerationBackend {
  readonly id = "deepinfra-videos";

  async generate(
    config: OpenAiVideoGenerationConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const videoBaseUrl = resolveDeepInfraVideoApiBase(config.baseUrl);
    const createUrl = `${videoBaseUrl}/videos`;

    console.error("[agent-core][generate-video] request.start", {
      adapter: this.id,
      model: config.model,
      baseUrl: config.baseUrl,
      videoBaseUrl,
      createUrl,
      duration: request.duration,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
    });

    // Request body fields follow the DeepInfra OpenAPI: seconds is an integer (unlike Together's string);
    // image_url is the I2V first-frame parameter, unrelated to the generate_video tool's T2V inputs; not wired in the first version (extension point).
    const createResponse = await getLlmFetch()(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        prompt: request.prompt,
        ...(request.duration !== undefined ? { seconds: request.duration } : {}),
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
        ...(request.resolution ? { size: request.resolution } : {}),
      }),
    });

    if (!createResponse.ok) {
      const body = await createResponse.text();
      throw new Error(`DeepInfra video task creation failed (${createResponse.status}): ${body}`);
    }

    const created = (await createResponse.json()) as DeepInfraVideoCreateResponse;
    const taskId = created.id?.trim();
    if (!taskId) {
      throw new Error("DeepInfra video task creation returned no task id.");
    }

    const statusUrl = `${videoBaseUrl}/videos/${encodeURIComponent(taskId)}`;
    const completed = await pollUntil(async () => {
      const statusResponse = await getLlmFetch()(statusUrl, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      });
      if (!statusResponse.ok) {
        const body = await statusResponse.text();
        throw new Error(`DeepInfra video task polling failed (${statusResponse.status}): ${body}`);
      }

      const status = (await statusResponse.json()) as DeepInfraVideoStatusResponse;
      const state = status.status?.toLowerCase();
      if (state === "completed" || state === "succeeded" || state === "success") {
        return status;
      }
      if (state === "failed" || state === "error") {
        throw new Error(
          readDeepInfraVideoError(status) ??
            `DeepInfra video task ended with status: ${status.status}`,
        );
      }
      return undefined;
    });

    const videoUrl = readDeepInfraVideoUrl(completed);
    if (!videoUrl) {
      throw new Error("DeepInfra video task completed without a downloadable video URL.");
    }

    const downloadResponse = await fetch(videoUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Failed to download DeepInfra video (${downloadResponse.status}).`);
    }

    const mediaType =
      downloadResponse.headers.get("content-type")?.split(";", 1)[0]?.trim() || "video/mp4";
    const data = new Uint8Array(await downloadResponse.arrayBuffer());
    const saved = await saveGeneratedVideo({
      data,
      mediaType,
      prompt: request.prompt,
      model: config.model,
    });

    console.error("[agent-core][generate-video] request.success", {
      adapter: this.id,
      model: config.model,
      taskId,
      savedPath: saved.path,
      mimeType: saved.mimeType,
    });

    return buildGeneratedVideoToolOutput(saved, config, request);
  }
}
