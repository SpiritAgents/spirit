import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { unzipSync } from "fflate";

import {
  HOOKS_CONFIG_FILE_NAME,
  MCP_CONFIG_FILE_NAME,
  parseHooksConfigFile,
  parseMcpConfigFile,
} from "@spiritagent/agent-core";

import { isBuiltInExtensionId } from "./built-in/extension-ids.js";
import {
  clearBuiltInExtensionRemoved,
  noteBuiltInExtensionRemoved,
} from "./built-in/state.js";
import { validateSkillName } from "./discovery.js";
import {
  parseSkillFrontmatterFields,
  SKILL_FILE_NAME,
  SKILLS_DIR_NAME,
  splitSkillFrontmatter,
} from "./skill-paths.js";
import {
  createFileExtensionStateStore,
  EXTENSION_MANIFEST_FILE_NAME,
  loadToggleState,
  resolveExtensionPaths,
  saveToggleState,
  SUPPORTED_EXTENSION_HOST_KINDS,
  USER_RULE_FILE_NAME,
  type ExtensionHostKind,
  type ExtensionSettingValue,
  type ExtensionStateStore,
  type ExtensionManagementContext,
  type ExtensionPaths,
} from "./storage.js";

const EXTENSION_SCHEMA_VERSION = 1;
const EXTENSION_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const TEMP_DIR_PREFIX = "spirit-extension-";
const EXTENSION_FIELD_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SPIRIT_EXTENSION_FIELD_NAME = "spiritExtension";
const EXTENSION_TOOL_INVOCATION_NAME_MAX_LENGTH = 64;
const EXTENSION_TOOL_ID_FRAGMENT_LIMIT = 16;
const EXTENSION_TOOL_NAME_FRAGMENT_LIMIT = 24;

export const SUPPORTED_HOST_EXTENSION_ACTIVATION_EVENTS = [
  "onStartup",
  "onExtensionInstalled",
  "onSessionOpened",
  "onSessionReset",
  "onUserMessage",
  "onToolCall",
  "onToolResult",
  "onApprovalResolved",
] as const;

export const SUPPORTED_HOST_EXTENSION_REQUESTED_CAPABILITIES = [
  "tool-definitions",
  "tool-execution",
  "system-prompt",
  "approval-flow",
  "questions-flow",
  "settings",
  "secret-storage",
  "structured-results",
  "desktop-ui",
  "cli-ui",
  "mcp",
  "hooks",
  "skills",
  "rules",
] as const;

export const EXTENSION_MCP_CONFIG_FILE_NAME = MCP_CONFIG_FILE_NAME;
export const EXTENSION_HOOKS_CONFIG_FILE_NAME = HOOKS_CONFIG_FILE_NAME;
export const EXTENSION_RULE_FILE_NAME = USER_RULE_FILE_NAME;
export const EXTENSION_SKILLS_DIR_NAME = SKILLS_DIR_NAME;

const INSTRUCTION_CONTRIBUTION_PAIRS = [
  { capability: "mcp", contributionKey: "mcp" },
  { capability: "hooks", contributionKey: "hooks" },
  { capability: "skills", contributionKey: "skills" },
  { capability: "rules", contributionKey: "rules" },
] as const;

export const SUPPORTED_HOST_EXTENSION_TOOL_APPROVAL_MODES = [
  "allowed",
  "need-approval",
  "need-questions",
] as const;

export const SUPPORTED_HOST_EXTENSION_TOOL_EXECUTION_MODES = ["foreground", "background"] as const;

export const SUPPORTED_HOST_EXTENSION_SETTING_TYPES = [
  "string",
  "boolean",
  "number",
  "select",
] as const;

export type HostExtensionActivationEventName =
  (typeof SUPPORTED_HOST_EXTENSION_ACTIVATION_EVENTS)[number];

export type HostExtensionRequestedCapability =
  (typeof SUPPORTED_HOST_EXTENSION_REQUESTED_CAPABILITIES)[number];

export type HostExtensionToolApprovalMode =
  (typeof SUPPORTED_HOST_EXTENSION_TOOL_APPROVAL_MODES)[number];

export type HostExtensionToolExecutionMode =
  (typeof SUPPORTED_HOST_EXTENSION_TOOL_EXECUTION_MODES)[number];

export type HostExtensionSettingType = (typeof SUPPORTED_HOST_EXTENSION_SETTING_TYPES)[number];

export type HostExtensionJsonSchema = Record<string, unknown>;

export type HostExtensionSettingDefaultValue = string | boolean | number;
export type HostExtensionSettingsValues = Record<string, ExtensionSettingValue>;

export interface HostExtensionEvent {
  type: HostExtensionActivationEventName;
  detail?: Record<string, unknown>;
}

export interface HostExtensionContributedToolDefinition {
  name: string;
  description: string;
  inputSchema: HostExtensionJsonSchema;
  outputSchema?: HostExtensionJsonSchema;
  approvalMode?: HostExtensionToolApprovalMode;
  executionMode?: HostExtensionToolExecutionMode;
}

export interface HostExtensionContributionSet {
  tools?: HostExtensionContributedToolDefinition[];
  desktop?: HostExtensionDesktopContributionSet;
  cli?: HostExtensionCliContributionSet;
  /** Declared agent MCP contribution; files live at the package-root mcp.json. */
  mcp?: true;
  /** Declared agent hooks contribution; files live at the package-root hooks.json. */
  hooks?: true;
  /** Declared skills contribution; files live under package-root skills/<name>/SKILL.md. */
  skills?: true;
  /** Declared rules contribution; files live at the package-root rule.md. */
  rules?: true;
}

export interface HostExtensionDesktopCssDefinition {
  path: string;
  media?: string;
}

export interface HostExtensionDesktopSettingsPageDefinition {
  title?: string;
}

export interface HostExtensionDesktopContributionSet {
  css?: HostExtensionDesktopCssDefinition[];
  settingsPage?: HostExtensionDesktopSettingsPageDefinition;
}

export const SUPPORTED_HOST_EXTENSION_CLI_UI_SLOTS = [
  "message.user",
  "message.assistant",
  "message.tool",
  "assistant.thinking",
  "input.frame",
  "bottom_form",
  "bottom_form.section",
  "slash_suggestions",
  "approval.panel",
  "questions.panel",
] as const;

export const SUPPORTED_HOST_EXTENSION_CLI_UI_VARIANTS = [
  "default",
  "accented",
  "muted",
  "warning",
  "success",
  "danger",
] as const;

export const SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES = [
  "default",
  "primary",
  "secondary",
  "muted",
  "accent",
  "success",
  "warning",
  "danger",
] as const;

export type HostExtensionCliUiSlot = (typeof SUPPORTED_HOST_EXTENSION_CLI_UI_SLOTS)[number];

export type HostExtensionCliUiVariant = (typeof SUPPORTED_HOST_EXTENSION_CLI_UI_VARIANTS)[number];

export type HostExtensionCliUiTokenRole =
  (typeof SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES)[number];

export interface HostExtensionCliUiHookTokens {
  foreground?: HostExtensionCliUiTokenRole;
  border?: HostExtensionCliUiTokenRole;
  accent?: HostExtensionCliUiTokenRole;
}

export interface HostExtensionCliUiHookDefinition {
  slot: HostExtensionCliUiSlot;
  variant?: HostExtensionCliUiVariant;
  tokens?: HostExtensionCliUiHookTokens;
  prefix?: string;
  suffix?: string;
}

export interface HostExtensionCliContributionSet {
  hooks?: HostExtensionCliUiHookDefinition[];
}

interface HostExtensionManifestParseOptions {
  readRelativeTextFile?: (relativePath: string, fieldName: string) => Promise<string>;
  listRelativeChildDirectories?: (relativePath: string) => Promise<string[]>;
}

export interface HostExtensionSettingOption {
  value: string;
  label: string;
  description?: string;
}

export interface HostExtensionSettingDefinition {
  key: string;
  type: HostExtensionSettingType;
  title: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: HostExtensionSettingDefaultValue;
  options?: HostExtensionSettingOption[];
}

export interface HostExtensionSecretSlot {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
}

export interface HostExtensionManifest {
  schemaVersion: number;
  id: string;
  /** User-visible extension name, from spiritExtension.displayName in package.json. */
  name: string;
  /** Extension icon: file path relative to the package root, from spiritExtension.icon in package.json. */
  icon?: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  main?: string;
  /** Hosts the extension declares it can be installed on (cli / desktop). */
  supportedHosts: ExtensionHostKind[];
  activationEvents?: HostExtensionActivationEventName[];
  requestedCapabilities?: HostExtensionRequestedCapability[];
  contributes?: HostExtensionContributionSet;
  settingsSchema?: HostExtensionSettingDefinition[];
  secretSlots?: HostExtensionSecretSlot[];
  /**
   * When false, `ensureBuiltInExtensions` does not seed this package.
   * Omitted or true means seed on first launch (unless a removal tombstone exists).
   */
  defaultInstalled?: boolean;
}

export interface HostMarketplaceCatalogItem extends HostInstalledExtension {
  /** False when the bundled template is listed but not copied into the host extensions directory. */
  installed: boolean;
}

export type HostExtensionInstallSource = "built-in" | "archive" | "marketplace";

export interface HostExtensionRegistryEntry {
  id: string;
  directoryName: string;
  installedAtUnixMs: number;
  archiveFileName?: string;
  installSource?: HostExtensionInstallSource;
}

export interface HostInstalledExtension {
  id: string;
  directoryName: string;
  manifest: HostExtensionManifest;
  directoryPath: string;
  manifestPath: string;
  installedAtUnixMs: number;
  /** Enabled unless the per-host toggle state file disables this id; disabled extensions contribute nothing. */
  enabled: boolean;
  archiveFileName?: string;
  installSource?: HostExtensionInstallSource;
}

export interface ImportExtensionArchiveRequest {
  archiveBase64: string;
  fileName?: string;
}

export interface InstallPreparedExtensionDirectoryRequest {
  preparedDirectoryPath: string;
  fileName?: string;
  replaceExisting?: boolean;
  installSource?: HostExtensionInstallSource;
}

export interface RunExtensionRequest<THostApi> {
  id: string;
  host: THostApi;
  logger?: Pick<Console, "error" | "log">;
}

export interface HostExtensionRuntimeInfo {
  id: string;
  name: string;
  version: string;
  directoryPath: string;
  manifestPath: string;
  main: string;
}

export interface HostExtensionSettingsAccessor {
  get(key: string): Promise<ExtensionSettingValue | undefined>;
  getAll(): Promise<HostExtensionSettingsValues>;
  set(key: string, value: ExtensionSettingValue): Promise<void>;
  setAll(values: HostExtensionSettingsValues): Promise<HostExtensionSettingsValues>;
}

