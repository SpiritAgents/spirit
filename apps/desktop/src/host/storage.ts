import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import i18n from "../lib/i18n-host.js";
import {
  DEFAULT_TRANSLUCENCY,
  parseTranslucencyPreference,
  type TranslucencyPreference,
} from "../lib/translucency.js";
import { deleteKeyringPassword, getKeyringPassword, setKeyringPassword } from "./keyring-secret.js";
import {
  configureLlmClientVersion,
  configureLlmHttpVersion,
  normalizeLlmHttpVersion,
  type LlmHttpVersion,
} from "@spiritagent/agent-core";
import {
  normalizeModelReasoningEffort,
  resolveModelReasoningEffortForContext,
  resolveModelReasoningMode,
} from "@spiritagent/agent-core/reasoning-effort";
import {
  assertSpiritConfigSchemaVersion,
  createFileExtensionStateStore,
  emptyModelRef,
  findModelByRef,
  listAllModelRefs,
  parseModelProviderId,
  parseModelRef,
  SPIRIT_CONFIG_SCHEMA_VERSION,
  type ExtensionManagementContext,
  type ExtensionStateStore,
  loadHostInstructionMetadata,
  type HostInstructionMetadataSummary,
  type HostRuleDiscoveryResult,
  type HostSkillDiscoveryResult,
  type ModelEntryV2,
  type ModelRef,
  type PermissionConfig,
  type ProviderGroupV2,
  resolveSessionTranscriptFilePath,
  resolveDefaultSpiritDataDir,
  resolveSpiritDataDir,
} from "@spiritagent/host-internal";

import { resolveDesktopAgentMode, type DesktopAgentMode } from "../lib/agent-mode.js";
import { flattenProviderGroups, resolveModelProfile } from "./model-config-access.js";
import { normalizeContextUsageSnapshot } from "../lib/context-usage.js";
import { parseModelContextLength } from "../lib/model-context-length.js";

import type {
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopTransportKind,
  ModelProfileSnapshot,
  SessionListItem,
} from "../types.js";
import type { StoredDesktopSession } from "./contracts.js";
import {
  assertChatSchemaVersionV2,
  assertNoLegacyConversationFields,
  ChatSessionSchemaError,
  timelinePersistedSnapshotToMessages,
  validateTimelineSnapshotV2,
  type PersistedDesktopTimelineTurnSnapshot,
} from "./chat-schema.js";
import {
  buildModelSecretKeyPresence,
  groupAccessKeyIdAccount,
  groupKeyAccount,
  groupSecretAccessKeyAccount,
  groupVertexClientEmailAccount,
  groupVertexPrivateKeyAccount,
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
  type BedrockProviderCredentials,
  type GoogleVertexProviderCredentials,
  type ModelKeyPresenceProfile,
} from "./provider-api-key.js";
import { normalizeDesktopRewindMetadata } from "./rewind.js";

export { SpiritConfigSchemaError as ConfigSchemaError } from "@spiritagent/host-internal";
export {
  buildModelSecretKeyPresence,
  groupKeyAccount,
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
} from "./provider-api-key.js";

export const DEFAULT_API_BASE = "https://api.openai.com/v1";
export const DEFAULT_DESKTOP_WEB_HOST = "127.0.0.1";
export const DEFAULT_DESKTOP_WEB_PORT = 7788;
const CONFIG_FILE_NAME = "config.json";
const CHATS_DIR_NAME = "chats";
const PROVISIONAL_CHATS_DIR_NAME = "__provisional__";
const MAX_RECENT_WORKSPACES = 20;
const MODEL_CAPABILITIES = [
  "chat",
  "image",
  "video",
  "imageGeneration",
  "videoGeneration",
] as const;
const DEFAULT_CUSTOM_MODEL_CAPABILITIES: DesktopModelCapability[] = ["chat", "image"];

export type DesktopWorkspaceBinding = "project" | "none";

export interface DesktopDreamConfigFile {
  enabled: boolean;
  collectorModel?: ModelRef;
  debugMode: boolean;
}

export interface DesktopLspConfigFile {
  enabled: boolean;
}

export interface DesktopCodeCompletionConfigFile {
  enabled: boolean;
}

export interface DesktopAttributionToggleConfigFile {
  enabled: boolean;
}

export interface DesktopAttributionConfigFile {
  commit: DesktopAttributionToggleConfigFile;
  pr: DesktopAttributionToggleConfigFile;
}

export interface DesktopAgentsConfigFile {
  lsp: DesktopLspConfigFile;
  codeCompletion: DesktopCodeCompletionConfigFile;
  attribution: DesktopAttributionConfigFile;
}

export interface DesktopNetworksConfigFile {
  llmHttpVersion: LlmHttpVersion;
}

export interface DesktopConfigFile {
  schemaVersion: typeof SPIRIT_CONFIG_SCHEMA_VERSION;
  providerGroups: ProviderGroupV2[];
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  lightweightChatModel?: ModelRef;
  recentWorkspaces?: string[];
  /** When `none`, cwd is the user home directory and workspace-scoped instructions/MCP are skipped. */
  workspaceBinding?: DesktopWorkspaceBinding;
  /** Last project workspace root before switching to `none`; used when re-selecting a workspace. */
  lastProjectWorkspaceRoot?: string;
  uiLocale?: string;
  translucency?: TranslucencyPreference;
  systemNotifications?: boolean;
  /** Whether to show the menu bar / tray status icon; defaults to true. */
  trayIcon?: boolean;
  /** Whether first-run onboarding (OOBE) has completed; treated as incomplete by default. */
  onboardingCompleted?: boolean;
  agentMode?: DesktopAgentMode;
  /** @deprecated use agentMode. */
  planMode?: boolean;
  webHost: DesktopWebHostConfigFile;
  dreams: DesktopDreamConfigFile;
  agents: DesktopAgentsConfigFile;
  networks: DesktopNetworksConfigFile;
  /** Three-state permission allowlist; written by host-internal `savePermissionRule`. Desktop round-trips this so saves do not drop it. */
  permission?: PermissionConfig;
  /** CLI TUI layout; omitted means inline. Desktop round-trips this so saves do not drop it. */
  tui?: "inline" | "fullscreen";
}

