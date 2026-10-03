import { type ModelEntryV2, type ModelRef, type ProviderGroupV2 } from "@spiritagent/host-internal";

import type {
  DesktopAlibabaBillingMode,
  DesktopGlmCodingPlanBillingMode,
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopStepfunBillingMode,
  DesktopTransportKind,
  ModelProfileSnapshot,
} from "../types.js";
import type { DesktopConfigFile } from "./storage.js";

export interface ResolvedModelProfile extends ModelProfileSnapshot {
  groupId: string;
  ref: ModelRef;
}

export function flattenProviderGroups(
  config: Pick<DesktopConfigFile, "providerGroups">,
): ResolvedModelProfile[] {
  const resolved: ResolvedModelProfile[] = [];
  for (const group of config.providerGroups) {
    for (const model of group.models) {
      const profile = resolveModelProfileFromParts(group, model);
      if (profile) {
        resolved.push(profile);
      }
    }
  }
  return resolved;
}

export function resolveModelProfileFromParts(
  group: ProviderGroupV2,
  model: ModelEntryV2,
): ResolvedModelProfile | null {
  if (!group.id.trim() || !model.name.trim()) {
    return null;
  }
  const ref: ModelRef = { groupId: group.id, name: model.name };
  return {
    ref,
    groupId: group.id,
    name: model.name,
    apiBase: group.apiBase,
    reasoningEffort: model.reasoningEffort as DesktopModelReasoningEffort,
    ...(model.reasoningMode === "pro" ? { reasoningMode: "pro" as const } : {}),
    ...(model.thinkingEnabled === false ? { thinkingEnabled: false } : {}),
    ...(model.supportedReasoningEfforts !== undefined
      ? {
          supportedReasoningEfforts:
            model.supportedReasoningEfforts as DesktopModelReasoningEffort[],
        }
      : {}),
    ...(model.capabilities !== undefined
      ? { capabilities: model.capabilities as DesktopModelCapability[] }
      : {}),
    provider: group.provider as DesktopModelProvider,
    ...(group.transportKind ? { transportKind: group.transportKind as DesktopTransportKind } : {}),
    ...(group.providerSite
      ? { providerSite: group.providerSite as ResolvedModelProfile["providerSite"] }
      : {}),
    ...(group.alibabaWorkspaceId ? { alibabaWorkspaceId: group.alibabaWorkspaceId } : {}),
    ...(group.alibabaBillingMode
      ? { alibabaBillingMode: group.alibabaBillingMode as DesktopAlibabaBillingMode }
      : {}),
    ...(group.stepfunBillingMode
      ? { stepfunBillingMode: group.stepfunBillingMode as DesktopStepfunBillingMode }
      : {}),
    ...(group.zAiBillingMode
      ? { zAiBillingMode: group.zAiBillingMode as DesktopGlmCodingPlanBillingMode }
      : {}),
    ...(group.zhipuBillingMode
      ? { zhipuBillingMode: group.zhipuBillingMode as DesktopGlmCodingPlanBillingMode }
      : {}),
    ...(group.awsRegion ? { awsRegion: group.awsRegion } : {}),
    ...(group.azureResourceName ? { azureResourceName: group.azureResourceName } : {}),
    ...(group.cloudflareAccountId ? { cloudflareAccountId: group.cloudflareAccountId } : {}),
    ...(group.cloudflareGatewayId ? { cloudflareGatewayId: group.cloudflareGatewayId } : {}),
    ...(group.vertexProject ? { vertexProject: group.vertexProject } : {}),
    ...(group.vertexLocation ? { vertexLocation: group.vertexLocation } : {}),
    ...(model.contextLength !== undefined ? { contextLength: model.contextLength } : {}),
    ...(model.supportsThinkingType ? { supportsThinkingType: model.supportsThinkingType } : {}),
    ...(model.supportsThinkingSwitch === true ? { supportsThinkingSwitch: true } : {}),
  };
}