export interface HostExtensionSecretsAccessor {
  get(key: string): Promise<string | undefined>;
  has(key: string): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface HostExtensionActivationContext<THostApi> {
  extension: HostExtensionRuntimeInfo;
  host: THostApi;
  log(message: string): void;
  settings: HostExtensionSettingsAccessor;
  secrets: HostExtensionSecretsAccessor;
  activationEvent?: HostExtensionEvent;
}

export interface HostExtensionToolExecutionContext<THostApi> {
  extension: HostExtensionRuntimeInfo;
  host: THostApi;
  toolName: string;
  arguments: Record<string, unknown>;
  log(message: string): void;
  settings: HostExtensionSettingsAccessor;
  secrets: HostExtensionSecretsAccessor;
  toolCallId?: string;
  questionsResult?: unknown;
}

export type HostExtensionToolHandler<THostApi> = (
  context: HostExtensionToolExecutionContext<THostApi>,
) => Promise<unknown> | unknown;

export interface HostExtensionSystemPromptContribution {
  extensionId: string;
  extensionName: string;
  content: string;
}

export interface CollectExtensionSystemPromptContributionsRequest<THostApi> {
  host: THostApi;
  logger?: Pick<Console, "error" | "log">;
}

export interface HostActivatedExtension {
  tools?: Record<string, HostExtensionToolHandler<unknown>>;
  invokeTool?<THostApi>(
    request: HostExtensionToolExecutionContext<THostApi>,
  ): Promise<unknown> | unknown;
  systemPrompt?: string;
  getSystemPrompt?(): Promise<string | undefined> | string | undefined;
  onEvent?(event: HostExtensionEvent): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export interface HostResolvedExtensionTool {
  extensionId: string;
  extensionName: string;
  tool: HostExtensionContributedToolDefinition;
  invocationName: string;
}

export interface InvokeExtensionToolRequest<THostApi> {
  extensionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  host: THostApi;
  logger?: Pick<Console, "error" | "log">;
  toolCallId?: string;
  questionsResult?: unknown;
}

export interface UpdateExtensionSettingsRequest {
  id: string;
  values: HostExtensionSettingsValues;
}

export interface UpdateExtensionSecretRequest {
  id: string;
  key: string;
  value?: string;
}

export interface DispatchExtensionEventRequest<THostApi> {
  event: HostExtensionEvent;
  host: THostApi;
  logger?: Pick<Console, "error" | "log">;
  targetExtensionIds?: readonly string[];
}

export interface HostExtensionManager {
  getPaths(): ExtensionPaths;
  list(): Promise<readonly HostInstalledExtension[]>;
  resolveTool(name: string): Promise<HostResolvedExtensionTool | undefined>;
  importArchive(request: ImportExtensionArchiveRequest): Promise<HostInstalledExtension>;
  installPreparedDirectory(
    request: InstallPreparedExtensionDirectoryRequest,
  ): Promise<HostInstalledExtension>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  run<THostApi>(request: RunExtensionRequest<THostApi>): Promise<void>;
  invokeTool<THostApi>(request: InvokeExtensionToolRequest<THostApi>): Promise<string>;
  getSettingsValues(id: string): Promise<HostExtensionSettingsValues>;
  setSettingsValues(request: UpdateExtensionSettingsRequest): Promise<HostExtensionSettingsValues>;
  getSecretStatus(id: string): Promise<Record<string, boolean>>;
  setSecretValue(request: UpdateExtensionSecretRequest): Promise<Record<string, boolean>>;
  collectSystemPromptContributions<THostApi>(
    request: CollectExtensionSystemPromptContributionsRequest<THostApi>,
  ): Promise<HostExtensionSystemPromptContribution[]>;
  dispatchEvent<THostApi>(request: DispatchExtensionEventRequest<THostApi>): Promise<void>;
  deactivateAll(): Promise<void>;
}

export function collectHostExtensionContributedTools(
  extensions: readonly Pick<HostInstalledExtension, "id" | "manifest" | "enabled">[],
): HostExtensionContributedToolDefinition[] {
  return collectResolvableExtensionTools(extensions).map((entry) => ({
    name: entry.invocationName,
    description: entry.tool.description,
    inputSchema: entry.tool.inputSchema,
    ...(entry.tool.outputSchema ? { outputSchema: entry.tool.outputSchema } : {}),
    ...(entry.tool.approvalMode ? { approvalMode: entry.tool.approvalMode } : {}),
    ...(entry.tool.executionMode ? { executionMode: entry.tool.executionMode } : {}),
  }));
}

export function createHostExtensionManager(
  context: ExtensionManagementContext,
): HostExtensionManager {
  const activatedExtensions = new Map<string, ActivatedExtensionCacheEntry>();
  const stateStore = context.stateStore ?? createFileExtensionStateStore(context);

  return {
    getPaths() {
      return resolveExtensionPaths(context);
    },
    async list() {
      return listInstalledExtensions(context);
    },
    async resolveTool(name) {
      return resolveExtensionTool(context, name);
    },
    async importArchive(request) {
      return importExtensionArchive(context, request);
    },
    async installPreparedDirectory(request) {
      return installPreparedExtensionDirectory(context, request);
    },
    async remove(id) {
      await deactivateExtensionById(activatedExtensions, id);
      await removeInstalledExtension(context, id);
    },
    async setEnabled(id, enabled) {
      // Persist before disposing the live instance: a dispose failure must not leave a disabled extension running.
      await setExtensionEnabled(context, id, enabled);
      if (!enabled) {
        await deactivateExtensionById(activatedExtensions, id);
      }
    },
    async run(request) {
      await runInstalledExtension(context, activatedExtensions, stateStore, request);
    },
    async invokeTool(request) {
      return invokeExtensionTool(context, activatedExtensions, stateStore, request);
    },
    async getSettingsValues(id) {
      return loadExtensionSettingsValues(context, stateStore, id);
    },
    async setSettingsValues(request) {
      return saveExtensionSettingsValues(context, stateStore, request);
    },
    async getSecretStatus(id) {
      return loadExtensionSecretStatus(context, stateStore, id);
    },
    async setSecretValue(request) {
      return saveExtensionSecretValue(context, stateStore, request);
    },
    async collectSystemPromptContributions(request) {
      return collectExtensionSystemPromptContributions(
        context,
        activatedExtensions,
        stateStore,
        request,
      );
    },
    async dispatchEvent(request) {
      await dispatchExtensionEvent(context, activatedExtensions, stateStore, request);
    },
    async deactivateAll() {
      await deactivateAllExtensions(activatedExtensions);
    },
  };
}

interface ActivatedExtensionCacheEntry {
  id: string;
  installedAtUnixMs: number;
  activationEvents: readonly HostExtensionActivationEventName[];
  runtimeInfo: HostExtensionRuntimeInfo;
  activatedExtension?: HostActivatedExtension;
  onEvent?: HostActivatedExtension["onEvent"];
  dispose?: HostActivatedExtension["dispose"];
}

export async function listInstalledExtensions(
  context: ExtensionManagementContext,
): Promise<readonly HostInstalledExtension[]> {
  const paths = resolveExtensionPaths(context);
  await ensureExtensionDirectories(paths);

  const registryEntries = await loadExtensionRegistry(paths.extensionsIndexFile);
  const toggleState = await loadToggleState(paths.extensionsStateFile);
  const enabledOverrides = toggleState.enabledOverrides ?? {};
  const directoryEntries = await readdir(paths.extensionsDir, { withFileTypes: true });
  const installed: HostInstalledExtension[] = [];

  for (const entry of directoryEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directoryPath = path.join(paths.extensionsDir, entry.name);
    const manifestPath = path.join(directoryPath, EXTENSION_MANIFEST_FILE_NAME);
    if (!existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifest = await readExtensionManifestFile(manifestPath);
      const registryEntry = registryEntries.get(manifest.id);
      const installedAtUnixMs =
        registryEntry?.installedAtUnixMs ?? Math.trunc((await stat(directoryPath)).mtimeMs);

      installed.push({
        id: manifest.id,
        directoryName: entry.name,
        manifest,
        directoryPath,
        manifestPath,
        installedAtUnixMs,
        enabled: enabledOverrides[manifest.id] ?? true,
        ...(registryEntry?.archiveFileName
          ? { archiveFileName: registryEntry.archiveFileName }
          : {}),
        ...(registryEntry?.installSource ? { installSource: registryEntry.installSource } : {}),
      });
    } catch {
      continue;
    }
  }

  installed.sort((left, right) => {
    const byName = left.manifest.name.localeCompare(right.manifest.name, "zh-CN");
    if (byName !== 0) {
      return byName;
    }
    return left.id.localeCompare(right.id, "en");
  });

  const nextRegistryEntries = installed.map((item) => toExtensionRegistryEntry(item));

  await saveExtensionRegistryIfChanged(
    paths.extensionsIndexFile,
    registryEntries,
    nextRegistryEntries,
  );

  return installed;
}

function assertExtensionImportAllowedForHost(
  manifest: HostExtensionManifest,
  hostKind: ExtensionHostKind,
): void {
  const allowed = manifest.supportedHosts;
  if (allowed.includes(hostKind)) {
    return;
  }
  const hostLabel: Record<ExtensionHostKind, string> = {
    cli: "CLI",
    desktop: "Desktop",
  };
  const listed = allowed.map((entry) => hostLabel[entry] ?? entry).join(", ");
  throw new Error(
    `This extension cannot be installed on the current host: current host is ${hostLabel[hostKind]}, but the extension only supports ${listed}.`,
  );
}

export async function importExtensionArchive(
  context: ExtensionManagementContext,
  request: ImportExtensionArchiveRequest,
): Promise<HostInstalledExtension> {
  const paths = resolveExtensionPaths(context);
  await ensureExtensionDirectories(paths);

  const archiveBuffer = Buffer.from(request.archiveBase64, "base64");
  if (archiveBuffer.length === 0) {
    throw new Error("The extension ZIP is empty.");
  }

  const extracted = unzipSync(new Uint8Array(archiveBuffer));
  const normalizedExtracted = new Map(
    Object.entries(extracted).map(([entryName, content]) => [
      normalizeArchivePath(entryName),
      content,
    ]),
  );
  const manifestEntryName = resolveManifestArchivePath(Object.keys(extracted));
  const manifestRaw = Buffer.from(normalizedExtracted.get(manifestEntryName) ?? []).toString(
    "utf8",
  );
  const manifestRoot = manifestEntryName.includes("/")
    ? manifestEntryName.slice(0, manifestEntryName.lastIndexOf("/"))
    : "";
  const manifest = await parseExtensionManifest(manifestRaw, {
    readRelativeTextFile: async (relativePath, fieldName) => {
      const normalized = normalizeArchivePath(relativePath);
      const archivePath = manifestRoot ? `${manifestRoot}/${normalized}` : normalized;
      const content = normalizedExtracted.get(archivePath);
      if (!content) {
        throw new Error(
          `The file referenced by extension ${fieldName} does not exist: ${relativePath}`,
        );
      }
      return Buffer.from(content).toString("utf8");
    },
    listRelativeChildDirectories: async (relativePath) =>
      listArchiveChildDirectories(normalizedExtracted, manifestRoot, relativePath),
  });
  const directoryName = extensionDirectoryNameFromId(manifest.id);
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
  const stagingDirectory = path.join(tempDirectory, directoryName);

  try {
    await mkdir(stagingDirectory, { recursive: true });

    for (const [entryName, content] of Object.entries(extracted)) {
      const relativePath = resolveArchiveRelativePath(entryName, manifestEntryName);
      if (!relativePath) {
        continue;
      }

      const targetFilePath = path.join(stagingDirectory, ...relativePath.split("/"));
      await mkdir(path.dirname(targetFilePath), { recursive: true });
      await writeFile(targetFilePath, Buffer.from(content));
    }

    if (manifest.main) {
      const mainFilePath = path.join(stagingDirectory, ...manifest.main.split("/"));
      if (!existsSync(mainFilePath)) {
        throw new Error(`The extension main file does not exist: ${manifest.main}`);
      }
    }

    const installed = await installPreparedExtensionDirectory(context, {
      preparedDirectoryPath: stagingDirectory,
      installSource: "archive",
      ...(request.fileName?.trim() ? { fileName: request.fileName.trim() } : {}),
    });
    return installed;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function readPreparedExtensionManifestDirectory(
  preparedDirectoryPath: string,
): Promise<HostExtensionManifest> {
  const manifestPath = path.join(preparedDirectoryPath, EXTENSION_MANIFEST_FILE_NAME);
  if (!existsSync(manifestPath)) {
    throw new Error(`The prepared extension directory is missing ${EXTENSION_MANIFEST_FILE_NAME}.`);
  }
  return readExtensionManifestFile(manifestPath);
}

export async function installPreparedExtensionDirectory(
  context: ExtensionManagementContext,
  request: InstallPreparedExtensionDirectoryRequest,
): Promise<HostInstalledExtension> {
  const preparedDirectoryPath = request.preparedDirectoryPath.trim();
  if (!preparedDirectoryPath) {
    throw new Error("The prepared extension directory must not be empty.");
  }

  const paths = resolveExtensionPaths(context);
  await ensureExtensionDirectories(paths);

  const manifest = await readPreparedExtensionManifestDirectory(preparedDirectoryPath);
  assertExtensionImportAllowedForHost(manifest, context.hostKind);
  const directoryName = extensionDirectoryNameFromId(manifest.id);
  const targetDirectory = path.join(paths.extensionsDir, directoryName);

  const registryEntries = await loadExtensionRegistry(paths.extensionsIndexFile);
  const replaceExisting = request.replaceExisting === true;
  if (!replaceExisting && (existsSync(targetDirectory) || registryEntries.has(manifest.id))) {
    throw new Error(`The extension already exists; remove it before importing: ${manifest.id}`);
  }

  if (manifest.main) {
    const mainFilePath = path.join(preparedDirectoryPath, ...manifest.main.split("/"));
    if (!existsSync(mainFilePath)) {
      throw new Error(`The extension main file does not exist: ${manifest.main}`);
    }
  }

  const stagingRoot = await mkdtemp(path.join(paths.extensionsDir, `${directoryName}.stage-`));
  const stagedDirectory = path.join(stagingRoot, directoryName);
  const backupDirectory = path.join(
    paths.extensionsDir,
    `${directoryName}.backup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  let renamedExisting = false;
  let movedIntoPlace = false;

  try {
    await cp(preparedDirectoryPath, stagedDirectory, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });

    if (replaceExisting && existsSync(targetDirectory)) {
      await rename(targetDirectory, backupDirectory);
      renamedExisting = true;
    }

    await rename(stagedDirectory, targetDirectory);
    movedIntoPlace = true;
  } catch (error) {
    if (!movedIntoPlace) {
      await rm(targetDirectory, { recursive: true, force: true });
    }
    if (renamedExisting && !existsSync(targetDirectory) && existsSync(backupDirectory)) {
      await rename(backupDirectory, targetDirectory);
      renamedExisting = false;
    }
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
    if (renamedExisting && existsSync(backupDirectory)) {
      await rm(backupDirectory, { recursive: true, force: true });
    }
  }

  const installedAtUnixMs = Date.now();
  const installSource = request.installSource;
  const nextRegistryEntries = [
    ...Array.from(registryEntries.values()).filter((entry) => entry.id !== manifest.id),
    {
      id: manifest.id,
      directoryName,
      installedAtUnixMs,
      ...(request.fileName?.trim() ? { archiveFileName: request.fileName.trim() } : {}),
      ...(installSource ? { installSource } : {}),
    },
  ];
  await writeExtensionRegistry(paths.extensionsIndexFile, nextRegistryEntries);

  const toggleState = await loadToggleState(paths.extensionsStateFile);
  if (installSource === "built-in" || isBuiltInExtensionId(manifest.id)) {
    await clearBuiltInExtensionRemoved(context.spiritDataDir, manifest.id);
  }
  return {
    id: manifest.id,
    directoryName,
    manifest,
    directoryPath: targetDirectory,
    manifestPath: path.join(targetDirectory, EXTENSION_MANIFEST_FILE_NAME),
    installedAtUnixMs,
    enabled: toggleState.enabledOverrides?.[manifest.id] ?? true,
    ...(request.fileName?.trim() ? { archiveFileName: request.fileName.trim() } : {}),
    ...(installSource ? { installSource } : {}),
  };
}

export async function removeInstalledExtension(
  context: ExtensionManagementContext,
  id: string,
): Promise<void> {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error("The extension id must not be empty.");
  }

  const paths = resolveExtensionPaths(context);
  await ensureExtensionDirectories(paths);
  const installed = await listInstalledExtensions(context);
  const target = installed.find((item) => item.id === normalizedId);
  if (!target) {
    throw new Error(`Extension not found: ${normalizedId}`);
  }

  await rm(target.directoryPath, { recursive: true, force: true });
  await writeExtensionRegistry(
    paths.extensionsIndexFile,
    installed
      .filter((item) => item.id !== normalizedId)
      .map((item) => toExtensionRegistryEntry(item)),
  );

  const toggleState = await loadToggleState(paths.extensionsStateFile);
  if (toggleState.enabledOverrides?.[normalizedId] !== undefined) {
    const enabledOverrides = { ...toggleState.enabledOverrides };
    delete enabledOverrides[normalizedId];
    await saveToggleState(paths.extensionsStateFile, { enabledOverrides });
  }

  if (target.installSource === "built-in" || isBuiltInExtensionId(normalizedId)) {
    await noteBuiltInExtensionRemoved(context.spiritDataDir, normalizedId);
  }
}

export async function setExtensionEnabled(
  context: ExtensionManagementContext,
  id: string,
  enabled: boolean,
): Promise<void> {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error("The extension id must not be empty.");
  }

  const paths = resolveExtensionPaths(context);
  await ensureExtensionDirectories(paths);
  const installed = await listInstalledExtensions(context);
  if (!installed.some((item) => item.id === normalizedId)) {
    throw new Error(`Extension not found: ${normalizedId}`);
  }

  const state = await loadToggleState(paths.extensionsStateFile);
  const enabledOverrides = { ...state.enabledOverrides };
  if (enabled) {
    delete enabledOverrides[normalizedId];
  } else {
    enabledOverrides[normalizedId] = false;
  }
  await saveToggleState(paths.extensionsStateFile, { enabledOverrides });
}

export async function runInstalledExtension<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: RunExtensionRequest<THostApi>,
): Promise<void> {
  const normalizedId = request.id.trim();
  if (!normalizedId) {
    throw new Error("The extension id must not be empty.");
  }

  const target = await requireInstalledExtension(context, normalizedId);
  if (!target.enabled) {
    throw new Error(`The extension is disabled: ${normalizedId}`);
  }
  await ensureActivatedExtension(target, activatedExtensions, stateStore, {
    host: request.host,
    ...(request.logger ? { logger: request.logger } : {}),
    log: (message) => {
      request.logger?.log(`[extension:${target.id}] ${message}`);
    },
  });
}

export async function resolveExtensionTool(
  context: ExtensionManagementContext,
  name: string,
): Promise<HostResolvedExtensionTool | undefined> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return undefined;
  }
  const installed = await listInstalledExtensions(context);
  return (
    collectResolvableExtensionTools(installed).find(
      (entry) => entry.invocationName === normalizedName,
    ) ?? undefined
  );
}

export async function invokeExtensionTool<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: InvokeExtensionToolRequest<THostApi>,
): Promise<string> {
  const target = await requireInstalledExtension(context, request.extensionId);
  if (!target.enabled) {
    throw new Error(`The extension is disabled: ${target.id}`);
  }
  const tool = target.manifest.contributes?.tools?.find((item) => item.name === request.toolName);
  if (!tool) {
    throw new Error(`The extension does not declare the tool: ${request.toolName}`);
  }
  if (!target.manifest.requestedCapabilities?.includes("tool-execution")) {
    throw new Error(`The extension does not declare the tool-execution capability: ${target.id}`);
  }

  const entry = await ensureActivatedExtension(target, activatedExtensions, stateStore, {
    host: request.host,
    ...(request.logger ? { logger: request.logger } : {}),
    log: (message) => {
      request.logger?.log(`[extension:${target.id}] ${message}`);
    },
  });

  const result = await invokeActivatedExtensionTool(target, entry, stateStore, {
    host: request.host,
    toolName: tool.name,
    arguments: request.arguments,
    ...(request.logger ? { logger: request.logger } : {}),
    ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
    ...(request.questionsResult !== undefined ? { questionsResult: request.questionsResult } : {}),
  });
  return renderExtensionToolResult(result);
}

export async function loadExtensionSettingsValues(
  context: ExtensionManagementContext,
  stateStore: ExtensionStateStore,
  id: string,
): Promise<HostExtensionSettingsValues> {
  const extension = await requireInstalledExtension(context, id);
  return loadSettingsValuesForExtension(extension, stateStore);
}

export async function saveExtensionSettingsValues(
  context: ExtensionManagementContext,
  stateStore: ExtensionStateStore,
  request: UpdateExtensionSettingsRequest,
): Promise<HostExtensionSettingsValues> {
  const extension = await requireInstalledExtension(context, request.id);
  return saveSettingsValuesForExtension(extension, stateStore, request.values);
}

export async function loadExtensionSecretStatus(
  context: ExtensionManagementContext,
  stateStore: ExtensionStateStore,
  id: string,
): Promise<Record<string, boolean>> {
  const extension = await requireInstalledExtension(context, id);
  const status: Record<string, boolean> = {};

  for (const slot of extension.manifest.secretSlots ?? []) {
    status[slot.key] = await hasExtensionSecret(stateStore, extension.id, slot.key);
  }

  return status;
}

export async function saveExtensionSecretValue(
  context: ExtensionManagementContext,
  stateStore: ExtensionStateStore,
  request: UpdateExtensionSecretRequest,
): Promise<Record<string, boolean>> {
  const extension = await requireInstalledExtension(context, request.id);
  const secretKey = request.key.trim();
  if (!extension.manifest.secretSlots?.some((slot) => slot.key === secretKey)) {
    throw new Error(`The extension does not declare the secret slot: ${secretKey}`);
  }

  const nextValue = request.value?.trim();
  if (nextValue) {
    if (!stateStore.saveSecret) {
      throw new Error(
        `The current host does not implement extension secret storage: ${extension.id}`,
      );
    }
    await stateStore.saveSecret(extension.id, secretKey, nextValue);
  } else if (stateStore.deleteSecret) {
    await stateStore.deleteSecret(extension.id, secretKey);
  }

  return loadExtensionSecretStatus(context, stateStore, extension.id);
}

export async function dispatchExtensionEvent<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: DispatchExtensionEventRequest<THostApi>,
): Promise<void> {
  const installed = await listInstalledExtensions(context);
  const targetIds = request.targetExtensionIds
    ? new Set(request.targetExtensionIds.map((id) => id.trim()).filter(Boolean))
    : undefined;

  for (const extension of installed) {
    if (!extension.enabled) {
      continue;
    }
    if (targetIds && !targetIds.has(extension.id)) {
      continue;
    }

    const mainEntry = extension.manifest.main;
    if (!mainEntry) {
      continue;
    }

    const activationEvents = extension.manifest.activationEvents ?? [];
    if (!activationEvents.includes(request.event.type)) {
      continue;
    }

    try {
      const activated = await ensureActivatedExtension(extension, activatedExtensions, stateStore, {
        host: request.host,
        ...(request.logger ? { logger: request.logger } : {}),
        log: (message) => {
          request.logger?.log(`[extension:${extension.id}] ${message}`);
        },
        activationEvent: request.event,
      });
      await activated.onEvent?.(request.event);
    } catch (error) {
      request.logger?.error(`[extension:${extension.id}] event failed`, error);
      throw new Error(
        `Extension event execution failed: ${extension.manifest.name} (${error instanceof Error ? error.message : String(error)})`,
        { cause: error },
      );
    }
  }
}

export async function collectExtensionSystemPromptContributions<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: CollectExtensionSystemPromptContributionsRequest<THostApi>,
): Promise<HostExtensionSystemPromptContribution[]> {
  const installed = await listInstalledExtensions(context);
  const contributions: HostExtensionSystemPromptContribution[] = [];

  for (const extension of installed) {
    if (!extension.enabled) {
      continue;
    }
    if (!supportsSystemPromptContribution(extension.manifest) || !extension.manifest.main) {
      continue;
    }

    try {
      const activated = await ensureActivatedExtension(extension, activatedExtensions, stateStore, {
        host: request.host,
        ...(request.logger ? { logger: request.logger } : {}),
        log: (message) => {
          request.logger?.log(`[extension:${extension.id}] ${message}`);
        },
      });
      const content = await resolveActivatedExtensionSystemPrompt(activated.activatedExtension);
      if (!content) {
        continue;
      }

      contributions.push({
        extensionId: extension.id,
        extensionName: extension.manifest.name,
        content,
      });
    } catch (error) {
      request.logger?.error(`[extension:${extension.id}] collect system prompt failed`, error);
    }
  }

  return contributions;
}

async function ensureActivatedExtension<THostApi>(
  target: HostInstalledExtension,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  options: {
    host: THostApi;
    logger?: Pick<Console, "error" | "log">;
    log: (message: string) => void;
    activationEvent?: HostExtensionEvent;
  },
): Promise<ActivatedExtensionCacheEntry> {
  const cached = activatedExtensions.get(target.id);
  if (cached && cached.installedAtUnixMs === target.installedAtUnixMs) {
    return cached;
  }

  if (cached?.dispose) {
    await cached.dispose();
    activatedExtensions.delete(target.id);
  }

  const mainEntry = target.manifest.main;
  if (!mainEntry) {
    throw new Error(`The extension does not declare main and cannot execute: ${target.id}`);
  }

  const mainFilePath = path.join(target.directoryPath, ...mainEntry.split("/"));
  if (!existsSync(mainFilePath)) {
    throw new Error(`The extension main file does not exist: ${mainEntry}`);
  }

  const runtimeInfo = createRuntimeInfo(target);
  const activatedExtension = await activateExtension(target, mainFilePath, {
    host: options.host,
    ...(options.logger ? { logger: options.logger } : {}),
    log: options.log,
    settings: createSettingsAccessor(target, stateStore),
    secrets: createSecretsAccessor(target, stateStore),
    ...(options.activationEvent ? { activationEvent: options.activationEvent } : {}),
  });

  const next: ActivatedExtensionCacheEntry = {
    id: target.id,
    installedAtUnixMs: target.installedAtUnixMs,
    activationEvents: target.manifest.activationEvents ?? [],
    runtimeInfo,
    ...(activatedExtension ? { activatedExtension } : {}),
    ...(activatedExtension?.onEvent ? { onEvent: activatedExtension.onEvent } : {}),
    ...(activatedExtension?.dispose ? { dispose: activatedExtension.dispose } : {}),
  };
  activatedExtensions.set(target.id, next);
  return next;
}

function createRuntimeInfo(target: HostInstalledExtension): HostExtensionRuntimeInfo {
  return {
    id: target.id,
    name: target.manifest.name,
    version: target.manifest.version,
    directoryPath: target.directoryPath,
    manifestPath: target.manifestPath,
    main: target.manifest.main ?? "",
  };
}

async function invokeActivatedExtensionTool<THostApi>(
  extension: HostInstalledExtension,
  entry: ActivatedExtensionCacheEntry,
  stateStore: ExtensionStateStore,
  request: {
    host: THostApi;
    toolName: string;
    arguments: Record<string, unknown>;
    logger?: Pick<Console, "error" | "log">;
    toolCallId?: string;
    questionsResult?: unknown;
  },
): Promise<unknown> {
  const activated = entry.activatedExtension;
  if (!activated) {
    throw new Error(`The extension did not return a callable instance: ${entry.runtimeInfo.name}`);
  }

  const toolContext: HostExtensionToolExecutionContext<THostApi> = {
    extension: entry.runtimeInfo,
    host: request.host,
    toolName: request.toolName,
    arguments: request.arguments,
    log: (message) => {
      request.logger?.log(`[extension:${entry.id}] ${message}`);
    },
    settings: createSettingsAccessor(extension, stateStore),
    secrets: createSecretsAccessor(extension, stateStore),
    ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
    ...(request.questionsResult !== undefined ? { questionsResult: request.questionsResult } : {}),
  };

  const directInvoker = activated.invokeTool;
  if (typeof directInvoker === "function") {
    return directInvoker(toolContext);
  }

  const toolHandler = resolveToolHandler(activated.tools, request.toolName);
  if (!toolHandler) {
    throw new Error(`The extension does not export a tool handler: ${request.toolName}`);
  }
  return toolHandler(toolContext);
}

async function resolveActivatedExtensionSystemPrompt(
  activated: HostActivatedExtension | undefined,
): Promise<string | undefined> {
  if (!activated) {
    return undefined;
  }

  if (typeof activated.getSystemPrompt === "function") {
    const dynamicPrompt = await activated.getSystemPrompt();
    const normalizedDynamicPrompt = dynamicPrompt?.trim();
    return normalizedDynamicPrompt ? normalizedDynamicPrompt : undefined;
  }

  const staticPrompt = activated.systemPrompt?.trim();
  return staticPrompt ? staticPrompt : undefined;
}

function resolveToolHandler(
  tools: HostActivatedExtension["tools"],
  toolName: string,
): HostExtensionToolHandler<unknown> | undefined {
  if (!tools || typeof tools !== "object") {
    return undefined;
  }

  const handler = tools[toolName];
  return typeof handler === "function" ? handler : undefined;
}

function renderExtensionToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (result === undefined) {
    return "";
  }
  return JSON.stringify(result, null, 2);
}

function createSettingsAccessor(
  extension: HostInstalledExtension,
  stateStore: ExtensionStateStore,
): HostExtensionSettingsAccessor {
  return {
    async get(key) {
      const values = await loadSettingsValuesForExtension(extension, stateStore);
      return values[key];
    },
    async getAll() {
      return loadSettingsValuesForExtension(extension, stateStore);
    },
    async set(key, value) {
      await saveSettingsValuesForExtension(extension, stateStore, { [key]: value });
    },
    async setAll(values) {
      return saveSettingsValuesForExtension(extension, stateStore, values);
    },
  };
}

function createSecretsAccessor(
  extension: HostInstalledExtension,
  stateStore: ExtensionStateStore,
): HostExtensionSecretsAccessor {
  return {
    async get(key) {
      assertSecretSlot(extension.manifest, key);
      return stateStore.loadSecret?.(extension.id, key);
    },
    async has(key) {
      assertSecretSlot(extension.manifest, key);
      return hasExtensionSecret(stateStore, extension.id, key);
    },
    async set(key, value) {
      assertSecretSlot(extension.manifest, key);
      if (!stateStore.saveSecret) {
        throw new Error(
          `The current host does not implement extension secret storage: ${extension.id}`,
        );
      }
      await stateStore.saveSecret(extension.id, key, value);
    },
    async delete(key) {
      assertSecretSlot(extension.manifest, key);
      await stateStore.deleteSecret?.(extension.id, key);
    },
  };
}

async function hasExtensionSecret(
  stateStore: ExtensionStateStore,
  extensionId: string,
  key: string,
): Promise<boolean> {
  if (stateStore.hasSecret) {
    return stateStore.hasSecret(extensionId, key);
  }
  if (stateStore.loadSecret) {
    return Boolean(await stateStore.loadSecret(extensionId, key));
  }
  return false;
}

function assertSecretSlot(manifest: HostExtensionManifest, key: string): void {
  if (!manifest.secretSlots?.some((slot) => slot.key === key)) {
    throw new Error(`The extension does not declare the secret slot: ${key}`);
  }
}

async function requireInstalledExtension(
  context: ExtensionManagementContext,
  id: string,
): Promise<HostInstalledExtension> {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error("The extension id must not be empty.");
  }

  const installed = await listInstalledExtensions(context);
  const target = installed.find((item) => item.id === normalizedId);
  if (!target) {
    throw new Error(`Extension not found: ${normalizedId}`);
  }
  return target;
}

function normalizeSettingsValues(
  manifest: HostExtensionManifest,
  storedValues: HostExtensionSettingsValues,
): HostExtensionSettingsValues {
  const normalized: HostExtensionSettingsValues = {};

  for (const definition of manifest.settingsSchema ?? []) {
    const candidate = storedValues[definition.key];
    if (candidate !== undefined) {
      normalized[definition.key] = validateSettingValue(definition, candidate, false);
      continue;
    }

    if (definition.defaultValue !== undefined) {
      normalized[definition.key] = definition.defaultValue;
    }
  }

  return normalized;
}

async function loadSettingsValuesForExtension(
  extension: HostInstalledExtension,
  stateStore: ExtensionStateStore,
): Promise<HostExtensionSettingsValues> {
  return normalizeSettingsValues(extension.manifest, await stateStore.loadSettings(extension.id));
}

async function saveSettingsValuesForExtension(
  extension: HostInstalledExtension,
  stateStore: ExtensionStateStore,
  incomingValues: HostExtensionSettingsValues,
): Promise<HostExtensionSettingsValues> {
  const currentValues = await stateStore.loadSettings(extension.id);
  const nextValues = mergeSettingsValues(extension.manifest, currentValues, incomingValues);
  await stateStore.saveSettings(extension.id, nextValues);
  return normalizeSettingsValues(extension.manifest, nextValues);
}

function mergeSettingsValues(
  manifest: HostExtensionManifest,
  currentValues: HostExtensionSettingsValues,
  incomingValues: HostExtensionSettingsValues,
): HostExtensionSettingsValues {
  const merged: HostExtensionSettingsValues = { ...currentValues };
  const definitions = new Map((manifest.settingsSchema ?? []).map((item) => [item.key, item]));

  for (const [key, rawValue] of Object.entries(incomingValues)) {
    const definition = definitions.get(key);
    if (!definition) {
      throw new Error(`The extension does not declare the setting: ${key}`);
    }

    if (rawValue === null) {
      if (definition.required && definition.defaultValue === undefined) {
        throw new Error(`Extension setting ${key} is required and cannot be cleared.`);
      }
      delete merged[key];
      continue;
    }

    merged[key] = validateSettingValue(definition, rawValue, true);
  }

  return merged;
}

function validateSettingValue(
  definition: HostExtensionSettingDefinition,
  value: ExtensionSettingValue,
  allowNull: boolean,
): ExtensionSettingValue {
  if (value === null) {
    if (allowNull) {
      return value;
    }
    throw new Error(`Extension setting ${definition.key} must not be empty.`);
  }

  if (definition.type === "string") {
    if (typeof value !== "string") {
      throw new Error(`Extension setting ${definition.key} must be a string.`);
    }
    if (definition.required && value.trim().length === 0) {
      throw new Error(`Extension setting ${definition.key} must not be empty.`);
    }
    return value;
  }

  if (definition.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error(`Extension setting ${definition.key} must be a boolean.`);
    }
    return value;
  }

  if (definition.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Extension setting ${definition.key} must be a number.`);
    }
    return value;
  }

  if (typeof value !== "string") {
    throw new Error(`Extension setting ${definition.key} must be a string.`);
  }

  const options = definition.options?.map((option) => option.value) ?? [];
  if (options.length > 0 && !options.includes(value)) {
    throw new Error(`Extension setting ${definition.key} has an invalid value: ${value}`);
  }
  return value;
}

function supportsResolvableToolContribution(manifest: HostExtensionManifest): boolean {
  return (
    manifest.requestedCapabilities?.includes("tool-definitions") === true &&
    manifest.requestedCapabilities?.includes("tool-execution") === true
  );
}

function collectResolvableExtensionTools(
  extensions: readonly Pick<HostInstalledExtension, "id" | "manifest" | "enabled">[],
): HostResolvedExtensionTool[] {
  const collected: HostResolvedExtensionTool[] = [];
  const seenInvocationNames = new Set<string>();

  for (const extension of extensions) {
    if (extension.enabled === false) {
      continue;
    }
    if (!supportsResolvableToolContribution(extension.manifest)) {
      continue;
    }

    for (const tool of extension.manifest.contributes?.tools ?? []) {
      const baseName = buildExtensionToolInvocationName(extension.id, tool.name);
      const invocationName = ensureUniqueExtensionToolInvocationName(baseName, seenInvocationNames);
      seenInvocationNames.add(invocationName);
      collected.push({
        extensionId: extension.id,
        extensionName: extension.manifest.name,
        tool,
        invocationName,
      });
    }
  }

  return collected;
}

function buildExtensionToolInvocationName(extensionId: string, toolName: string): string {
  const extensionFragment = truncateExtensionToolInvocationFragment(
    sanitizeExtensionToolInvocationFragment(extensionId),
    EXTENSION_TOOL_ID_FRAGMENT_LIMIT,
  );
  const toolFragment = truncateExtensionToolInvocationFragment(
    sanitizeExtensionToolInvocationFragment(toolName),
    EXTENSION_TOOL_NAME_FRAGMENT_LIMIT,
  );
  const digest = createHash("sha1")
    .update(`${extensionFragment}\0${toolFragment}`)
    .digest("hex")
    .slice(0, 8);
  const base = `extension__${extensionFragment}__${toolFragment}__${digest}`;

  return base.length > EXTENSION_TOOL_INVOCATION_NAME_MAX_LENGTH
    ? base.slice(0, EXTENSION_TOOL_INVOCATION_NAME_MAX_LENGTH)
    : base;
}

function ensureUniqueExtensionToolInvocationName(
  baseName: string,
  seenInvocationNames: ReadonlySet<string>,
): string {
  if (!seenInvocationNames.has(baseName)) {
    return baseName;
  }

  for (let index = 1; ; index += 1) {
    const suffix = `__${index}`;
    const candidate = `${baseName.slice(0, EXTENSION_TOOL_INVOCATION_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!seenInvocationNames.has(candidate)) {
      return candidate;
    }
  }
}

function sanitizeExtensionToolInvocationFragment(input: string): string {
  let output = "";

  for (const char of input) {
    if (
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      (char >= "0" && char <= "9")
    ) {
      output += char.toLowerCase();
      continue;
    }

    if (!output.endsWith("_")) {
      output += "_";
    }
  }

  const trimmed = output.replace(/^_+|_+$/gu, "");
  return trimmed || "tool";
}

function truncateExtensionToolInvocationFragment(input: string, maxLength: number): string {
  return Array.from(input).slice(0, maxLength).join("");
}

function supportsSystemPromptContribution(manifest: HostExtensionManifest): boolean {
  return manifest.requestedCapabilities?.includes("system-prompt") === true;
}

async function deactivateAllExtensions(
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
): Promise<void> {
  for (const entry of activatedExtensions.values()) {
    await entry.dispose?.();
  }
  activatedExtensions.clear();
}

async function deactivateExtensionById(
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  id: string,
): Promise<void> {
  const normalizedId = id.trim();
  const entry = activatedExtensions.get(normalizedId);
  if (!entry) {
    return;
  }

  await entry.dispose?.();
  activatedExtensions.delete(normalizedId);
}

async function ensureExtensionDirectories(paths: ExtensionPaths): Promise<void> {
  await mkdir(paths.extensionsDir, { recursive: true });
  await mkdir(paths.extensionStateDir, { recursive: true });
  await mkdir(path.dirname(paths.extensionsIndexFile), { recursive: true });
}

async function readExtensionManifestFile(filePath: string): Promise<HostExtensionManifest> {
  const raw = await readFile(filePath, "utf8");
  const manifestDirectory = path.dirname(filePath);
  return parseExtensionManifest(raw, {
    readRelativeTextFile: async (relativePath, fieldName) => {
      const targetPath = path.join(
        manifestDirectory,
        ...normalizeArchivePath(relativePath).split("/"),
      );
      try {
        return await readFile(targetPath, "utf8");
      } catch {
        throw new Error(
          `The file referenced by extension ${fieldName} does not exist: ${relativePath}`,
        );
      }
    },
    listRelativeChildDirectories: async (relativePath) => {
      const targetPath = path.join(
        manifestDirectory,
        ...normalizeArchivePath(relativePath).split("/"),
      );
      if (!existsSync(targetPath)) {
        return [];
      }
      try {
        const entries = await readdir(targetPath, { withFileTypes: true });
        return entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort((left, right) => left.localeCompare(right));
      } catch {
        return [];
      }
    },
  });
}

async function parseExtensionManifest(
  raw: string,
  options: HostExtensionManifestParseOptions = {},
): Promise<HostExtensionManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The extension package.json is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("The extension package.json must be a JSON object.");
  }

  const spiritExtension = requiredSpiritExtensionField(parsed[SPIRIT_EXTENSION_FIELD_NAME]);
  const schemaVersion =
    spiritExtension.schemaVersion === undefined
      ? EXTENSION_SCHEMA_VERSION
      : numberField(spiritExtension.schemaVersion, `${SPIRIT_EXTENSION_FIELD_NAME}.schemaVersion`);
  if (schemaVersion !== EXTENSION_SCHEMA_VERSION) {
    throw new Error(
      `Only extension package.json with ${SPIRIT_EXTENSION_FIELD_NAME}.schemaVersion=${EXTENSION_SCHEMA_VERSION} is supported.`,
    );
  }

  const id = packageNameField(parsed.name);
  const name = stringField(
    spiritExtension.displayName,
    `${SPIRIT_EXTENSION_FIELD_NAME}.displayName`,
  );
  const icon = optionalPackageStringField(
    spiritExtension.icon,
    `${SPIRIT_EXTENSION_FIELD_NAME}.icon`,
  );
  const version = stringField(parsed.version, "version");
  const description = optionalPackageStringField(parsed.description, "description");
  const author = optionalPackageAuthorField(parsed.author);
  const homepage = optionalPackageStringField(parsed.homepage, "homepage");
  const main = optionalPackageStringField(parsed.main, "main");
  const activationEvents = optionalActivationEventsField(
    spiritExtension.activationEvents,
    `${SPIRIT_EXTENSION_FIELD_NAME}.activationEvents`,
  );
  const requestedCapabilities = optionalRequestedCapabilitiesField(
    spiritExtension.requestedCapabilities,
    `${SPIRIT_EXTENSION_FIELD_NAME}.requestedCapabilities`,
  );
  const contributes = await optionalContributionSetField(
    spiritExtension.contributes,
    options,
    `${SPIRIT_EXTENSION_FIELD_NAME}.contributes`,
  );
  const settingsSchema = optionalSettingsSchemaField(
    spiritExtension.settingsSchema,
    `${SPIRIT_EXTENSION_FIELD_NAME}.settingsSchema`,
  );
  const secretSlots = optionalSecretSlotsField(
    spiritExtension.secretSlots,
    `${SPIRIT_EXTENSION_FIELD_NAME}.secretSlots`,
  );
  const supportedHosts = requiredSupportedHostsField(
    spiritExtension.supportedHosts,
    `${SPIRIT_EXTENSION_FIELD_NAME}.supportedHosts`,
  );

  if (main) {
    assertSafeRelativePath(main, "main");
  }

  if (icon) {
    assertSafeRelativePath(icon, `${SPIRIT_EXTENSION_FIELD_NAME}.icon`);
  }

  assertHostUiContributionCapabilities(requestedCapabilities, contributes);
  assertInstructionContributionCapabilities(requestedCapabilities, contributes);
  await assertDeclaredInstructionContributionFiles(contributes, options);

  return {
    schemaVersion,
    id,
    name,
    ...(icon ? { icon } : {}),
    version,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    ...(main ? { main } : {}),
    supportedHosts,
    ...(activationEvents.length > 0 ? { activationEvents } : {}),
    ...(requestedCapabilities.length > 0 ? { requestedCapabilities } : {}),
    ...(contributes ? { contributes } : {}),
    ...(settingsSchema.length > 0 ? { settingsSchema } : {}),
    ...(secretSlots.length > 0 ? { secretSlots } : {}),
    ...(optionalBooleanField(spiritExtension.defaultInstalled) === false
      ? { defaultInstalled: false }
      : {}),
  };
}

async function loadExtensionRegistry(
  filePath: string,
): Promise<Map<string, HostExtensionRegistryEntry>> {
  if (!existsSync(filePath)) {
    return new Map();
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { entries?: HostExtensionRegistryEntry[] };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return new Map(
      entries
        .filter(
          (entry) => typeof entry?.id === "string" && typeof entry?.directoryName === "string",
        )
        .map((entry) => [entry.id, entry]),
    );
  } catch {
    return new Map();
  }
}

async function saveExtensionRegistryIfChanged(
  filePath: string,
  currentEntries: ReadonlyMap<string, HostExtensionRegistryEntry>,
  nextEntries: readonly HostExtensionRegistryEntry[],
): Promise<void> {
  const currentJson = serializeRegistry(Array.from(currentEntries.values()));
  const nextJson = serializeRegistry(nextEntries);
  if (currentJson === nextJson) {
    return;
  }

  await writeFile(filePath, nextJson, "utf8");
}

async function writeExtensionRegistry(
  filePath: string,
  entries: readonly HostExtensionRegistryEntry[],
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeRegistry(entries), "utf8");
}

function serializeRegistry(entries: readonly HostExtensionRegistryEntry[]): string {
  const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id, "en"));
  return `${JSON.stringify({ entries: sorted }, null, 2)}\n`;
}

function toExtensionRegistryEntry(
  item: Pick<
    HostInstalledExtension,
    "id" | "directoryName" | "installedAtUnixMs" | "archiveFileName" | "installSource"
  >,
): HostExtensionRegistryEntry {
  return {
    id: item.id,
    directoryName: item.directoryName,
    installedAtUnixMs: item.installedAtUnixMs,
    ...(item.archiveFileName ? { archiveFileName: item.archiveFileName } : {}),
    ...(item.installSource ? { installSource: item.installSource } : {}),
  };
}

function resolveManifestArchivePath(entryNames: readonly string[]): string {
  const candidates = entryNames.filter((entryName) => {
    const normalized = normalizeArchivePath(entryName);
    return (
      normalized.endsWith(`/${EXTENSION_MANIFEST_FILE_NAME}`) ||
      normalized === EXTENSION_MANIFEST_FILE_NAME
    );
  });

  if (candidates.length === 0) {
    throw new Error(`The extension ZIP is missing ${EXTENSION_MANIFEST_FILE_NAME}.`);
  }

  if (candidates.length > 1) {
    throw new Error(`The extension ZIP contains multiple ${EXTENSION_MANIFEST_FILE_NAME}.`);
  }

  const manifestPath = candidates[0];
  if (!manifestPath) {
    throw new Error(`The extension ZIP is missing ${EXTENSION_MANIFEST_FILE_NAME}.`);
  }

  return normalizeArchivePath(manifestPath);
}

function resolveArchiveRelativePath(
  entryName: string,
  manifestEntryName: string,
): string | undefined {
  const normalizedEntryName = normalizeArchivePath(entryName);
  const manifestRoot = manifestEntryName.includes("/")
    ? manifestEntryName.slice(0, manifestEntryName.lastIndexOf("/"))
    : "";

  if (manifestRoot) {
    if (!normalizedEntryName.startsWith(`${manifestRoot}/`)) {
      return undefined;
    }
  }

  const relativePath = manifestRoot
    ? normalizedEntryName.slice(manifestRoot.length + 1)
    : normalizedEntryName;

  if (!relativePath || relativePath.endsWith("/")) {
    return undefined;
  }

  assertSafeRelativePath(relativePath, "archive entry");
  return relativePath;
}

function normalizeArchivePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function extensionDirectoryNameFromId(id: string): string {
  return `pkg-${Buffer.from(id, "utf8").toString("base64url")}`;
}

async function activateExtension<THostApi>(
  target: HostInstalledExtension,
  mainFilePath: string,
  options: {
    host: THostApi;
    logger?: Pick<Console, "error" | "log">;
    log: (message: string) => void;
    settings: HostExtensionSettingsAccessor;
    secrets: HostExtensionSecretsAccessor;
    activationEvent?: HostExtensionEvent;
  },
): Promise<HostActivatedExtension | undefined> {
  const loadedModule = await loadExtensionModule(target, mainFilePath, options.logger);
  const activate = resolveActivateHandler<THostApi>(loadedModule);
  if (!activate) {
    throw new Error(
      `Extension ${target.manifest.name} does not export activate; export activate(context) or a default export of that function.`,
    );
  }

  try {
    const activationResult = await activate({
      extension: {
        id: target.id,
        name: target.manifest.name,
        version: target.manifest.version,
        directoryPath: target.directoryPath,
        manifestPath: target.manifestPath,
        main: target.manifest.main ?? "",
      },
      host: options.host,
      log: options.log,
      settings: options.settings,
      secrets: options.secrets,
      ...(options.activationEvent ? { activationEvent: options.activationEvent } : {}),
    });

    return resolveActivatedExtension(activationResult) ?? resolveActivatedExtension(loadedModule);
  } catch (error) {
    options.logger?.error(`[extension:${target.id}] activate failed`, error);
    throw new Error(
      `Failed to execute extension: ${target.manifest.name} (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

async function loadExtensionModule(
  target: HostInstalledExtension,
  mainFilePath: string,
  logger?: Pick<Console, "error" | "log">,
): Promise<unknown> {
  try {
    const mainModuleUrl = pathToFileURL(mainFilePath);
    mainModuleUrl.searchParams.set("ts", `${target.installedAtUnixMs}`);
    return await import(mainModuleUrl.href);
  } catch (error) {
    logger?.error(`[extension:${target.id}] load failed`, error);
    throw new Error(
      `Failed to load extension: ${target.manifest.name} (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

function resolveActivatedExtension(value: unknown): HostActivatedExtension | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const tools = resolveActivatedExtensionTools(value.tools);
  const invokeTool =
    typeof value.invokeTool === "function"
      ? (value.invokeTool as HostActivatedExtension["invokeTool"])
      : undefined;
  const systemPrompt =
    typeof value.systemPrompt === "string" && value.systemPrompt.trim()
      ? value.systemPrompt
      : undefined;
  const getSystemPrompt =
    typeof value.getSystemPrompt === "function"
      ? (value.getSystemPrompt as HostActivatedExtension["getSystemPrompt"])
      : undefined;
  const onEvent = typeof value.onEvent === "function" ? value.onEvent : undefined;
  const dispose = typeof value.dispose === "function" ? value.dispose : undefined;
  if (!tools && !invokeTool && !systemPrompt && !getSystemPrompt && !onEvent && !dispose) {
    return undefined;
  }

  return Object.assign(
    {},
    tools ? { tools } : {},
    invokeTool ? { invokeTool } : {},
    systemPrompt ? { systemPrompt } : {},
    getSystemPrompt ? { getSystemPrompt } : {},
    onEvent ? { onEvent: onEvent as HostActivatedExtension["onEvent"] } : {},
    dispose ? { dispose: dispose as HostActivatedExtension["dispose"] } : {},
  ) as HostActivatedExtension;
}

function resolveActivatedExtensionTools(
  value: unknown,
): HostActivatedExtension["tools"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(([, handler]) => typeof handler === "function");
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as HostActivatedExtension["tools"];
}

function resolveActivateHandler<THostApi>(
  loadedModule: unknown,
): ((context: HostExtensionActivationContext<THostApi>) => unknown) | undefined {
  if (typeof loadedModule === "function") {
    return loadedModule as (context: HostExtensionActivationContext<THostApi>) => unknown;
  }

  if (!isRecord(loadedModule)) {
    return undefined;
  }

  if (typeof loadedModule.activate === "function") {
    return loadedModule.activate as (context: HostExtensionActivationContext<THostApi>) => unknown;
  }

  const defaultExport = loadedModule.default;
  if (typeof defaultExport === "function") {
    return defaultExport as (context: HostExtensionActivationContext<THostApi>) => unknown;
  }

  if (isRecord(defaultExport) && typeof defaultExport.activate === "function") {
    return defaultExport.activate as (context: HostExtensionActivationContext<THostApi>) => unknown;
  }

  return undefined;
}

function assertSafeRelativePath(filePath: string, label: string): void {
  const normalized = normalizeArchivePath(filePath);
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error(`Extension ${label} must be a relative path.`);
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Extension ${label} contains an illegal path segment.`);
  }
}

function requiredSpiritExtensionField(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(
      `The extension package.json is missing the ${SPIRIT_EXTENSION_FIELD_NAME} field, which must be an object.`,
    );
  }
  return value;
}

function packageNameField(value: unknown): string {
  const packageName = stringField(value, "name");
  if (!EXTENSION_PACKAGE_NAME_PATTERN.test(packageName)) {
    throw new Error(
      "The extension package.json name field is invalid; it must be a valid npm package name, and only lowercase names with an optional scope are supported.",
    );
  }
  return packageName;
}

function optionalPackageStringField(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`The extension package.json field ${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalPackageAuthorField(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (isRecord(value)) {
    return optionalPackageStringField(value.name, "author.name");
  }
  throw new Error(
    "The extension package.json author field must be a string or an object with a name field.",
  );
}

function stringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Extension field ${fieldName} must not be empty.`);
  }
  return value.trim();
}

function optionalStringField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredSupportedHostsField(value: unknown, fieldName: string): ExtensionHostKind[] {
  if (value === undefined || value === null) {
    throw new Error(
      `Extension field ${fieldName} is missing; it must be a non-empty array with cli and/or desktop entries.`,
    );
  }
  if (!Array.isArray(value)) {
    throw new Error(`Extension field ${fieldName} must be an array of strings.`);
  }
  if (value.length === 0) {
    throw new Error(
      `Extension field ${fieldName} must contain at least one entry (cli or desktop).`,
    );
  }

  const result: ExtensionHostKind[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error(`Extension field ${fieldName} must be an array of strings.`);
    }
    const normalized = entry.trim() as ExtensionHostKind;
    if (!SUPPORTED_EXTENSION_HOST_KINDS.includes(normalized)) {
      throw new Error(`Extension field ${fieldName} has an invalid value: ${entry}`);
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }

  return result;
}

function optionalActivationEventsField(
  value: unknown,
  fieldName: string,
): HostExtensionActivationEventName[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: HostExtensionActivationEventName[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error(`Extension field ${fieldName} must be an array of strings.`);
    }
    const normalized = entry.trim() as HostExtensionActivationEventName;
    if (!SUPPORTED_HOST_EXTENSION_ACTIVATION_EVENTS.includes(normalized)) {
      throw new Error(`Extension field ${fieldName} has an invalid value: ${entry}`);
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }

  return result;
}

function optionalRequestedCapabilitiesField(
  value: unknown,
  fieldName: string,
): HostExtensionRequestedCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: HostExtensionRequestedCapability[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error(`Extension field ${fieldName} must be an array of strings.`);
    }
    const normalized = entry.trim() as HostExtensionRequestedCapability;
    if (!SUPPORTED_HOST_EXTENSION_REQUESTED_CAPABILITIES.includes(normalized)) {
      throw new Error(`Extension field ${fieldName} has an invalid value: ${entry}`);
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }

