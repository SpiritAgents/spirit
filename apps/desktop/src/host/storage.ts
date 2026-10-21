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
import { normalizeModelReasoningEffort } from "@spiritagent/agent-core/reasoning-effort";
import {
  assertSpiritConfigSchemaVersion,
  createFileExtensionStateStore,
  emptyModelRef,
  findModelByRef,
  findProviderEntry,
  GOOGLE_VERTEX_SDK_PACKAGE_NAME,
  listAllModelRefs,
  parseModelRef,
  providerInternalSlotAccount,
  resolveProviderApiKey,
  SPIRIT_CONFIG_SCHEMA_VERSION,
  validateSpiritConfig,
  type ExtensionManagementContext,
  type ExtensionStateStore,
  loadHostInstructionMetadata,
  type HostInstructionMetadataSummary,
  type HostRuleDiscoveryResult,
  type HostSkillDiscoveryResult,
  type ModelRef,
  type PermissionConfig,
  type ProviderEntry,
  resolveModelByRef,
  resolveSessionTranscriptFilePath,
  resolveDefaultSpiritDataDir,
  resolveSpiritDataDir,
} from "@spiritagent/host-internal";

import { resolveDesktopAgentMode, type DesktopAgentMode } from "../lib/agent-mode.js";
import { normalizeContextUsageSnapshot } from "../lib/context-usage.js";

import type {
  DesktopModelCapability,
  DesktopModelReasoningEffort,
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
  "languageModel",
  "image",
  "audio",
  "video",
  "imageGeneration",
  "videoGeneration",
] as const;
const DEFAULT_CUSTOM_MODEL_CAPABILITIES: DesktopModelCapability[] = ["languageModel", "image"];

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

export interface DesktopWebToolToggleConfigFile {
  enabled: boolean;
}

export interface DesktopAgentsConfigFile {
  lsp: DesktopLspConfigFile;
  codeCompletion: DesktopCodeCompletionConfigFile;
  attribution: DesktopAttributionConfigFile;
  /** Opt-out switch for provider-declared tools (`agents.providerTools.enabled` in config.json). */
  providerTools: DesktopWebToolToggleConfigFile;
  webFetch: DesktopWebToolToggleConfigFile;
}

export interface DesktopNetworksConfigFile {
  llmHttpVersion: LlmHttpVersion;
}

