import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertSpiritConfigSchemaVersion,
  findModelByRef,
  parseModelRef,
  SPIRIT_CONFIG_SCHEMA_VERSION,
  SpiritConfigSchemaError,
  type ModelEntryV2,
  type ModelRef,
  type ProviderGroupV2,
} from "../config-v2.js";

import type { SpiritConfigFile, SpiritModelProfile } from "./types.js";

const CONFIG_FILE_NAME = "config.json";

export { SpiritConfigSchemaError };

export { resolveSpiritDataDir } from "../data-paths.js";

export function configFilePath(spiritDataDir: string): string {
  return join(spiritDataDir, CONFIG_FILE_NAME);
}

function resolveSpiritModelProfile(
  group: ProviderGroupV2,
  model: ModelEntryV2,
): SpiritModelProfile {
  const ref: ModelRef = { groupId: group.id, name: model.name };
  return {
    groupId: group.id,
    ref,
    name: model.name,
    apiBase: group.apiBase,
    reasoningEffort: model.reasoningEffort,
    ...(model.supportedReasoningEfforts !== undefined
      ? { supportedReasoningEfforts: model.supportedReasoningEfforts }
      : {}),
    ...(model.capabilities !== undefined ? { capabilities: model.capabilities } : {}),
    provider: group.provider,
    ...(group.transportKind ? { transportKind: group.transportKind } : {}),
    ...(group.providerSite ? { providerSite: group.providerSite } : {}),
    ...(group.alibabaWorkspaceId ? { alibabaWorkspaceId: group.alibabaWorkspaceId } : {}),
    ...(group.alibabaBillingMode ? { alibabaBillingMode: group.alibabaBillingMode } : {}),
    ...(group.stepfunBillingMode ? { stepfunBillingMode: group.stepfunBillingMode } : {}),
    ...(group.zAiBillingMode ? { zAiBillingMode: group.zAiBillingMode } : {}),
    ...(group.zhipuBillingMode ? { zhipuBillingMode: group.zhipuBillingMode } : {}),
    ...(group.awsRegion ? { awsRegion: group.awsRegion } : {}),
    ...(group.azureResourceName ? { azureResourceName: group.azureResourceName } : {}),
    ...(group.cloudflareAccountId ? { cloudflareAccountId: group.cloudflareAccountId } : {}),
    ...(group.cloudflareGatewayId ? { cloudflareGatewayId: group.cloudflareGatewayId } : {}),
    ...(group.vertexProject ? { vertexProject: group.vertexProject } : {}),
    ...(group.vertexLocation ? { vertexLocation: group.vertexLocation } : {}),
    ...(model.contextLength !== undefined ? { contextLength: model.contextLength } : {}),
  };
}

function normalizeProviderGroups(raw: unknown): ProviderGroupV2[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as ProviderGroupV2[];
}

function normalizeConfig(raw: Record<string, unknown>): SpiritConfigFile {
  assertSpiritConfigSchemaVersion(raw);

  const providerGroups = normalizeProviderGroups(raw["providerGroups"]);
  const activeModel = parseModelRef(raw["activeModel"]) ?? { groupId: "", name: "" };
  const imageGenerationModel = parseModelRef(raw["imageGenerationModel"]);
  const videoGenerationModel = parseModelRef(raw["videoGenerationModel"]);
  const lightweightChatModel = parseModelRef(raw["lightweightChatModel"]);

  return {
    ...raw,
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providerGroups,
    activeModel,
    ...(imageGenerationModel ? { imageGenerationModel } : {}),
    ...(videoGenerationModel ? { videoGenerationModel } : {}),
    ...(lightweightChatModel ? { lightweightChatModel } : {}),
  };
}

export function loadSpiritConfig(spiritDataDir: string): SpiritConfigFile | undefined {
  const filePath = configFilePath(spiritDataDir);
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    return normalizeConfig(parsed as Record<string, unknown>);
  } catch (err) {
    if (err instanceof SpiritConfigSchemaError) {
      return undefined;
    }
    return undefined;
  }
}

export async function saveSpiritConfig(
  spiritDataDir: string,
  config: SpiritConfigFile,
): Promise<void> {
  const filePath = configFilePath(spiritDataDir);
  await mkdir(spiritDataDir, { recursive: true });
  const payload: SpiritConfigFile = {
    ...config,
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function loadActiveModelProfile(spiritDataDir: string): SpiritModelProfile | undefined {
  const config = loadSpiritConfig(spiritDataDir);
  if (!config) {
    return undefined;
  }
  const resolved = findModelByRef(config.providerGroups, config.activeModel);
  if (!resolved) {
    return undefined;
  }
  return resolveSpiritModelProfile(resolved.group, resolved.model);
}

export function loadModelProfile(
  spiritDataDir: string,
  modelRef: ModelRef,
): SpiritModelProfile | undefined {
  const config = loadSpiritConfig(spiritDataDir);
  if (!config) {
    return undefined;
  }
  const resolved = findModelByRef(config.providerGroups, modelRef);
  return resolved ? resolveSpiritModelProfile(resolved.group, resolved.model) : undefined;
}