  return result;
}

async function optionalContributionSetField(
  value: unknown,
  options: HostExtensionManifestParseOptions,
  fieldPrefix: string,
): Promise<HostExtensionContributionSet | undefined> {
  if (!isRecord(value)) {
    return undefined;
  }

  const tools = optionalContributedToolsField(value.tools, `${fieldPrefix}.tools`);
  const desktop = optionalDesktopContributionSetField(value.desktop, `${fieldPrefix}.desktop`);
  const cli = await optionalCliContributionSetField(value.cli, options, `${fieldPrefix}.cli`);
  const mcp = optionalDeclaredContributionFlag(value.mcp, `${fieldPrefix}.mcp`);
  const hooks = optionalDeclaredContributionFlag(value.hooks, `${fieldPrefix}.hooks`);
  const skills = optionalDeclaredContributionFlag(value.skills, `${fieldPrefix}.skills`);
  const rules = optionalDeclaredContributionFlag(value.rules, `${fieldPrefix}.rules`);
  if (tools.length === 0 && !desktop && !cli && !mcp && !hooks && !skills && !rules) {
    return undefined;
  }

  return {
    ...(tools.length > 0 ? { tools } : {}),
    ...(desktop ? { desktop } : {}),
    ...(cli ? { cli } : {}),
    ...(mcp ? { mcp: true } : {}),
    ...(hooks ? { hooks: true } : {}),
    ...(skills ? { skills: true } : {}),
    ...(rules ? { rules: true } : {}),
  };
}

function optionalDeclaredContributionFlag(value: unknown, fieldName: string): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (value === true) {
    return true;
  }
  if (isRecord(value) && Object.keys(value).length === 0) {
    return true;
  }
  throw new Error(`Extension field ${fieldName} must be true or {}.`);
}