export interface DesktopConfigFile {
  schemaVersion: typeof SPIRIT_CONFIG_SCHEMA_VERSION;
  providers: ProviderEntry[];
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  secondaryLanguageModel?: ModelRef;
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

/** Matches the keyring naming in `apps/cli/src/model_registry.rs` and host-internal. */
const KEYRING_SERVICE = "Spirit";

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

/** Internal keyring slot read: `provider::{id}` for `apiKey`, `provider::{id}::{slot}` otherwise. */
function readProviderSlotFromKeyring(providerId: string, slot: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, providerInternalSlotAccount(providerId, slot));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readProviderAccessKeyIdFromKeyring(providerId: string): string | undefined {
  return readProviderSlotFromKeyring(providerId, "accessKeyId");
}

export function readProviderSecretAccessKeyFromKeyring(providerId: string): string | undefined {
  return readProviderSlotFromKeyring(providerId, "secretAccessKey");
}

export function readProviderVertexClientEmailFromKeyring(providerId: string): string | undefined {
  return readProviderSlotFromKeyring(providerId, "clientEmail");
}

export function readProviderVertexPrivateKeyFromKeyring(providerId: string): string | undefined {
  return readProviderSlotFromKeyring(providerId, "privateKey");
}

export function readBedrockProviderCredentialsFromKeyring(
  providerId: string,
): BedrockProviderCredentials {
  return {
    apiKey: readProviderKeyFromKeyring(providerId),
    accessKeyId: readProviderAccessKeyIdFromKeyring(providerId),
    secretAccessKey: readProviderSecretAccessKeyFromKeyring(providerId),
  };
}

function writeProviderSlotToKeyring(providerId: string, slot: string, secret?: string): void {
  const account = providerInternalSlotAccount(providerId, slot);
  const trimmed = secret?.trim();
  if (trimmed) {
    setKeyringPassword(KEYRING_SERVICE, account, trimmed);
  } else {
    deleteKeyringPassword(KEYRING_SERVICE, account);
  }
}

export async function saveBedrockProviderCredentialsForProvider(
  providerId: string,
  credentials: BedrockProviderCredentials,
): Promise<void> {
  writeProviderSlotToKeyring(providerId, "apiKey", credentials.apiKey);
  writeProviderSlotToKeyring(providerId, "accessKeyId", credentials.accessKeyId);
  writeProviderSlotToKeyring(providerId, "secretAccessKey", credentials.secretAccessKey);
}

export async function removeBedrockProviderCredentials(providerId: string): Promise<void> {
  writeProviderSlotToKeyring(providerId, "apiKey", undefined);
  writeProviderSlotToKeyring(providerId, "accessKeyId", undefined);
  writeProviderSlotToKeyring(providerId, "secretAccessKey", undefined);
}

export function readGoogleVertexProviderCredentialsFromKeyring(
  providerId: string,
): GoogleVertexProviderCredentials {
  return {
    apiKey: readProviderKeyFromKeyring(providerId),
    clientEmail: readProviderVertexClientEmailFromKeyring(providerId),
    privateKey: readProviderVertexPrivateKeyFromKeyring(providerId),
  };
}

export async function saveGoogleVertexProviderCredentialsForProvider(
  providerId: string,
  credentials: GoogleVertexProviderCredentials,
): Promise<void> {
  writeProviderSlotToKeyring(providerId, "apiKey", credentials.apiKey);
  writeProviderSlotToKeyring(providerId, "clientEmail", credentials.clientEmail);
  writeProviderSlotToKeyring(providerId, "privateKey", credentials.privateKey);
}

export async function removeGoogleVertexProviderCredentials(providerId: string): Promise<void> {
  writeProviderSlotToKeyring(providerId, "apiKey", undefined);
  writeProviderSlotToKeyring(providerId, "clientEmail", undefined);
  writeProviderSlotToKeyring(providerId, "privateKey", undefined);
}

export function readProviderKeyFromKeyring(providerId: string): string | undefined {
  return readProviderSlotFromKeyring(providerId, "apiKey");
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
  // Fail fast on invalid provider/model fields: a soft load would read the file as "no config"
  // and a later save (e.g. a permission write) would silently overwrite it with a fresh one.
  validateSpiritConfig(raw);
  return normalizeConfig(raw as Partial<DesktopConfigFile>);
}

export async function saveConfig(config: DesktopConfigFile): Promise<void> {
  const filePath = configFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * API key resolution for a config model: the `SPIRIT_API_KEY` process override first (CLI
 * parity), then the provider entry's declared channels and the internal keyring
 * (`provider::{id}`), resolved by host-internal.
 */
export async function resolveApiKeyForModel(providerId: string): Promise<string | undefined> {
  const envKey = process.env.SPIRIT_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }
  return readProviderKeyFromKeyring(providerId);
}

export async function hasApiKeyForModel(providerId: string): Promise<boolean> {
  return Boolean(await resolveApiKeyForModel(providerId));
}

export async function resolveApiKeyForConfigModel(
  config: Pick<DesktopConfigFile, "providers">,
  ref: ModelRef,
): Promise<string | undefined> {
  const envKey = process.env.SPIRIT_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }
  const provider = findProviderEntry(config.providers, ref.providerId);
  if (!provider) {
    return undefined;
  }
  return resolveProviderApiKey({
    id: provider.id,
    ...(provider.apiKey !== undefined ? { apiKey: provider.apiKey } : {}),
    ...(provider.apiKeyEnv !== undefined ? { apiKeyEnv: provider.apiKeyEnv } : {}),
    ...(provider.apiKeyKeyring !== undefined ? { apiKeyKeyring: provider.apiKeyKeyring } : {}),
    ...(provider.credentials !== undefined ? { credentials: provider.credentials } : {}),
  });
}

/** Keychain-internal credential slot read for presence display (excludes declared env/keyring channels). */
function hasProviderSecretInKeyring(provider: ProviderEntry): boolean {
  if (readProviderKeyFromKeyring(provider.id)) {
    return true;
  }
  if (provider.transportKind === "bedrock") {
    return hasBedrockRuntimeCredentials(readBedrockProviderCredentialsFromKeyring(provider.id));
  }
  if (provider.sdk === GOOGLE_VERTEX_SDK_PACKAGE_NAME) {
    const credentials = readGoogleVertexProviderCredentialsFromKeyring(provider.id);
    return hasGoogleVertexRuntimeCredentials({
      apiKey: credentials.apiKey,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey,
      vertexProject: provider.options?.project,
      vertexLocation: provider.options?.location,
    });
  }
  return false;
}

function toModelKeyPresenceProfile(model: ModelProfileSnapshot): ModelKeyPresenceProfile {
  const providerId = model.providerId.trim() || model.ref.providerId.trim();
  if (!providerId) {
    throw new Error(`model profile "${model.name}" is missing providerId`);
  }
  return { providerId, name: model.name };
}

/** Whether each model's provider entry has credentials in the keychain (excluding env vars and declared external channels). */
export async function modelSecretKeyPresence(
  input: Pick<DesktopConfigFile, "providers"> | ModelKeyPresenceProfile[] | ModelProfileSnapshot[],
): Promise<Record<string, boolean>> {
  const profiles = Array.isArray(input)
    ? input.map((profile) => ("apiBase" in profile ? toModelKeyPresenceProfile(profile) : profile))
    : input.providers.flatMap((provider) =>
        provider.models.map((model) => ({ providerId: provider.id, name: model.name })),
      );
  const providerById = new Map(
    Array.isArray(input) ? [] : input.providers.map((provider) => [provider.id, provider] as const),
  );
  return buildModelSecretKeyPresence(profiles, (providerId) => {
    const provider = providerById.get(providerId);
    if (provider) {
      return hasProviderSecretInKeyring(provider);
    }
    return readProviderKeyFromKeyring(providerId) !== undefined;
  });
}