export function resolveModelProfile(
  config: Pick<DesktopConfigFile, "providerGroups">,
  ref: ModelRef | undefined,
): ResolvedModelProfile | null {
  if (!ref?.groupId?.trim() || !ref?.name?.trim()) {
    return null;
  }
  const group = config.providerGroups.find((entry) => entry.id === ref.groupId.trim());
  if (!group) {
    return null;
  }
  const model = group.models.find((entry) => entry.name === ref.name.trim());
  if (!model) {
    return null;
  }
  return resolveModelProfileFromParts(group, model);
}

export function findProviderGroup(
  config: Pick<DesktopConfigFile, "providerGroups">,
  groupId: string,
): ProviderGroupV2 | undefined {
  const normalized = groupId.trim();
  if (!normalized) {
    return undefined;
  }
  return config.providerGroups.find((group) => group.id === normalized);
}

export function modelExistsInGroup(
  config: Pick<DesktopConfigFile, "providerGroups">,
  groupId: string,
  name: string,
): boolean {
  const group = findProviderGroup(config, groupId);
  if (!group) {
    return false;
  }
  return group.models.some((model) => model.name === name.trim());
}

export function listAllModelRefs(config: Pick<DesktopConfigFile, "providerGroups">): ModelRef[] {
  const refs: ModelRef[] = [];
  for (const group of config.providerGroups) {
    for (const model of group.models) {
      refs.push({ groupId: group.id, name: model.name });
    }
  }
  return refs;
}

export function firstModelRef(config: Pick<DesktopConfigFile, "providerGroups">): ModelRef {
  const firstGroup = config.providerGroups[0];
  const firstModel = firstGroup?.models[0];
  if (!firstGroup || !firstModel) {
    return { groupId: "", name: "" };
  }
  return { groupId: firstGroup.id, name: firstModel.name };
}

export function modelRefExists(
  config: Pick<DesktopConfigFile, "providerGroups">,
  ref: ModelRef | undefined,
): boolean {
  return resolveModelProfile(config, ref) !== null;
}

export function resolveActiveModelProfile(config: DesktopConfigFile): ResolvedModelProfile | null {
  return resolveModelProfile(config, config.activeModel);
}

export function modelSupportsImageGeneration(
  model: Pick<ModelProfileSnapshot, "capabilities">,
): boolean {
  return model.capabilities?.includes("imageGeneration") === true;
}

export function modelSupportsVideoGeneration(
  model: Pick<ModelProfileSnapshot, "capabilities">,
): boolean {
  return model.capabilities?.includes("videoGeneration") === true;
}

export function modelSupportsLanguageModel(
  model: Pick<ModelProfileSnapshot, "capabilities">,
): boolean {
  return model.capabilities === undefined || model.capabilities.includes("languageModel");
}

export function findModelRefByName(
  config: Pick<DesktopConfigFile, "providerGroups">,
  name: string,
): ModelRef | undefined {
  const trimmed = name.trim();
  if (!trimmed) {
    return undefined;
  }
  for (const group of config.providerGroups) {
    const model = group.models.find((entry) => entry.name === trimmed);
    if (model) {
      return { groupId: group.id, name: model.name };
    }
  }
  return undefined;
}

export function resolvePaneModelRef(
  config: Pick<DesktopConfigFile, "providerGroups">,
  ref: ModelRef | undefined,
): ModelRef | undefined {
  if (!ref?.name?.trim()) {
    return undefined;
  }
  const profile = resolveModelProfile(config, ref);
  if (profile) {
    return profile.ref;
  }
  if (!ref.groupId?.trim()) {
    return findModelRefByName(config, ref.name);
  }
  return undefined;
}

export function normalizeSlotModelRef(
  value: unknown,
  config: Pick<DesktopConfigFile, "providerGroups">,
  predicate: (profile: ResolvedModelProfile) => boolean,
): ModelRef | undefined {
  const ref =
    typeof value === "object" && value !== null
      ? {
          groupId:
            typeof (value as ModelRef).groupId === "string"
              ? (value as ModelRef).groupId.trim()
              : "",
          name: typeof (value as ModelRef).name === "string" ? (value as ModelRef).name.trim() : "",
        }
      : undefined;
  if (!ref?.groupId || !ref?.name) {
    return undefined;
  }
  const profile = resolveModelProfile(config, ref);
  return profile && predicate(profile) ? ref : undefined;
}