function optionalContributedToolsField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionContributedToolDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => parseContributedToolDefinition(entry, index, fieldPrefix));
}

function optionalDesktopContributionSetField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionDesktopContributionSet | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const css = optionalDesktopCssDefinitionsField(value.css, `${fieldPrefix}.css`);
  const settingsPage = optionalDesktopSettingsPageDefinitionField(
    value.settingsPage,
    `${fieldPrefix}.settingsPage`,
  );
  if (css.length === 0 && !settingsPage) {
    return undefined;
  }

  return {
    ...(css.length > 0 ? { css } : {}),
    ...(settingsPage ? { settingsPage } : {}),
  };
}

function optionalDesktopCssDefinitionsField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionDesktopCssDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => parseDesktopCssDefinition(entry, index, fieldPrefix));
}

async function optionalCliContributionSetField(
  value: unknown,
  options: HostExtensionManifestParseOptions,
  fieldPrefix: string,
): Promise<HostExtensionCliContributionSet | undefined> {
  if (!isRecord(value)) {
    return undefined;
  }

  const hooks = await optionalCliUiHookDefinitionsField(
    value.hooks,
    options,
    `${fieldPrefix}.hooks`,
  );
  if (hooks.length === 0) {
    return undefined;
  }

  return { hooks };
}