export async function saveApiKeyForProvider(providerId: string, apiKey: string): Promise<void> {
  setKeyringPassword(
    KEYRING_SERVICE,
    providerInternalSlotAccount(providerId, "apiKey"),
    apiKey.trim(),
  );
}

/** Deletes the provider entry's internal API key (`provider::{id}`) from the keychain. */
export async function removeProviderApiKey(providerId: string): Promise<void> {
  deleteKeyringPassword(KEYRING_SERVICE, providerInternalSlotAccount(providerId, "apiKey"));
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
    providers: [],
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
    providerTools: {
      enabled: true,
    },
    webFetch: {
      enabled: true,
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
  const providerToolsRaw =
    typeof record.providerTools === "object" && record.providerTools !== null
      ? (record.providerTools as Partial<DesktopWebToolToggleConfigFile>)
      : {};
  const webFetchRaw =
    typeof record.webFetch === "object" && record.webFetch !== null
      ? (record.webFetch as Partial<DesktopWebToolToggleConfigFile>)
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
    // Opt-out everywhere: provider tools ship in the default tool surface; only explicit false hides them.
    providerTools: {
      enabled: providerToolsRaw.enabled !== false,
    },
    webFetch: {
      enabled: webFetchRaw.enabled !== false,
    },
  };
}

function normalizeConfig(raw: Partial<DesktopConfigFile>): DesktopConfigFile {
  // loadConfig validates the provider section fail-fast before this runs, so entries are
  // already schema-clean; normalization here only covers desktop-owned fields and ref slots.
  const providers = Array.isArray(raw.providers) ? raw.providers : [];

  const allRefs = listAllModelRefs(providers);
  const activeModel =
    parseModelRef(raw.activeModel) ?? (allRefs[0] ? { ...allRefs[0] } : emptyModelRef());
  const resolvedActive = findModelByRef(providers, activeModel)
    ? activeModel
    : allRefs[0]
      ? { ...allRefs[0] }
      : emptyModelRef();

  const imageGenerationModel = normalizeImageGenerationModelRef(
    raw.imageGenerationModel,
    providers,
  );
  const videoGenerationModel = normalizeVideoGenerationModelRef(
    raw.videoGenerationModel,
    providers,
  );
  const dreams = normalizeDreamConfig(raw.dreams, providers);
  const secondaryLanguageModel = normalizeSecondaryLanguageModelRef(
    raw.secondaryLanguageModel ?? dreams.collectorModel,
    providers,
  );

  return {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers,
    activeModel: resolvedActive,
    ...(imageGenerationModel ? { imageGenerationModel } : {}),
    ...(videoGenerationModel ? { videoGenerationModel } : {}),
    ...(secondaryLanguageModel ? { secondaryLanguageModel } : {}),
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

/** Capability checks read the effective entry: provider-level flat declarations inherit down. */
function effectiveCapabilities(
  providers: readonly ProviderEntry[],
  ref: ModelRef,
): readonly DesktopModelCapability[] | undefined {
  const resolved = resolveModelByRef(providers, ref);
  return resolved?.model.capabilities;
}

function normalizeImageGenerationModelRef(
  value: unknown,
  providers: readonly ProviderEntry[],
): ModelRef | undefined {
  const ref = parseModelRef(value);
  if (!ref) {
    return undefined;
  }
  return effectiveCapabilities(providers, ref)?.includes("imageGeneration") ? ref : undefined;
}

function normalizeVideoGenerationModelRef(
  value: unknown,
  providers: readonly ProviderEntry[],
): ModelRef | undefined {
  const ref = parseModelRef(value);
  if (!ref) {
    return undefined;
  }
  return effectiveCapabilities(providers, ref)?.includes("videoGeneration") ? ref : undefined;
}

function normalizeSecondaryLanguageModelRef(
  value: unknown,
  providers: readonly ProviderEntry[],
): ModelRef | undefined {
  const ref = parseModelRef(value);
  if (!ref) {
    return undefined;
  }
  const capabilities = effectiveCapabilities(providers, ref);
  if (capabilities === undefined) {
    // No capability declaration: the model counts as a language model (legacy default).
    return ref;
  }
  return capabilities.includes("languageModel") ? ref : undefined;
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
  providers: readonly ProviderEntry[] = [],
): DesktopDreamConfigFile {
  const collectorModel = normalizeSecondaryLanguageModelRef(raw?.collectorModel, providers);
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
