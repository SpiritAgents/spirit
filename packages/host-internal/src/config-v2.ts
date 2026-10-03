import type { ModelProviderId } from "./model-provider-presets.js";

export const SPIRIT_CONFIG_SCHEMA_VERSION = 2 as const;

export type SpiritConfigSchemaVersion = typeof SPIRIT_CONFIG_SCHEMA_VERSION;

export interface ModelRef {
  groupId: string;
  name: string;
}

export type SpiritModelCapabilityV2 =
  | "languageModel"
  | "image"
  | "video"
  | "imageGeneration"
  | "videoGeneration";

export type SpiritModelReasoningModeV2 = "standard" | "pro";

export type SpiritModelReasoningEffortV2 =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type SpiritTransportKindV2 =
  | "openai-compatible"
  | "open-responses"
  | "anthropic"
  | "bedrock";

export type SpiritAlibabaBillingModeV2 = "token-plan";

export type SpiritStepfunBillingModeV2 = "step-plan";

export type SpiritGlmCodingPlanBillingModeV2 = "glm-coding-plan";

export interface ModelEntryV2 {
  name: string;
  reasoningEffort: SpiritModelReasoningEffortV2;
  reasoningMode?: SpiritModelReasoningModeV2;
  thinkingEnabled?: boolean;
  supportedReasoningEfforts?: SpiritModelReasoningEffortV2[];
  capabilities?: SpiritModelCapabilityV2[];
  contextLength?: number;
  supportsThinkingType?: "only";
  supportsThinkingSwitch?: boolean;
}

export interface ProviderGroupV2 {
  id: string;
  provider: ModelProviderId;
  label?: string;
  apiBase: string;
  transportKind?: SpiritTransportKindV2;
  providerSite?: string;
  alibabaWorkspaceId?: string;
  alibabaBillingMode?: SpiritAlibabaBillingModeV2;
  stepfunBillingMode?: SpiritStepfunBillingModeV2;
  zAiBillingMode?: SpiritGlmCodingPlanBillingModeV2;
  zhipuBillingMode?: SpiritGlmCodingPlanBillingModeV2;
  awsRegion?: string;
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  vertexProject?: string;
  vertexLocation?: string;
  models: ModelEntryV2[];
}

export interface SpiritConfigV2Core {
  schemaVersion: SpiritConfigSchemaVersion;
  providerGroups: ProviderGroupV2[];
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  secondaryLanguageModel?: ModelRef;
}

export class SpiritConfigSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpiritConfigSchemaError";
  }
}

export function emptyModelRef(): ModelRef {
  return { groupId: "", name: "" };
}

export function modelRefKey(ref: ModelRef): string {
  return `${ref.groupId}::${ref.name}`;
}

export function modelRefsEqual(a: ModelRef | undefined, b: ModelRef | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return a.groupId === b.groupId && a.name === b.name;
}

export function isEmptyModelRef(ref: ModelRef | undefined): boolean {
  return !ref?.groupId?.trim() || !ref?.name?.trim();
}

export function assertSpiritConfigSchemaVersion(raw: unknown): void {
  const version =
    typeof raw === "object" && raw !== null && "schemaVersion" in raw
      ? (raw as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version !== SPIRIT_CONFIG_SCHEMA_VERSION) {
    throw new SpiritConfigSchemaError(
      `config.json must be schemaVersion ${SPIRIT_CONFIG_SCHEMA_VERSION}; delete the old config and reconnect a provider.`,
    );
  }
}

export function parseModelRef(value: unknown): ModelRef | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const groupId =
    typeof (value as ModelRef).groupId === "string" ? (value as ModelRef).groupId.trim() : "";
  const name = typeof (value as ModelRef).name === "string" ? (value as ModelRef).name.trim() : "";
  if (!groupId || !name) {
    return undefined;
  }
  return { groupId, name };
}

export function slugifyProviderGroupLabel(label: string): string {
  const trimmed = label.trim().toLowerCase();
  const slug = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "custom-group";
}

export function findProviderGroup(
  groups: readonly ProviderGroupV2[],
  groupId: string,
): ProviderGroupV2 | undefined {
  const normalized = groupId.trim();
  if (!normalized) {
    return undefined;
  }
  return groups.find((group) => group.id === normalized);
}

export function findModelEntryInGroup(
  group: ProviderGroupV2,
  name: string,
): ModelEntryV2 | undefined {
  const normalized = name.trim();
  if (!normalized) {
    return undefined;
  }
  return group.models.find((model) => model.name === normalized);
}

export function findModelByRef(
  groups: readonly ProviderGroupV2[],
  ref: ModelRef | undefined,
): { group: ProviderGroupV2; model: ModelEntryV2 } | undefined {
  if (!ref || isEmptyModelRef(ref)) {
    return undefined;
  }
  const group = findProviderGroup(groups, ref.groupId);
  if (!group) {
    return undefined;
  }
  const model = findModelEntryInGroup(group, ref.name);
  if (!model) {
    return undefined;
  }
  return { group, model };
}

export function modelExistsInGroup(
  groups: readonly ProviderGroupV2[],
  groupId: string,
  name: string,
): boolean {
  const group = findProviderGroup(groups, groupId);
  if (!group) {
    return false;
  }
  return findModelEntryInGroup(group, name) !== undefined;
}

export function listAllModelRefs(groups: readonly ProviderGroupV2[]): ModelRef[] {
  const refs: ModelRef[] = [];
  for (const group of groups) {
    for (const model of group.models) {
      refs.push({ groupId: group.id, name: model.name });
    }
  }
  return refs;
}

export function defaultPresetProviderGroupId(provider: ModelProviderId): string {
  return provider;
}