async function optionalCliUiHookDefinitionsField(
  value: unknown,
  options: HostExtensionManifestParseOptions,
  fieldPrefix: string,
): Promise<HostExtensionCliUiHookDefinition[]> {
  if (value === undefined || value === null) {
    return [];
  }

  if (!isRecord(value)) {
    throw new Error(
      `Extension field ${fieldPrefix} must be an object that references an external resource file via path.`,
    );
  }

  const hooksPath = stringField(value.path, `${fieldPrefix}.path`);
  assertSafeRelativePath(hooksPath, `${fieldPrefix}.path`);
  const readRelativeTextFile = options.readRelativeTextFile;
  if (!readRelativeTextFile) {
    throw new Error(`The current context cannot read extension ${fieldPrefix}.path: ${hooksPath}`);
  }

  const raw = await readRelativeTextFile(hooksPath, `${fieldPrefix}.path`);
  return parseCliUiHookDocument(raw, hooksPath);
}

function parseCliUiHookDocument(
  raw: string,
  resourcePath: string,
): HostExtensionCliUiHookDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`The extension CLI hooks resource is not valid JSON: ${resourcePath}`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.hooks)) {
    throw new Error(
      `The extension CLI hooks resource must be an object of the form { "hooks": [...] }: ${resourcePath}`,
    );
  }

  return parsed.hooks.map((entry, index) =>
    parseCliUiHookDefinition(entry, index, `CLI hooks resource ${resourcePath}.hooks`),
  );
}

