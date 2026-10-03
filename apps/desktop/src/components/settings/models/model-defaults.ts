import i18n from "@/lib/i18n";
import type { DesktopModelCapability, DesktopSnapshot, ModelRef } from "@/types";
import {
  emptyModelRef,
  isEmptyModelRef,
  modelRefKey,
  modelRefsEqual,
} from "@spiritagent/host-internal/config-v2";

export const defaultCustomModelCapabilities: DesktopModelCapability[] = ["languageModel", "image"];

export type SettingsModelProfile = DesktopSnapshot["config"]["models"][number];

export type ModelDefaultAssignments = {
  activeModel: boolean;
  imageGenerationModel: boolean;
  videoGenerationModel: boolean;
  secondaryLanguageModel: boolean;
};

export type ModelDefaultRole = keyof ModelDefaultAssignments;

export function settingsModelRef(model: SettingsModelProfile): ModelRef {
  return model.ref ?? { groupId: model.groupId ?? "", name: model.name };
}

export function resolveEffectiveModelRef(
  settingsRef: ModelRef | undefined,
  snapshotRef: ModelRef | undefined,
): ModelRef {
  if (settingsRef && !isEmptyModelRef(settingsRef)) {
    return settingsRef;
  }
  if (snapshotRef && !isEmptyModelRef(snapshotRef)) {
    return snapshotRef;
  }
  return emptyModelRef();
}

export const modelCapabilityOptions: Array<{
  value: DesktopModelCapability;
  label: string;
  labelKey: string;
  summaryKey: string;
}> = [
  {
    value: "languageModel",
    label: "Chat",
    labelKey: "settings.capabilityChatLabel",
    summaryKey: "settings.capabilityChat",
  },
  {
    value: "image",
    label: "Image",
    labelKey: "settings.capabilityImageLabel",
    summaryKey: "settings.capabilityImage",
  },
  {
    value: "video",
    label: "Video",
    labelKey: "settings.capabilityVideoLabel",
    summaryKey: "settings.capabilityVideo",
  },
  {
    value: "imageGeneration",
    label: "Image generation",
    labelKey: "settings.capabilityImageGenerationLabel",
    summaryKey: "settings.capabilityImageGeneration",
  },
  {
    value: "videoGeneration",
    label: "Video generation",
    labelKey: "settings.capabilityVideoGenerationLabel",
    summaryKey: "settings.capabilityVideoGeneration",
  },
];

export function normalizeModelCapabilitySelection(
  values: readonly DesktopModelCapability[],
): DesktopModelCapability[] {
  const allowed = new Set(modelCapabilityOptions.map((option) => option.value));
  const seen = new Set<DesktopModelCapability>();
  const normalized: DesktopModelCapability[] = [];
  for (const value of values) {
    if (!allowed.has(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : [...defaultCustomModelCapabilities];
}

export function canAssignAsActiveModel(
  model: SettingsModelProfile,
  isCurrentActiveModel: boolean,
): boolean {
  return (
    isCurrentActiveModel ||
    model.capabilities === undefined ||
    model.capabilities.includes("languageModel")
  );
}

export function canAssignAsImageGenerationModel(
  model: SettingsModelProfile,
  isCurrentImageGenerationModel: boolean,
): boolean {
  return isCurrentImageGenerationModel || model.capabilities?.includes("imageGeneration") === true;
}

export function canAssignAsVideoGenerationModel(
  model: SettingsModelProfile,
  isCurrentVideoGenerationModel: boolean,
): boolean {
  return isCurrentVideoGenerationModel || model.capabilities?.includes("videoGeneration") === true;
}

export function canAssignAsSecondaryLanguageModel(
  model: SettingsModelProfile,
  isCurrentSecondaryLanguageModel: boolean,
): boolean {
  return canAssignAsActiveModel(model, isCurrentSecondaryLanguageModel);
}

export function getSupportedModelDefaultRoles(
  model: SettingsModelProfile,
  activeModel: ModelRef,
  imageGenerationModel: ModelRef | undefined,
  videoGenerationModel: ModelRef | undefined,
  secondaryLanguageModel: ModelRef | undefined,
): ModelDefaultRole[] {
  const modelRef = settingsModelRef(model);
  const roles: ModelDefaultRole[] = [];

  if (canAssignAsActiveModel(model, modelRefsEqual(modelRef, activeModel))) {
    roles.push("activeModel");
  }

  if (
    canAssignAsImageGenerationModel(
      model,
      imageGenerationModel !== undefined && modelRefsEqual(modelRef, imageGenerationModel),
    )
  ) {
    roles.push("imageGenerationModel");
  }

  if (
    canAssignAsVideoGenerationModel(
      model,
      videoGenerationModel !== undefined && modelRefsEqual(modelRef, videoGenerationModel),
    )
  ) {
    roles.push("videoGenerationModel");
  }

  if (
    canAssignAsSecondaryLanguageModel(
      model,
      secondaryLanguageModel !== undefined && modelRefsEqual(modelRef, secondaryLanguageModel),
    )
  ) {
    roles.push("secondaryLanguageModel");
  }

  return roles;
}

export function modelDefaultActionLabel(roles: readonly ModelDefaultRole[]): string {
  if (roles.length === 0) {
    return i18n.t("settings.noDefaultRoles");
  }

  if (roles.length === 1) {
    if (roles[0] === "activeModel") {
      return i18n.t("settings.setActiveModel");
    }
    if (roles[0] === "imageGenerationModel") {
      return i18n.t("settings.setImageGenModel");
    }
    if (roles[0] === "videoGenerationModel") {
      return i18n.t("settings.setVideoGenModel");
    }
    return i18n.t("settings.setLightweightChatModel");
  }

  return i18n.t("settings.selectDefaultRole");
}

export { modelRefKey };
