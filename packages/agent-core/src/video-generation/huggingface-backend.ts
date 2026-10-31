import { HfInference } from "@huggingface/inference";

import { resolveHuggingFaceInferenceProvider } from "../huggingface/inference-provider.js";
import type { OpenAiVideoGenerationConfig } from "../openai/openai-compat.js";
import type {
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ToolExecutionOutput,
  VideoGenerationRequest,
} from "../ports.js";
import { buildGeneratedVideoToolOutput } from "./output.js";
import type { VideoGenerationBackend } from "./types.js";

const DEFAULT_HUGGING_FACE_VIDEO_TIMEOUT_MS = 10 * 60 * 1000;

function blobMediaType(blob: Blob): string {
  const type = blob.type?.split(";")[0]?.trim();
  return type && type.length > 0 ? type : "video/mp4";
}

export class HuggingFaceVideoBackend implements VideoGenerationBackend {
  readonly id = "huggingface-inference";

  async generate(
    config: OpenAiVideoGenerationConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const provider = resolveHuggingFaceInferenceProvider({
      modelId: config.model,
      ...(config.inferenceProvider ? { inferenceProvider: config.inferenceProvider } : {}),
    });

    console.error("[agent-core][generate-video] request.start", {
      adapter: this.id,
      model: config.model,
      provider,
      duration: request.duration,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
    });

    const hf = new HfInference(config.apiKey);
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      DEFAULT_HUGGING_FACE_VIDEO_TIMEOUT_MS,
    );

    let blob: Blob;
    try {
      blob = await hf.textToVideo(
        {
          model: config.model,
          inputs: request.prompt,
          ...(provider ? { provider: provider as never } : {}),
        },
        {
          signal: abortController.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const mediaType = blobMediaType(blob);
    const data = new Uint8Array(await blob.arrayBuffer());
    const saved = await saveGeneratedVideo({
      data,
      mediaType,
      prompt: request.prompt,
      model: config.model,
    });

    console.error("[agent-core][generate-video] request.success", {
      adapter: this.id,
      model: config.model,
      mimeType: saved.mimeType,
    });

    return buildGeneratedVideoToolOutput(saved, config, request);
  }
}