export function normalizeWorkspaceBinding(value: unknown): DesktopWorkspaceBinding {
  return value === "none" ? "none" : "project";
}

export function resolveDesktopHomeDirectory(): string {
  return path.resolve(homedir());
}

export interface DesktopWebHostConfigFile {
  enabled: boolean;
  host: string;
  port: number;
  authTokenHash?: string;
}

/** Matches the keyring naming in `apps/cli/src/model_registry.rs`. */
const KEYRING_SERVICE = "Spirit";
const KEYRING_GLOBAL_ACCOUNT = "openai_api_key";

function modelKeyAccount(modelName: string): string {
  return `model::${modelName}`;
}

function extensionSecretAccount(extensionId: string, key: string): string {
  return `extension::${extensionId}::secret::${key}`;
}

export type RuleDiscoveryResult = HostRuleDiscoveryResult;
export type SkillDiscoveryResult = HostSkillDiscoveryResult;
export type HostMetadataSummary = HostInstructionMetadataSummary;

let spiritDataDirOverride: string | undefined;

export function setSpiritDataDirOverride(dir: string | undefined): void {
  spiritDataDirOverride = dir;
}

export { resolveDefaultSpiritDataDir };
export const resolveConfiguredSpiritDataDir = resolveSpiritDataDir;

export function spiritDataDir(): string {
  if (spiritDataDirOverride) {
    return spiritDataDirOverride;
  }

  return resolveConfiguredSpiritDataDir();
}

export function chatsDirPath(): string {
  return path.join(spiritDataDir(), CHATS_DIR_NAME);
}

export function configFilePath(): string {
  return path.join(spiritDataDir(), CONFIG_FILE_NAME);
}