function parseCliUiHookDefinition(
  value: unknown,
  index: number,
  fieldPrefix = "contributes.cli.hooks",
): HostExtensionCliUiHookDefinition {
  if (!isRecord(value)) {
    throw new Error(`Extension field ${fieldPrefix}[${index}] must be an object.`);
  }

  const slot = enumField(
    value.slot,
    `${fieldPrefix}[${index}].slot`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_SLOTS,
  );
  const variant = optionalEnumField(
    value.variant,
    `${fieldPrefix}[${index}].variant`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_VARIANTS,
  );
  const tokens = optionalCliUiHookTokensField(value.tokens, `${fieldPrefix}[${index}].tokens`);
  const prefix = optionalStringField(value.prefix);
  const suffix = optionalStringField(value.suffix);

  return {
    slot,
    ...(variant ? { variant } : {}),
    ...(tokens ? { tokens } : {}),
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

function optionalCliUiHookTokensField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionCliUiHookTokens | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const foreground = optionalEnumField(
    value.foreground,
    `${fieldPrefix}.foreground`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES,
  );
  const border = optionalEnumField(
    value.border,
    `${fieldPrefix}.border`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES,
  );
  const accent = optionalEnumField(
    value.accent,
    `${fieldPrefix}.accent`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES,
  );

  if (!foreground && !border && !accent) {
    return undefined;
  }

  return {
    ...(foreground ? { foreground } : {}),
    ...(border ? { border } : {}),
    ...(accent ? { accent } : {}),
  };
}

function parseDesktopCssDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
): HostExtensionDesktopCssDefinition {
  if (!isRecord(value)) {
    throw new Error(`Extension field ${fieldPrefix}[${index}] must be an object.`);
  }

  const cssPath = stringField(value.path, `${fieldPrefix}[${index}].path`);
  assertSafeRelativePath(cssPath, `${fieldPrefix}[${index}].path`);
  const media = optionalStringField(value.media);

  return {
    path: cssPath,
    ...(media ? { media } : {}),
  };
}

