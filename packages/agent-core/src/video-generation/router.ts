import { ArkVideoBackend } from "./ark-video-backend.js";
import type { OpenAiVideoGenerationConfig } from "../openai/openai-compat.js";
import type {
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ToolExecutionOutput,
  VideoGenerationRequest,
} from "../ports.js";
import { AiSdkGatewayVideoBackend } from "./ai-sdk-gateway-backend.js";
import { OpenRouterVideosBackend } from "./openrouter-videos-backend.js";
import { SiliconFlowVideoBackend } from "./siliconflow-backend.js";
import { TogetherVideosBackend } from "./together-videos-backend.js";
import { DeepInfraVideosBackend } from "./deepinfra-videos-backend.js";
import { HuggingFaceVideoBackend } from "./huggingface-backend.js";
import type { VideoGenerationBackend } from "./types.js";

/**
 * Video generation backend registry, keyed by the declared `videoApi` API-shape name. Each backend
 * implements one wire shape; selection never sniffs hosts or vendor identity.
 */
const VIDEO_BACKENDS_BY_API: Readonly<Record<string, VideoGenerationBackend>> = {
  "vercel-gateway-videos": new AiSdkGatewayVideoBackend(),
  "openrouter-videos": new OpenRouterVideosBackend(),
  "together-videos": new TogetherVideosBackend(),
  "deepinfra-videos": new DeepInfraVideosBackend(),
  "huggingface-inference": new HuggingFaceVideoBackend(),
  "siliconflow-videos": new SiliconFlowVideoBackend(),
  "ark-videos": new ArkVideoBackend(),
};

export function knownVideoApiShapeNames(): string[] {
  return Object.keys(VIDEO_BACKENDS_BY_API);
}

export function resolveVideoGenerationBackend(
  config: OpenAiVideoGenerationConfig,
): VideoGenerationBackend {
  const videoApi = config.videoApi?.trim();
  if (!videoApi) {
    throw new Error(
      "No video generation backend is configured for the selected video model (the provider entry declares no videoApi).",
    );
  }

  const backend = VIDEO_BACKENDS_BY_API[videoApi];
  if (backend === undefined) {
    throw new Error(
      `Unknown videoApi ${JSON.stringify(videoApi)}. Known video API shapes: ${knownVideoApiShapeNames().join(", ")}.`,
    );
  }
  return backend;
}

export async function generateVideoWithRouter(
  config: OpenAiVideoGenerationConfig,
  request: VideoGenerationRequest,
  saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
): Promise<ToolExecutionOutput> {
  const backend = resolveVideoGenerationBackend(config);
  try {
    return await backend.generate(config, request, saveGeneratedVideo);
  } catch (error) {
    console.error("[agent-core][generate-video] request.failed", {
      adapter: backend.id,
      model: config.model,
      baseUrl: config.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
