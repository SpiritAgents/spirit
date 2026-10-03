import type { ModelRef } from "../types.js";
import { isEmptyModelRef, modelRefsEqual } from "@spiritagent/host-internal/config-v2";

export type DirectMediaTool = "generate_image" | "generate_video";

type ModelWithCapabilities = {
  name: string;
  capabilities?: readonly string[];
};

type ComposerDirectMediaConfig = {
  models: readonly ModelWithCapabilities[];
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
};

function supportsImageGeneration(model: ModelWithCapabilities): boolean {
  return model.capabilities?.includes("imageGeneration") === true;
}

function supportsVideoGeneration(model: ModelWithCapabilities): boolean {
  return model.capabilities?.includes("videoGeneration") === true;
}

function supportsLanguageModel(model: ModelWithCapabilities): boolean {
  return model.capabilities?.includes("languageModel") === true;
}

export function resolveComposerDirectMediaTool(
  activeModel: ModelRef,
  config: ComposerDirectMediaConfig,
): DirectMediaTool | null {
  if (isEmptyModelRef(activeModel)) {
    return null;
  }

  const matchesVideoSlot =
    config.videoGenerationModel !== undefined &&
    modelRefsEqual(config.videoGenerationModel, activeModel);
  const matchesImageSlot =
    config.imageGenerationModel !== undefined &&
    modelRefsEqual(config.imageGenerationModel, activeModel);

  if (matchesVideoSlot && matchesImageSlot) {
    console.warn(
      "[desktop][composer-direct-media] active model matches both image and video default slots; preferring generate_video",
      { activeModel },
    );
  }

  if (matchesVideoSlot) {
    const profile = config.models.find((model) => model.name === activeModel.name);
    if (profile && supportsVideoGeneration(profile)) {
      return "generate_video";
    }
  }

  if (matchesImageSlot) {
    const profile = config.models.find((model) => model.name === activeModel.name);
    if (profile && supportsImageGeneration(profile)) {
      return "generate_image";
    }
  }

  const profile = config.models.find((model) => model.name === activeModel.name);
  if (profile && !supportsLanguageModel(profile)) {
    if (supportsVideoGeneration(profile)) {
      return "generate_video";
    }
    if (supportsImageGeneration(profile)) {
      return "generate_image";
    }
  }

  return null;
}