function optionalDesktopSettingsPageDefinitionField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionDesktopSettingsPageDefinition | undefined {
  if (value === undefined || value === null || value === false) {
    return undefined;
  }
  if (value === true) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`Extension field ${fieldPrefix} must be a boolean or an object.`);
  }

  const title = optionalStringField(value.title);
  return title ? { title } : {};
}

function assertHostUiContributionCapabilities(
  requestedCapabilities: readonly HostExtensionRequestedCapability[],
  contributes: HostExtensionContributionSet | undefined,
): void {
  const hasDesktopContribution = Boolean(contributes?.desktop);
  const hasCliContribution = Boolean(contributes?.cli);
  const hasDesktopCapability = requestedCapabilities.includes("desktop-ui");
  const hasCliCapability = requestedCapabilities.includes("cli-ui");

  if (hasDesktopContribution !== hasDesktopCapability) {
    throw new Error(
      hasDesktopContribution
        ? `The extension declares ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.desktop but is missing desktop-ui in ${SPIRIT_EXTENSION_FIELD_NAME}.requestedCapabilities.`
        : `The extension declares the desktop-ui capability but is missing ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.desktop.`,
    );
  }

  if (hasCliContribution !== hasCliCapability) {
    throw new Error(
      hasCliContribution
        ? `The extension declares ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.cli but is missing cli-ui in ${SPIRIT_EXTENSION_FIELD_NAME}.requestedCapabilities.`
        : `The extension declares the cli-ui capability but is missing ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.cli.`,
    );
  }
}

function assertInstructionContributionCapabilities(
  requestedCapabilities: readonly HostExtensionRequestedCapability[],
  contributes: HostExtensionContributionSet | undefined,
): void {
  for (const pair of INSTRUCTION_CONTRIBUTION_PAIRS) {
    const hasContribution = contributes?.[pair.contributionKey] === true;
    const hasCapability = requestedCapabilities.includes(pair.capability);
    if (hasContribution === hasCapability) {
      continue;
    }
    throw new Error(
      hasContribution
        ? `The extension declares ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.${pair.contributionKey} but is missing ${pair.capability} in ${SPIRIT_EXTENSION_FIELD_NAME}.requestedCapabilities.`
        : `The extension declares the ${pair.capability} capability but is missing ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.${pair.contributionKey}.`,
    );
  }
}

