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

interface TogetherVideoCreateResponse {
  id?: string;
}

interface TogetherVideoStatusResponse {
  status?: string;
  error?: { message?: string };
  outputs?: {
    video_url?: string;
  };
}

/** The together-videos shape serves video under `/v2` derived from the openai-compatible `/v1` apiBase. */
export function resolveTogetherVideoApiBase(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    throw new Error("The together-videos API shape requires a baseUrl.");
  }
  return trimmed.replace(/\/v1\/?$/i, "/v2").replace(/\/$/, "");
}

export class TogetherVideosBackend implements VideoGenerationBackend {
  readonly id = "together-videos";

  async generate(
    config: OpenAiVideoGenerationConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const videoBaseUrl = resolveTogetherVideoApiBase(config.baseUrl);
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

    const createResponse = await getLlmFetch()(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        prompt: request.prompt,
        ...(request.duration !== undefined ? { seconds: String(request.duration) } : {}),
        ...(request.aspectRatio ? { ratio: request.aspectRatio } : {}),
        ...(request.resolution ? { resolution: request.resolution } : {}),
      }),
    });

    if (!createResponse.ok) {
      const body = await createResponse.text();
      throw new Error(`Together AI video task creation failed (${createResponse.status}): ${body}`);
    }

    const created = (await createResponse.json()) as TogetherVideoCreateResponse;
    const taskId = created.id?.trim();
    if (!taskId) {
      throw new Error("Together AI video task creation returned no task id.");
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
        throw new Error(
          `Together AI video task polling failed (${statusResponse.status}): ${body}`,
        );
      }

      const status = (await statusResponse.json()) as TogetherVideoStatusResponse;
      const state = status.status?.toLowerCase();
      if (state === "completed") {
        return status;
      }
      if (state === "failed") {
        throw new Error(
          status.error?.message ?? `Together AI video task ended with status: ${status.status}`,
        );
      }
      return undefined;
    });

    const videoUrl = completed.outputs?.video_url?.trim();
    if (!videoUrl) {
      throw new Error("Together AI video task completed without a downloadable video URL.");
    }

    const downloadResponse = await fetch(videoUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Failed to download Together AI video (${downloadResponse.status}).`);
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