function readModelKeyFromKeyring(modelName: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, modelKeyAccount(modelName));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function readGlobalKeyFromKeyring(): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, KEYRING_GLOBAL_ACCOUNT);
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readProviderAccessKeyIdFromKeyring(groupId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, groupAccessKeyIdAccount(groupId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readProviderSecretAccessKeyFromKeyring(groupId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, groupSecretAccessKeyAccount(groupId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readProviderVertexClientEmailFromKeyring(groupId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, groupVertexClientEmailAccount(groupId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readProviderVertexPrivateKeyFromKeyring(groupId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, groupVertexPrivateKeyAccount(groupId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readBedrockProviderCredentialsFromKeyring(
  groupId: string,
): BedrockProviderCredentials {
  return {
    apiKey: readProviderKeyFromKeyring(groupId),
    accessKeyId: readProviderAccessKeyIdFromKeyring(groupId),
    secretAccessKey: readProviderSecretAccessKeyFromKeyring(groupId),
  };
}

export async function saveBedrockProviderCredentialsForProvider(
  groupId: string,
  credentials: BedrockProviderCredentials,
): Promise<void> {
  const apiKey = credentials.apiKey?.trim();
  if (apiKey) {
    await saveApiKeyForProvider(groupId, apiKey);
  } else {
    await removeProviderApiKey(groupId);
  }

  const accessKeyId = credentials.accessKeyId?.trim();
  if (accessKeyId) {
    setKeyringPassword(KEYRING_SERVICE, groupAccessKeyIdAccount(groupId), accessKeyId);
  } else {
    deleteKeyringPassword(KEYRING_SERVICE, groupAccessKeyIdAccount(groupId));
  }

  const secretAccessKey = credentials.secretAccessKey?.trim();
  if (secretAccessKey) {
    setKeyringPassword(KEYRING_SERVICE, groupSecretAccessKeyAccount(groupId), secretAccessKey);
  } else {
    deleteKeyringPassword(KEYRING_SERVICE, groupSecretAccessKeyAccount(groupId));
  }
}

export async function removeBedrockProviderCredentials(groupId: string): Promise<void> {
  await removeProviderApiKey(groupId);
  deleteKeyringPassword(KEYRING_SERVICE, groupAccessKeyIdAccount(groupId));
  deleteKeyringPassword(KEYRING_SERVICE, groupSecretAccessKeyAccount(groupId));
}

export function readGoogleVertexProviderCredentialsFromKeyring(
  groupId: string,
): GoogleVertexProviderCredentials {
  return {
    apiKey: readProviderKeyFromKeyring(groupId),
    clientEmail: readProviderVertexClientEmailFromKeyring(groupId),
    privateKey: readProviderVertexPrivateKeyFromKeyring(groupId),
  };
}

export async function saveGoogleVertexProviderCredentialsForProvider(
  groupId: string,
  credentials: GoogleVertexProviderCredentials,
): Promise<void> {
  const apiKey = credentials.apiKey?.trim();
  if (apiKey) {
    await saveApiKeyForProvider(groupId, apiKey);
  } else {
    await removeProviderApiKey(groupId);
  }

  const clientEmail = credentials.clientEmail?.trim();
  if (clientEmail) {
    setKeyringPassword(KEYRING_SERVICE, groupVertexClientEmailAccount(groupId), clientEmail);
  } else {
    deleteKeyringPassword(KEYRING_SERVICE, groupVertexClientEmailAccount(groupId));
  }

  const privateKey = credentials.privateKey?.trim();
  if (privateKey) {
    setKeyringPassword(KEYRING_SERVICE, groupVertexPrivateKeyAccount(groupId), privateKey);
  } else {
    deleteKeyringPassword(KEYRING_SERVICE, groupVertexPrivateKeyAccount(groupId));
  }
}

export async function removeGoogleVertexProviderCredentials(groupId: string): Promise<void> {
  await removeProviderApiKey(groupId);
  deleteKeyringPassword(KEYRING_SERVICE, groupVertexClientEmailAccount(groupId));
  deleteKeyringPassword(KEYRING_SERVICE, groupVertexPrivateKeyAccount(groupId));
}

export function readProviderKeyFromKeyring(groupId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, groupKeyAccount(groupId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function defaultNewSessionPath(): string {
  return path.join(chatsDirPath(), `chat-${Math.floor(Date.now() / 1000)}.json`);
}

export function provisionalChatsDirPath(): string {
  return path.join(chatsDirPath(), PROVISIONAL_CHATS_DIR_NAME);
}

export function workspaceSessionKey(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot.trim() || process.cwd());
  return createHash("sha256").update(resolved).digest("hex").slice(0, 16);
}

/** Stable in-memory-only session slot per workspace; never listed in the sidebar until first send. */
export function provisionalNewSessionPath(workspaceRoot: string): string {
  return path.join(provisionalChatsDirPath(), `${workspaceSessionKey(workspaceRoot)}.json`);
}

/** Per split-pane provisional slot; not listed until first send. */
export function splitPaneSessionPath(paneId: string): string {
  const normalizedPaneId = paneId.trim().replace(/[^a-zA-Z0-9_-]+/gu, "-");
  return path.join(provisionalChatsDirPath(), `split-${normalizedPaneId}.json`);
}

/** Side-chat pane slot: fork copy persisted here, never listed or promoted to stable chat. */
export function sideChatPaneSessionPath(paneId: string): string {
  const normalizedPaneId = paneId.trim().replace(/[^a-zA-Z0-9_-]+/gu, "-");
  return path.join(provisionalChatsDirPath(), `side-chat-${normalizedPaneId}.json`);
}

export function isSideChatProvisionalSessionPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const provisionalDir = path.resolve(provisionalChatsDirPath());
  const relative = path.relative(provisionalDir, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  return path.basename(resolved).startsWith("side-chat-");
}

/** Inverse of sideChatPaneSessionPath for rehydrating in-memory side-chat bundles. */
export function parseSideChatPaneIdFromSessionPath(filePath: string): string | null {
  if (!isSideChatProvisionalSessionPath(filePath)) {
    return null;
  }
  const base = path.basename(filePath, ".json");
  if (!base.startsWith("side-chat-")) {
    return null;
  }
  const paneId = base.slice("side-chat-".length).trim();
  return paneId.length > 0 ? paneId : null;
}

export function isSplitProvisionalSessionPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const provisionalDir = path.resolve(provisionalChatsDirPath());
  const relative = path.relative(provisionalDir, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  return path.basename(resolved).startsWith("split-");
}

/** Inverse of splitPaneSessionPath for rehydrating in-memory split bundles. */
export function parseSplitPaneIdFromSessionPath(filePath: string): string | null {
  if (!isSplitProvisionalSessionPath(filePath)) {
    return null;
  }
  const base = path.basename(filePath, ".json");
  if (!base.startsWith("split-")) {
    return null;
  }
  const paneId = base.slice("split-".length).trim();
  return paneId.length > 0 ? paneId : null;
}

export function isProvisionalSessionPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const provisionalDir = path.resolve(provisionalChatsDirPath());
  const relative = path.relative(provisionalDir, resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function discoverWorkspaceRoot(start = process.cwd()): string {
  if (process.env.SPIRIT_WORKSPACE_ROOT?.trim()) {
    return path.resolve(process.env.SPIRIT_WORKSPACE_ROOT.trim());
  }

  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(path.join(current, "apps", "cli")) &&
      existsSync(path.join(current, "packages", "agent-core"))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return path.resolve(start);
}

export async function loadConfig(): Promise<DesktopConfigFile> {
  const filePath = configFilePath();
  if (!existsSync(filePath)) {
    const initial = defaultConfig();
    await saveConfig(initial);
    return initial;
  }

  const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  assertSpiritConfigSchemaVersion(raw);
  return normalizeConfig(raw as Partial<DesktopConfigFile>);
}

export async function saveConfig(config: DesktopConfigFile): Promise<void> {
  const filePath = configFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function resolveApiKeyForModel(
  groupId: string,
  modelName?: string,
): Promise<string | undefined> {
  const envKey = process.env.SPIRIT_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const groupKey = readProviderKeyFromKeyring(groupId);
  if (groupKey) {
    return groupKey;
  }

  if (modelName) {
    const modelKey = readModelKeyFromKeyring(modelName);
    if (modelKey) {
      return modelKey;
    }
  }

  return readGlobalKeyFromKeyring();
}

export async function hasApiKeyForModel(groupId: string, modelName?: string): Promise<boolean> {
  return Boolean(await resolveApiKeyForModel(groupId, modelName));
}

export async function resolveApiKeyForConfigModel(
  config: Pick<DesktopConfigFile, "providerGroups">,
  ref: ModelRef,
): Promise<string | undefined> {
  const profile = resolveModelProfile(config, ref);
  if (!profile) {
    return undefined;
  }
  return resolveApiKeyForModel(profile.groupId, profile.name);
}

function normalizePresenceProfiles(
  profiles: ModelKeyPresenceProfile[] | ModelProfileSnapshot[],
): ModelKeyPresenceProfile[] {
  if (profiles.length === 0) {
    return [];
  }
  const first = profiles[0];
  if ("apiBase" in first && typeof first === "object" && first !== null) {
    return (profiles as ModelProfileSnapshot[]).map(toModelKeyPresenceProfile);
  }
  return profiles as ModelKeyPresenceProfile[];
}

function hasGroupSecretInKeyring(groupId: string, profile: ModelKeyPresenceProfile): boolean {
  if (readProviderKeyFromKeyring(groupId)) {
    return true;
  }
  if (profile.provider === "amazon-bedrock") {
    return hasBedrockRuntimeCredentials(readBedrockProviderCredentialsFromKeyring(groupId));
  }
  if (profile.provider === "google-vertex-ai") {
    const credentials = readGoogleVertexProviderCredentialsFromKeyring(groupId);
    return hasGoogleVertexRuntimeCredentials({
      apiKey: credentials.apiKey,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey,
      vertexProject: profile.vertexProject,
      vertexLocation: profile.vertexLocation,
    });
  }
  return false;
}

function toModelKeyPresenceProfile(model: ModelProfileSnapshot): ModelKeyPresenceProfile {
  const groupId = model.groupId?.trim() ?? model.ref?.groupId?.trim() ?? "";
  if (!groupId) {
    throw new Error(`model profile "${model.name}" is missing groupId`);
  }
  return {
    groupId,
    name: model.name,
    provider: model.provider,
    ...(model.vertexProject ? { vertexProject: model.vertexProject } : {}),
    ...(model.vertexLocation ? { vertexLocation: model.vertexLocation } : {}),
  };
}

function legacyModelKeyPresent(refKey: string): boolean {
  const separatorIndex = refKey.lastIndexOf("::");
  const modelName = separatorIndex >= 0 ? refKey.slice(separatorIndex + 2) : refKey;
  return Boolean(readModelKeyFromKeyring(modelName));
}

/** Whether each model has a provider-group-level or legacy model-level entry in the keychain (excluding env vars and the global fallback). */
export async function modelSecretKeyPresence(
  input:
    | Pick<DesktopConfigFile, "providerGroups">
    | ModelKeyPresenceProfile[]
    | ModelProfileSnapshot[],
): Promise<Record<string, boolean>> {
  const profiles =
    "providerGroups" in input
      ? flattenProviderGroups(input).map(toModelKeyPresenceProfile)
      : normalizePresenceProfiles(input);
  return buildModelSecretKeyPresence(profiles, hasGroupSecretInKeyring, legacyModelKeyPresent);
}

export async function saveApiKeyForModel(modelName: string, apiKey: string): Promise<void> {
  setKeyringPassword(KEYRING_SERVICE, modelKeyAccount(modelName), apiKey.trim());
}

export async function saveApiKeyForProvider(groupId: string, apiKey: string): Promise<void> {
  setKeyringPassword(KEYRING_SERVICE, groupKeyAccount(groupId), apiKey.trim());
}

/** Deletes the provider group's shared API Key entry from the keychain. */
export async function removeProviderApiKey(groupId: string): Promise<void> {
  deleteKeyringPassword(KEYRING_SERVICE, groupKeyAccount(groupId));
}

/** Consistent with CLI `remove_model_api_key`: deletes the model's dedicated keychain entry. */
export async function removeModelApiKey(modelName: string): Promise<void> {
  deleteKeyringPassword(KEYRING_SERVICE, modelKeyAccount(modelName));
}

export function createDesktopExtensionStateStore(
  context: ExtensionManagementContext = {
    spiritDataDir: spiritDataDir(),
    hostKind: "desktop",
  },
): ExtensionStateStore {
  const fileStore = createFileExtensionStateStore(context);

  return {
    loadSettings(extensionId) {
      return fileStore.loadSettings(extensionId);
    },
    saveSettings(extensionId, values) {
      return fileStore.saveSettings(extensionId, values);
    },
    async loadSecret(extensionId, key) {
      const value = getKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
      const trimmed = value?.trim();
      return trimmed || undefined;
    },
    async saveSecret(extensionId, key, value) {
      setKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key), value.trim());
    },
    async deleteSecret(extensionId, key) {
      deleteKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
    },
    async hasSecret(extensionId, key) {
      const value = getKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
      return Boolean(value?.trim());
    },
  };
}

export async function loadHostMetadata(
  workspaceRoot: string,
  agentMode: DesktopAgentMode = "agent",
  options?: { activePlanPath?: string; workspaceBinding?: DesktopWorkspaceBinding },
): Promise<HostMetadataSummary> {
  const workspaceBinding = options?.workspaceBinding ?? "project";
  return loadHostInstructionMetadata(
    {
      workspaceRoot,
      spiritDataDir: spiritDataDir(),
      includeWorkspaceScope: workspaceBinding === "project",
    },
    {
      agentMode,
      activePlanPath: options?.activePlanPath,
    },
  );
}

function normalizeStoredSession(parsed: Partial<StoredDesktopSession>): StoredDesktopSession {
  const raw = parsed as Record<string, unknown>;
  assertChatSchemaVersionV2(parsed.chatSchemaVersion);
  assertNoLegacyConversationFields(raw);
  if ("subagentDesktopMessages" in raw) {
    throw new ChatSessionSchemaError("chat schema v2 must not include subagentDesktopMessages");
  }
  if (!Array.isArray(parsed.desktopMessageTimeline)) {
    throw new ChatSessionSchemaError("desktopMessageTimeline is required in chat schema v2");
  }
  const desktopMessageTimeline =
    parsed.desktopMessageTimeline as PersistedDesktopTimelineTurnSnapshot[];
  validateTimelineSnapshotV2(desktopMessageTimeline);

  const contextUsage = normalizeContextUsageSnapshot(parsed.contextUsage);
  return {
    chatSchemaVersion: 2,
    llmHistory: Array.isArray(parsed.llmHistory) ? parsed.llmHistory : [],
    subagentSessions: Array.isArray(parsed.subagentSessions) ? parsed.subagentSessions : [],
    loopEnabled: parsed.loopEnabled === true,
    ...(parsed.approvalLevel === "default" ||
    parsed.approvalLevel === "auto-approval" ||
    parsed.approvalLevel === "bypass-approval"
      ? { approvalLevel: parsed.approvalLevel }
      : {}),
    ...(typeof parsed.activeModel === "string" && parsed.activeModel.trim()
      ? { activeModel: parsed.activeModel.trim() }
      : {}),
    desktopMessageTimeline,
    savedAtUnixMs: typeof parsed.savedAtUnixMs === "number" ? parsed.savedAtUnixMs : Date.now(),
    ...(normalizeDisplayName(parsed.sessionDisplayName)
      ? { sessionDisplayName: normalizeDisplayName(parsed.sessionDisplayName) }
      : {}),
    ...(parsed.sessionTitleSource === "seed" ||
    parsed.sessionTitleSource === "llm" ||
    parsed.sessionTitleSource === "manual"
      ? { sessionTitleSource: parsed.sessionTitleSource }
      : {}),
    ...(normalizePinnedAtUnixMs(parsed.pinnedAtUnixMs)
      ? { pinnedAtUnixMs: normalizePinnedAtUnixMs(parsed.pinnedAtUnixMs) }
      : {}),
    ...(resolveStoredWorkspaceRoot(parsed.workspaceRoot)
      ? { workspaceRoot: resolveStoredWorkspaceRoot(parsed.workspaceRoot) }
      : {}),
    ...(normalizeGitBranch(parsed.gitBranch)
      ? { gitBranch: normalizeGitBranch(parsed.gitBranch) }
      : {}),
    ...(typeof parsed.activePlanPath === "string" && parsed.activePlanPath.trim()
      ? { activePlanPath: parsed.activePlanPath.trim() }
      : {}),
    ...(contextUsage ? { contextUsage } : {}),
    rewind: normalizeDesktopRewindMetadata(parsed.rewind),
    ...(parsed.subagentDesktopTimelines && typeof parsed.subagentDesktopTimelines === "object"
      ? {
          subagentDesktopTimelines: parsed.subagentDesktopTimelines as Record<
            string,
            PersistedDesktopTimelineTurnSnapshot[]
          >,
        }
      : {}),
    ...(typeof parsed.automationId === "string" && parsed.automationId.trim()
      ? { automationId: parsed.automationId.trim() }
      : {}),
    ...(typeof parsed.automationRunId === "string" && parsed.automationRunId.trim()
      ? { automationRunId: parsed.automationRunId.trim() }
      : {}),
  } satisfies StoredDesktopSession;
}

export async function listStoredSessions(): Promise<SessionListItem[]> {
  const dirPath = chatsDirPath();
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name))
    .filter((filePath) => !isProvisionalSessionPath(filePath));

  const loaded = await Promise.all(
    files.map(async (filePath) => {
      try {
        const raw = await readFile(filePath, "utf8");
        // The sidebar list only needs metadata: do just the schema version check and read fields directly,
        // skipping normalizeStoredSession's full timeline validation and rewind normalization
        const parsed = JSON.parse(raw) as Partial<StoredDesktopSession>;
        assertChatSchemaVersionV2(parsed.chatSchemaVersion);
        const timeline = Array.isArray(parsed.desktopMessageTimeline)
          ? (parsed.desktopMessageTimeline as PersistedDesktopTimelineTurnSnapshot[])
          : undefined;
        const gitBranch = normalizeGitBranch(parsed.gitBranch);
        const pinnedAtUnixMs = normalizePinnedAtUnixMs(parsed.pinnedAtUnixMs);
        const modifiedAtUnixMs =
          typeof parsed.savedAtUnixMs === "number"
            ? parsed.savedAtUnixMs
            : Math.round((await stat(filePath)).mtimeMs);
        return {
          path: filePath,
          displayName:
            normalizeDisplayName(parsed.sessionDisplayName) ??
            deriveDisplayNameFromTimeline(timeline),
          workspaceRoot:
            resolveStoredWorkspaceRoot(parsed.workspaceRoot) ?? discoverWorkspaceRoot(),
          ...(gitBranch ? { gitBranch } : {}),
          ...(pinnedAtUnixMs ? { pinnedAtUnixMs } : {}),
          modifiedAtUnixMs,
          transcriptPath: resolveSessionTranscriptFilePath(spiritDataDir(), path.resolve(filePath)),
        } satisfies SessionListItem;
      } catch (error) {
        console.warn(`[desktop-host] skip unreadable session file: ${filePath}`, error);
        return undefined;
      }
    }),
  );

  return loaded
    .filter((item): item is SessionListItem => item !== undefined)
    .sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs);
}

export async function loadStoredSession(filePath: string): Promise<StoredDesktopSession> {
  const resolved = resolveSessionPath(filePath);
  const raw = await readFile(resolved, "utf8");
  return normalizeStoredSession(JSON.parse(raw) as Partial<StoredDesktopSession>);
}

export async function saveStoredSession(
  filePath: string | undefined,
  session: StoredDesktopSession,
): Promise<string> {
  const resolved = resolveSessionPath(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  // Atomic write: write a tmp file in the same directory, then rename, so a crash / power loss mid-write cannot leave a truncated session file
  const tmpPath = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    await rename(tmpPath, resolved);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
  return resolved;
}

export async function deleteStoredSession(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  const chatsDir = path.resolve(chatsDirPath());
  const relative = path.relative(chatsDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(i18n.t("error.invalidSessionPath"));
  }
  if (existsSync(resolved)) {
    await unlink(resolved);
  }
}

function defaultConfig(): DesktopConfigFile {
  return {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providerGroups: [],
    activeModel: emptyModelRef(),
    recentWorkspaces: [],
    translucency: DEFAULT_TRANSLUCENCY,
    systemNotifications: true,
    trayIcon: true,
    onboardingCompleted: false,
    agentMode: "agent",
    webHost: defaultWebHostConfig(),
    dreams: defaultDreamConfig(),
    agents: defaultAgentsConfig(),
    networks: defaultNetworksConfig(),
  };
}

function normalizeGitBranch(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizePinnedAtUnixMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function defaultWebHostConfig(): DesktopWebHostConfigFile {
  return {
    enabled: false,
    host: DEFAULT_DESKTOP_WEB_HOST,
    port: DEFAULT_DESKTOP_WEB_PORT,
  };
}

export function defaultDreamConfig(): DesktopDreamConfigFile {
  return {
    enabled: false,
    debugMode: false,
  };
}

export function defaultAgentsConfig(): DesktopAgentsConfigFile {
  return {
    lsp: {
      enabled: true,
    },
    codeCompletion: {
      enabled: true,
    },
    attribution: {
      commit: {
        enabled: true,
      },
      pr: {
        enabled: true,
      },
    },
  };
}

export function defaultNetworksConfig(): DesktopNetworksConfigFile {
  return {
    llmHttpVersion: "http2",
  };
}

export function normalizeNetworksConfig(raw: unknown): DesktopNetworksConfigFile {
  const record =
    typeof raw === "object" && raw !== null ? (raw as Partial<DesktopNetworksConfigFile>) : {};
  return {
    llmHttpVersion: normalizeLlmHttpVersion(record.llmHttpVersion),
  };
}

function resolveDesktopPackageJsonPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "../../../package.json"),
    path.join(moduleDir, "../../package.json"),
  ];
  const packageJsonPath = candidates.find((candidate) => existsSync(candidate));
  if (!packageJsonPath) {
    throw new Error(`Desktop package.json not found (searched upward from ${moduleDir})`);
  }
  return packageJsonPath;
}

let cachedDesktopAppVersion: string | undefined;

export function resolveDesktopAppVersion(): string {
  cachedDesktopAppVersion ??= (
    JSON.parse(readFileSync(resolveDesktopPackageJsonPath(), "utf8")) as { version: string }
  ).version;
  return cachedDesktopAppVersion;
}

export function applyLlmClientVersionFromApp(): void {
  configureLlmClientVersion(resolveDesktopAppVersion());
}

export function applyLlmHttpVersionFromConfig(config: Pick<DesktopConfigFile, "networks">): void {
  configureLlmHttpVersion(config.networks.llmHttpVersion);
}

export function normalizeAgentsConfig(raw: unknown): DesktopAgentsConfigFile {
  const record =
    typeof raw === "object" && raw !== null ? (raw as Partial<DesktopAgentsConfigFile>) : {};
  const lspRaw =
    typeof record.lsp === "object" && record.lsp !== null
      ? (record.lsp as Partial<DesktopLspConfigFile>)
      : {};
  const codeCompletionRaw =
    typeof record.codeCompletion === "object" && record.codeCompletion !== null
      ? (record.codeCompletion as Partial<DesktopCodeCompletionConfigFile>)
      : {};
  const attributionRaw =
    typeof record.attribution === "object" && record.attribution !== null
      ? (record.attribution as Partial<DesktopAttributionConfigFile>)
      : {};
  const commitRaw =
    typeof attributionRaw.commit === "object" && attributionRaw.commit !== null
      ? (attributionRaw.commit as Partial<DesktopAttributionToggleConfigFile>)
      : {};
  const prRaw =
    typeof attributionRaw.pr === "object" && attributionRaw.pr !== null
      ? (attributionRaw.pr as Partial<DesktopAttributionToggleConfigFile>)
      : {};
  return {
    lsp: {
      enabled: lspRaw.enabled !== false,
    },
    codeCompletion: {
      enabled: codeCompletionRaw.enabled !== false,
    },
    // Desktop: default / OOBE enables it (opt-out); on the CLI side a missing field is treated as OFF
    attribution: {
      commit: {
        enabled: commitRaw.enabled !== false,
      },
      pr: {
        enabled: prRaw.enabled !== false,
      },
    },
  };
}

function normalizeProviderGroup(raw: unknown): ProviderGroupV2 | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Partial<ProviderGroupV2>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const provider = parseModelProviderId(record.provider);
  if (!id || !provider) {
    return null;
  }
  const label =
    typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined;
  const resolvedLabel = provider === "custom" && !label ? id : label;
  const apiBase =
    typeof record.apiBase === "string" && record.apiBase.trim()
      ? record.apiBase.trim()
      : DEFAULT_API_BASE;
  const transportKind = normalizeDesktopTransportKind(record.transportKind, provider);
  const providerSite =
    typeof record.providerSite === "string" && record.providerSite.trim().length > 0
      ? record.providerSite.trim()
      : undefined;
  const alibabaWorkspaceId =
    typeof record.alibabaWorkspaceId === "string" && record.alibabaWorkspaceId.trim().length > 0
      ? record.alibabaWorkspaceId.trim()
      : undefined;
  const alibabaBillingMode =
    record.alibabaBillingMode === "token-plan" ? ("token-plan" as const) : undefined;
  const stepfunBillingMode =
    record.stepfunBillingMode === "step-plan" ? ("step-plan" as const) : undefined;
  const zAiBillingMode =
    record.zAiBillingMode === "glm-coding-plan" ? ("glm-coding-plan" as const) : undefined;
  const zhipuBillingMode =
    record.zhipuBillingMode === "glm-coding-plan" ? ("glm-coding-plan" as const) : undefined;
  const awsRegion =
    typeof record.awsRegion === "string" && record.awsRegion.trim().length > 0
      ? record.awsRegion.trim()
      : undefined;
  const vertexProject =
    typeof record.vertexProject === "string" && record.vertexProject.trim().length > 0
      ? record.vertexProject.trim()
      : undefined;
  const vertexLocation =
    typeof record.vertexLocation === "string" && record.vertexLocation.trim().length > 0
      ? record.vertexLocation.trim()
      : undefined;
  const azureResourceName =
    typeof record.azureResourceName === "string" && record.azureResourceName.trim().length > 0
      ? record.azureResourceName.trim()
      : undefined;
  const cloudflareAccountId =
    typeof record.cloudflareAccountId === "string" && record.cloudflareAccountId.trim().length > 0
      ? record.cloudflareAccountId.trim()
      : undefined;
  const cloudflareGatewayId =
    typeof record.cloudflareGatewayId === "string" && record.cloudflareGatewayId.trim().length > 0
      ? record.cloudflareGatewayId.trim()
      : undefined;
  if (provider === "azure" && !azureResourceName) {
    return null;
  }
  if (provider === "cloudflare-ai-gateway" && (!cloudflareAccountId || !cloudflareGatewayId)) {
    return null;
  }

  const models = Array.isArray(record.models)
    ? record.models
        .map((model) => normalizeModelEntry(model, provider, transportKind))
        .filter((model): model is ModelEntryV2 => model !== null)
    : [];

  const seenNames = new Set<string>();
  const dedupedModels = models.filter((model) => {
    if (seenNames.has(model.name)) {
      return false;
    }
    seenNames.add(model.name);
    return true;
  });

  return {
    id,
    provider,
    ...(resolvedLabel ? { label: resolvedLabel } : {}),
    apiBase,
    ...(transportKind ? { transportKind } : {}),
    ...(providerSite ? { providerSite } : {}),
    ...(alibabaWorkspaceId ? { alibabaWorkspaceId } : {}),
    ...(alibabaBillingMode ? { alibabaBillingMode } : {}),
    ...(stepfunBillingMode ? { stepfunBillingMode } : {}),
    ...(zAiBillingMode ? { zAiBillingMode } : {}),
    ...(zhipuBillingMode ? { zhipuBillingMode } : {}),
    ...(awsRegion ? { awsRegion } : {}),
    ...(vertexProject ? { vertexProject } : {}),
    ...(vertexLocation ? { vertexLocation } : {}),
    ...(azureResourceName ? { azureResourceName } : {}),
    ...(cloudflareAccountId ? { cloudflareAccountId } : {}),
    ...(cloudflareGatewayId ? { cloudflareGatewayId } : {}),
    models: dedupedModels,
  };
}

function normalizeModelEntry(
  raw: unknown,
  provider: DesktopModelProvider,
  transportKind: DesktopTransportKind | undefined,
): ModelEntryV2 | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Partial<ModelEntryV2>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    return null;
  }
  const capabilities = normalizeModelCapabilities(record.capabilities);
  const supportedReasoningEfforts = normalizeSupportedReasoningEfforts(
    record.supportedReasoningEfforts,
  );
  const contextLength = parseModelContextLength(record.contextLength);
  const supportsThinkingType =
    record.supportsThinkingType === "only" ? ("only" as const) : undefined;
  const supportsThinkingSwitch =
    record.supportsThinkingSwitch === true ? (true as const) : undefined;
  const reasoningContext = {
    provider,
    model: name,
    ...(transportKind ? { transportKind } : {}),
    ...(supportedReasoningEfforts !== undefined
      ? { supportedEfforts: supportedReasoningEfforts }
      : {}),
    ...(supportsThinkingType ? { supportsThinkingType } : {}),
    ...(supportsThinkingSwitch ? { supportsThinkingSwitch } : {}),
  };
  const resolvedReasoningMode = resolveModelReasoningMode(record.reasoningMode, reasoningContext);
  return {
    name,
    reasoningEffort: resolveModelReasoningEffortForContext(
      record.reasoningEffort,
      reasoningContext,
    ) as ModelEntryV2["reasoningEffort"],
    ...(resolvedReasoningMode === "pro" ? { reasoningMode: "pro" as const } : {}),
    ...(supportedReasoningEfforts !== undefined
      ? {
          supportedReasoningEfforts:
            supportedReasoningEfforts as ModelEntryV2["supportedReasoningEfforts"],
        }
      : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(contextLength !== undefined ? { contextLength } : {}),
    ...(supportsThinkingType ? { supportsThinkingType } : {}),
    ...(supportsThinkingSwitch ? { supportsThinkingSwitch } : {}),
    ...(record.thinkingEnabled === false ? { thinkingEnabled: false } : {}),
  };
}

function normalizeConfig(raw: Partial<DesktopConfigFile>): DesktopConfigFile {
  const providerGroups = Array.isArray(raw.providerGroups)
    ? raw.providerGroups
        .map((group) => normalizeProviderGroup(group))
        .filter((group): group is ProviderGroupV2 => group !== null)
    : [];

  const seenGroupIds = new Set<string>();
  const normalizedGroups = providerGroups.filter((group) => {
    if (seenGroupIds.has(group.id)) {
      return false;
    }
    seenGroupIds.add(group.id);
    return true;
  });

  const allRefs = listAllModelRefs(normalizedGroups);
  const activeModel =
    parseModelRef(raw.activeModel) ?? (allRefs[0] ? { ...allRefs[0] } : emptyModelRef());
  const resolvedActive = findModelByRef(normalizedGroups, activeModel)
    ? activeModel
    : allRefs[0]
      ? { ...allRefs[0] }
      : emptyModelRef();

  const imageGenerationModel = normalizeImageGenerationModelRef(
    raw.imageGenerationModel,
    normalizedGroups,
  );
  const videoGenerationModel = normalizeVideoGenerationModelRef(
    raw.videoGenerationModel,
    normalizedGroups,
  );
  const dreams = normalizeDreamConfig(raw.dreams, normalizedGroups);
  const lightweightChatModel = normalizeLightweightChatModelRef(
    raw.lightweightChatModel ?? dreams.collectorModel,
    normalizedGroups,
  );

  return {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providerGroups: normalizedGroups,
    activeModel: resolvedActive,
    ...(imageGenerationModel ? { imageGenerationModel } : {}),
    ...(videoGenerationModel ? { videoGenerationModel } : {}),
    ...(lightweightChatModel ? { lightweightChatModel } : {}),
    recentWorkspaces: normalizeRecentWorkspaceRoots(raw.recentWorkspaces),
    workspaceBinding: normalizeWorkspaceBinding(raw.workspaceBinding),
    ...(typeof raw.lastProjectWorkspaceRoot === "string" && raw.lastProjectWorkspaceRoot.trim()
      ? { lastProjectWorkspaceRoot: path.resolve(raw.lastProjectWorkspaceRoot.trim()) }
      : {}),
    ...(typeof raw.uiLocale === "string" && raw.uiLocale.trim()
      ? { uiLocale: raw.uiLocale.trim() }
      : {}),
    translucency: parseTranslucencyPreference(raw.translucency),
    systemNotifications: raw.systemNotifications !== false,
    trayIcon: raw.trayIcon !== false,
    onboardingCompleted: raw.onboardingCompleted === true,
    agentMode: resolveDesktopAgentMode({ agentMode: raw.agentMode, planMode: raw.planMode }),
    webHost: normalizeWebHostConfig(raw.webHost),
    dreams,
    agents: normalizeAgentsConfig(raw.agents),
    networks: normalizeNetworksConfig(raw.networks),
    // Rule-level validation lives in host-internal permissions/config-io; desktop only
    // round-trips the block so saves do not strip it.
    ...(typeof raw.permission === "object" &&
    raw.permission !== null &&
    !Array.isArray(raw.permission)
      ? { permission: raw.permission }
      : {}),
    ...(raw.tui === "inline" || raw.tui === "fullscreen" ? { tui: raw.tui } : {}),
  };
}

function normalizeImageGenerationModelRef(
  value: unknown,
  groups: readonly ProviderGroupV2[],
): ModelRef | undefined {
  const ref = parseModelRef(value);
  if (!ref) {
    return undefined;
  }
  const resolved = findModelByRef(groups, ref);
  if (!resolved) {
    return undefined;
  }
  const capabilities = normalizeModelCapabilities(resolved.model.capabilities);
  return capabilities?.includes("imageGeneration") ? ref : undefined;
}

function normalizeVideoGenerationModelRef(
  value: unknown,
  groups: readonly ProviderGroupV2[],
): ModelRef | undefined {
  const ref = parseModelRef(value);
  if (!ref) {
    return undefined;
  }
  const resolved = findModelByRef(groups, ref);
  if (!resolved) {
    return undefined;
  }
  const capabilities = normalizeModelCapabilities(resolved.model.capabilities);
  return capabilities?.includes("videoGeneration") ? ref : undefined;
}

function normalizeLightweightChatModelRef(
  value: unknown,
  groups: readonly ProviderGroupV2[],
): ModelRef | undefined {
  const ref = parseModelRef(value);
  if (!ref) {
    return undefined;
  }
  const resolved = findModelByRef(groups, ref);
  if (!resolved) {
    return undefined;
  }
  const capabilities = normalizeModelCapabilities(resolved.model.capabilities);
  if (capabilities && !capabilities.includes("chat")) {
    return undefined;
  }
  return ref;
}

function normalizeDesktopTransportKind(
  value: unknown,
  provider?: DesktopModelProvider,
): DesktopTransportKind | undefined {
  if (provider === "azure" || provider === "openai") {
    return "open-responses";
  }

  if (
    value === "openai-compatible" ||
    value === "open-responses" ||
    value === "anthropic" ||
    value === "bedrock"
  ) {
    return value;
  }

  if (provider === "anthropic") {
    return "anthropic";
  }
  if (provider === "amazon-bedrock") {
    return "bedrock";
  }

  return undefined;
}

export function normalizeModelCapabilities(value: unknown): DesktopModelCapability[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const allowed = new Set<string>(MODEL_CAPABILITIES);
  const seen = new Set<DesktopModelCapability>();
  const normalized: DesktopModelCapability[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalizedItem = item === "vision" ? "image" : item;
    if (!allowed.has(normalizedItem)) {
      continue;
    }
    const capability = normalizedItem as DesktopModelCapability;
    if (seen.has(capability)) {
      continue;
    }
    seen.add(capability);
    normalized.push(capability);
  }

  return normalized.length > 0 ? normalized : undefined;
}

export function defaultCustomModelCapabilities(): DesktopModelCapability[] {
  return [...DEFAULT_CUSTOM_MODEL_CAPABILITIES];
}

export function normalizeSupportedReasoningEfforts(
  value: unknown,
): DesktopModelReasoningEffort[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const seen = new Set<string>();
  const normalized: DesktopModelReasoningEffort[] = [];
  for (const item of value) {
    const effort = normalizeModelReasoningEffort(item);
    if (!effort || effort === "default" || seen.has(effort)) {
      continue;
    }
    seen.add(effort);
    normalized.push(effort);
  }

  return normalized;
}

export function normalizeDreamConfig(
  raw?: Partial<DesktopDreamConfigFile>,
  groups: readonly ProviderGroupV2[] = [],
): DesktopDreamConfigFile {
  const collectorModel = normalizeLightweightChatModelRef(raw?.collectorModel, groups);
  return {
    enabled: raw?.enabled === true,
    ...(collectorModel ? { collectorModel } : {}),
    debugMode: raw?.debugMode === true,
  };
}

export function normalizeWebHostConfig(
  raw?: Partial<DesktopWebHostConfigFile>,
): DesktopWebHostConfigFile {
  const defaultConfig = defaultWebHostConfig();
  const host =
    typeof raw?.host === "string" && raw.host.trim() ? raw.host.trim() : defaultConfig.host;
  const port = normalizePort(raw?.port, defaultConfig.port);
  const authTokenHash =
    typeof raw?.authTokenHash === "string" && raw.authTokenHash.trim()
      ? raw.authTokenHash.trim()
      : undefined;

  return {
    enabled: raw?.enabled === true,
    host,
    port,
    ...(authTokenHash ? { authTokenHash } : {}),
  };
}

function normalizePort(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  return value >= 1 && value <= 65535 ? value : fallback;
}

function normalizeWorkspaceKey(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

export function resolveStoredWorkspaceRoot(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return path.resolve(value.trim());
}

function normalizeRecentWorkspaceRoots(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value) {
    const workspaceRoot = resolveStoredWorkspaceRoot(entry);
    if (!workspaceRoot) {
      continue;
    }
    const key = normalizeWorkspaceKey(workspaceRoot);
    if (key === normalizeWorkspaceKey(resolveDesktopHomeDirectory())) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(workspaceRoot);
    if (normalized.length >= MAX_RECENT_WORKSPACES) {
      break;
    }
  }

  return normalized;
}

export function mergeRecentWorkspaceRoots(
  existing: string[] | undefined,
  workspaceRoot: string,
): string[] {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const targetKey = normalizeWorkspaceKey(resolvedWorkspaceRoot);
  if (targetKey === normalizeWorkspaceKey(resolveDesktopHomeDirectory())) {
    return normalizeRecentWorkspaceRoots(existing);
  }
  return [
    resolvedWorkspaceRoot,
    ...normalizeRecentWorkspaceRoots(existing).filter(
      (entry) => normalizeWorkspaceKey(entry) !== targetKey,
    ),
  ].slice(0, MAX_RECENT_WORKSPACES);
}

export function removeRecentWorkspaceRoot(
  existing: string[] | undefined,
  workspaceRoot: string,
): string[] {
  const targetKey = normalizeWorkspaceKey(path.resolve(workspaceRoot));
  return normalizeRecentWorkspaceRoots(existing).filter(
    (entry) => normalizeWorkspaceKey(entry) !== targetKey,
  );
}

function resolveSessionPath(filePath: string | undefined): string {
  const candidate = filePath?.trim() ? filePath.trim() : defaultNewSessionPath();
  const absolute = path.isAbsolute(candidate) ? candidate : path.join(chatsDirPath(), candidate);
  return absolute.toLowerCase().endsWith(".json") ? absolute : `${absolute}.json`;
}

function deriveDisplayNameFromTimeline(
  timeline: PersistedDesktopTimelineTurnSnapshot[] | undefined,
): string {
  if (!timeline?.length) {
    return "New conversation";
  }
  const messages = timelinePersistedSnapshotToMessages(timeline);
  const firstUser = messages.find(
    (message) => message.role === "user" && message.content.trim().length > 0,
  );
  const seed = firstUser?.content ?? "New conversation";
  return seed.length > 28 ? `${seed.slice(0, 28)}…` : seed;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