async function assertDeclaredInstructionContributionFiles(
  contributes: HostExtensionContributionSet | undefined,
  options: HostExtensionManifestParseOptions,
): Promise<void> {
  if (!contributes?.mcp && !contributes?.hooks && !contributes?.skills && !contributes?.rules) {
    return;
  }

  const readRelativeTextFile = options.readRelativeTextFile;
  if (!readRelativeTextFile) {
    throw new Error(
      "The current context cannot read extension contribution files from the package root.",
    );
  }

  if (contributes.mcp === true) {
    await assertDeclaredMcpContributionFile(readRelativeTextFile);
  }
  if (contributes.hooks === true) {
    await assertDeclaredHooksContributionFile(readRelativeTextFile);
  }
  if (contributes.rules === true) {
    await assertDeclaredRulesContributionFile(readRelativeTextFile);
  }
  if (contributes.skills === true) {
    await assertDeclaredSkillsContributionFiles(readRelativeTextFile, options);
  }
}

async function assertDeclaredMcpContributionFile(
  readRelativeTextFile: NonNullable<HostExtensionManifestParseOptions["readRelativeTextFile"]>,
): Promise<void> {
  const fieldName = `${SPIRIT_EXTENSION_FIELD_NAME}.contributes.mcp`;
  const raw = await readRelativeTextFile(EXTENSION_MCP_CONFIG_FILE_NAME, fieldName);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`The extension ${EXTENSION_MCP_CONFIG_FILE_NAME} is not valid JSON.`);
  }
  try {
    parseMcpConfigFile(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The extension ${EXTENSION_MCP_CONFIG_FILE_NAME} is invalid: ${detail}`);
  }
}

async function assertDeclaredHooksContributionFile(
  readRelativeTextFile: NonNullable<HostExtensionManifestParseOptions["readRelativeTextFile"]>,
): Promise<void> {
  const fieldName = `${SPIRIT_EXTENSION_FIELD_NAME}.contributes.hooks`;
  const raw = await readRelativeTextFile(EXTENSION_HOOKS_CONFIG_FILE_NAME, fieldName);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`The extension ${EXTENSION_HOOKS_CONFIG_FILE_NAME} is not valid JSON.`);
  }
  try {
    parseHooksConfigFile(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The extension ${EXTENSION_HOOKS_CONFIG_FILE_NAME} is invalid: ${detail}`);
  }
}

async function assertDeclaredRulesContributionFile(
  readRelativeTextFile: NonNullable<HostExtensionManifestParseOptions["readRelativeTextFile"]>,
): Promise<void> {
  const fieldName = `${SPIRIT_EXTENSION_FIELD_NAME}.contributes.rules`;
  const raw = await readRelativeTextFile(EXTENSION_RULE_FILE_NAME, fieldName);
  if (!raw.trim()) {
    throw new Error(`The extension ${EXTENSION_RULE_FILE_NAME} must not be empty.`);
  }
}

async function assertDeclaredSkillsContributionFiles(
  readRelativeTextFile: NonNullable<HostExtensionManifestParseOptions["readRelativeTextFile"]>,
  options: HostExtensionManifestParseOptions,
): Promise<void> {
  const listRelativeChildDirectories = options.listRelativeChildDirectories;
  if (!listRelativeChildDirectories) {
    throw new Error(
      "The current context cannot list extension skill directories from the package root.",
    );
  }

  const skillDirectories = await listRelativeChildDirectories(EXTENSION_SKILLS_DIR_NAME);
  const validSkills: string[] = [];
  for (const directoryName of skillDirectories) {
    const relativePath = `${EXTENSION_SKILLS_DIR_NAME}/${directoryName}/${SKILL_FILE_NAME}`;
    let raw: string;
    try {
      raw = await readRelativeTextFile(
        relativePath,
        `${SPIRIT_EXTENSION_FIELD_NAME}.contributes.skills`,
      );
    } catch {
      continue;
    }
    if (isValidDeclaredSkillMarkdown(raw, directoryName)) {
      validSkills.push(directoryName);
    }
  }

  if (validSkills.length === 0) {
    throw new Error(
      `The extension declares ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.skills but has no valid ${EXTENSION_SKILLS_DIR_NAME}/*/${SKILL_FILE_NAME}.`,
    );
  }
}

function isValidDeclaredSkillMarkdown(raw: string, directoryName: string): boolean {
  const split = splitSkillFrontmatter(raw);
  if (!split) {
    return false;
  }
  const parsed = parseSkillFrontmatterFields(split.frontmatter);
  const name = parsed.name?.trim();
  const description = parsed.description?.trim();
  if (!name || !description) {
    return false;
  }
  if (validateSkillName(name) !== undefined) {
    return false;
  }
  return directoryName === name;
}

function listArchiveChildDirectories(
  extracted: ReadonlyMap<string, Uint8Array>,
  manifestRoot: string,
  relativePath: string,
): string[] {
  const normalizedRelative = normalizeArchivePath(relativePath);
  const prefix = manifestRoot ? `${manifestRoot}/${normalizedRelative}/` : `${normalizedRelative}/`;
  const names = new Set<string>();
  for (const entryName of extracted.keys()) {
    if (!entryName.startsWith(prefix)) {
      continue;
    }
    const rest = entryName.slice(prefix.length);
    const first = rest.split("/")[0];
    if (first) {
      names.add(first);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function parseContributedToolDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
): HostExtensionContributedToolDefinition {
  if (!isRecord(value)) {
    throw new Error(`Extension field ${fieldPrefix}[${index}] must be an object.`);
  }

  const name = stringField(value.name, `${fieldPrefix}[${index}].name`);
  if (!EXTENSION_FIELD_KEY_PATTERN.test(name)) {
    throw new Error(`Invalid extension tool name: ${name}`);
  }

  const description = stringField(value.description, `${fieldPrefix}[${index}].description`);
  const inputSchema = schemaField(value.inputSchema, `${fieldPrefix}[${index}].inputSchema`);
  const outputSchema = optionalSchemaField(
    value.outputSchema,
    `${fieldPrefix}[${index}].outputSchema`,
  );
  const approvalMode = optionalEnumField(
    value.approvalMode,
    `${fieldPrefix}[${index}].approvalMode`,
    SUPPORTED_HOST_EXTENSION_TOOL_APPROVAL_MODES,
  );
  const executionMode = optionalEnumField(
    value.executionMode,
    `${fieldPrefix}[${index}].executionMode`,
    SUPPORTED_HOST_EXTENSION_TOOL_EXECUTION_MODES,
  );

  return {
    name,
    description,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    ...(approvalMode ? { approvalMode } : {}),
    ...(executionMode ? { executionMode } : {}),
  };
}

function optionalSettingsSchemaField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionSettingDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => parseSettingDefinition(entry, index, fieldPrefix));
}

function parseSettingDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
): HostExtensionSettingDefinition {
  if (!isRecord(value)) {
    throw new Error(`Extension field ${fieldPrefix}[${index}] must be an object.`);
  }

  const key = stringField(value.key, `${fieldPrefix}[${index}].key`);
  if (!EXTENSION_FIELD_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid extension setting key: ${key}`);
  }

  const type = enumField(
    value.type,
    `${fieldPrefix}[${index}].type`,
    SUPPORTED_HOST_EXTENSION_SETTING_TYPES,
  );
  const title = stringField(value.title, `${fieldPrefix}[${index}].title`);
  const description = optionalStringField(value.description);
  const placeholder = optionalStringField(value.placeholder);
  const required = optionalBooleanField(value.required);
  const defaultValue = optionalSettingDefaultValueField(
    value.defaultValue,
    `${fieldPrefix}[${index}].defaultValue`,
    type,
  );
  const options = optionalSettingOptionsField(
    value.options,
    index,
    type,
    `${fieldPrefix}[${index}].options`,
  );

  return {
    key,
    type,
    title,
    ...(description ? { description } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(options.length > 0 ? { options } : {}),
  };
}

function optionalSettingOptionsField(
  value: unknown,
  settingIndex: number,
  type: HostExtensionSettingType,
  fieldName: string,
): HostExtensionSettingOption[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (type !== "select") {
    throw new Error(
      `Only select-type settings may declare options: ${fieldName.replace(/\.options$/u, "")}`,
    );
  }
  if (!Array.isArray(value)) {
    throw new Error(`Extension field ${fieldName} must be an array.`);
  }

  return value.map((entry, optionIndex) => {
    if (!isRecord(entry)) {
      throw new Error(`Extension field ${fieldName}[${optionIndex}] must be an object.`);
    }
    const optionValue = stringField(entry.value, `${fieldName}[${optionIndex}].value`);
    const label = stringField(entry.label, `${fieldName}[${optionIndex}].label`);
    const description = optionalStringField(entry.description);
    return {
      value: optionValue,
      label,
      ...(description ? { description } : {}),
    };
  });
}

function optionalSettingDefaultValueField(
  value: unknown,
  fieldName: string,
  type: HostExtensionSettingType,
): HostExtensionSettingDefaultValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (type) {
    case "string":
    case "select":
      if (typeof value !== "string") {
        throw new Error(`Extension field ${fieldName} must be a string.`);
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error(`Extension field ${fieldName} must be a boolean.`);
      }
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Extension field ${fieldName} must be a number.`);
      }
      return value;
  }
}

function optionalSecretSlotsField(value: unknown, fieldPrefix: string): HostExtensionSecretSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Extension field ${fieldPrefix}[${index}] must be an object.`);
    }
    const key = stringField(entry.key, `${fieldPrefix}[${index}].key`);
    if (!EXTENSION_FIELD_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid extension secret slot key: ${key}`);
    }
    const title = stringField(entry.title, `${fieldPrefix}[${index}].title`);
    const description = optionalStringField(entry.description);
    const required = optionalBooleanField(entry.required);
    return {
      key,
      title,
      ...(description ? { description } : {}),
      ...(required !== undefined ? { required } : {}),
    };
  });
}

function optionalBooleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function schemaField(value: unknown, fieldName: string): HostExtensionJsonSchema {
  if (!isRecord(value)) {
    throw new Error(`Extension field ${fieldName} must be an object.`);
  }
  return value;
}

function optionalSchemaField(
  value: unknown,
  fieldName: string,
): HostExtensionJsonSchema | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return schemaField(value, fieldName);
}

function enumField<T extends readonly string[]>(
  value: unknown,
  fieldName: string,
  allowedValues: T,
): T[number] {
  if (typeof value !== "string") {
    throw new Error(`Extension field ${fieldName} must be a string.`);
  }
  const normalized = value.trim() as T[number];
  if (!allowedValues.includes(normalized)) {
    throw new Error(`Extension field ${fieldName} has an invalid value: ${value}`);
  }
  return normalized;
}

function optionalEnumField<T extends readonly string[]>(
  value: unknown,
  fieldName: string,
  allowedValues: T,
): T[number] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return enumField(value, fieldName, allowedValues);
}

function numberField(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Extension field ${fieldName} must be a number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
