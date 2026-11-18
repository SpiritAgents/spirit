import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, type Dirent } from "node:fs";
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
import { isSpiritIconName } from "@spiritagent/icons/names";

import {
  HOOKS_CONFIG_FILE_NAME,
  MCP_CONFIG_FILE_NAME,
  parseHooksConfigFile,
  parseMcpConfigFile,
  type JsonObject,
} from "@spiritagent/agent-core";
import {
  assertDeclaredInstructionContributionFiles as assertToolkitDeclaredInstructionContributionFiles,
  EXTENSION_DUMP_FILE_NAME,
  parseExtensionDumpText,
  parseLocalizableText,
  type MarketplaceExtensionDump,
} from "@spiritagent/extension-toolkit";
import { localizeExtensionText, resolveExtensionContextLocale } from "./localization.js";

import type {
  AutomationTriggerContributionDefinition,
  AutomationTriggerMenuPage,
  AutomationTriggerPollOutput,
  AutomationTriggerPollTarget,
  AutomationTriggerProvider,
  AutomationTriggerValidation,
} from "@spiritagent/automations/trigger-provider";

import { assertHostExtensionJsonValue } from "./extension-tab-values.js";
import { clearBuiltInExtensionRemoved, noteBuiltInExtensionRemoved } from "./built-in/state.js";
import { removePersonalRegistryEntry } from "./marketplace/personal.js";
import {
  BUILT_IN_MARKETPLACE_SOURCE_ID,
  PERSONAL_MARKETPLACE_SOURCE_ID,
} from "./marketplace/types.js";
import { SKILLS_DIR_NAME } from "@spiritagent/instructions/skill-paths";
import { SPIRIT_DIR_NAME, USER_RULE_FILE_NAME } from "@spiritagent/instructions/storage";
import {
  createFileExtensionStateStore,
  loadToggleState,
  resolveExtensionPaths,
  saveToggleState,
  SUPPORTED_EXTENSION_HOST_KINDS,
  type ExtensionHostKind,
  type ExtensionSettingValue,
  type ExtensionStateStore,
  type ExtensionManagementContext,
  type ExtensionPaths,
} from "./storage.js";

const TEMP_DIR_PREFIX = "spirit-extension-";
const EXTENSION_FIELD_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const EXTENSION_SECRET_SLOT_KEY_PATTERN = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u;
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
  "automation-triggers",
  "structured-results",
  "desktop-ui",
  "desktop-composer-attachments",
  "desktop-webview-display",
  "desktop-webview-control",
  "desktop-webview-script",
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
  presentation?: {
    displayName: string;
    summary: string;
  };
  inputSchema: HostExtensionJsonSchema;
  outputSchema?: HostExtensionJsonSchema;
  approvalMode?: HostExtensionToolApprovalMode;
  executionMode?: HostExtensionToolExecutionMode;
}

export interface HostExtensionAuthorizationDefinition {
  id: string;
  displayName: string;
  /** Handles initial authorization and subsequent credential management for this contribution. */
  action: string;
  secretSlots: string[];
}

export interface HostExtensionAutomationTriggerDefinition extends AutomationTriggerContributionDefinition {
  icon: HostExtensionDesktopTabIcon;
}

export interface HostExtensionContributionSet {
  tools?: HostExtensionContributedToolDefinition[];
  automationTriggers?: HostExtensionAutomationTriggerDefinition[];
  authorizations?: HostExtensionAuthorizationDefinition[];
  desktop?: HostExtensionDesktopContributionSet;
  cli?: HostExtensionCliContributionSet;
  /** Declared agent MCP contribution; files live at the package-root mcp.json. */
  mcp?: Array<{ name: string; displayName: string; transport: "stdio" | "http" }>;
  /** Declared agent hooks contribution; files live at the package-root hooks.json. */
  hooks?: Array<{ event: string; displayName: string }>;
  /** Declared skills contribution; files live under package-root skills/<name>/SKILL.md. */
  skills?: Array<{ name: string; displayName: string; summary: string }>;
  /** Declared rules contribution; files live at the package-root rule.md. */
  rules?: { displayName: string; summary: string };
}

export interface HostExtensionDesktopCssDefinition {
  path: string;
  media?: string;
}

export interface HostExtensionDesktopSettingsPageDefinition {
  title?: string;
}

export const SUPPORTED_HOST_EXTENSION_DESKTOP_VIEW_CHROMES = [
  "default",
  "close-only",
  "none",
] as const;

export type HostExtensionDesktopViewChrome =
  (typeof SUPPORTED_HOST_EXTENSION_DESKTOP_VIEW_CHROMES)[number];

export interface HostExtensionDesktopViewDefinition {
  id: string;
  path: string;
  title?: string;
  width?: number;
  height?: number;
  chrome?: HostExtensionDesktopViewChrome;
}

export const SUPPORTED_HOST_EXTENSION_DESKTOP_TAB_SCOPES = [
  "window-shared",
  "workspace",
  "session",
] as const;

export type HostExtensionDesktopTabScope =
  (typeof SUPPORTED_HOST_EXTENSION_DESKTOP_TAB_SCOPES)[number];

export type HostExtensionDesktopTabIcon =
  | { type: "spirit"; name: string }
  | { type: "file"; path: string; monochrome?: boolean };

export type HostExtensionDesktopTabRuntimeIcon =
  | HostExtensionDesktopTabIcon
  | { type: "image"; dataUrl: string; monochrome?: boolean };

export interface HostExtensionDesktopLinkHandlerDefinition {
  id: string;
  origins: string[];
  tab: string;
}

export interface HostExtensionDesktopTabDefinition {
  id: string;
  name: string;
  path: string;
  icon: HostExtensionDesktopTabIcon;
  defaultScope?: HostExtensionDesktopTabScope;
  authorization?: string;
}

export interface HostExtensionDesktopContributionSet {
  css?: HostExtensionDesktopCssDefinition[];
  settingsPage?: HostExtensionDesktopSettingsPageDefinition;
  views?: HostExtensionDesktopViewDefinition[];
  tabs?: HostExtensionDesktopTabDefinition[];
  linkHandlers?: HostExtensionDesktopLinkHandlerDefinition[];
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
  locale?: string;
  readRelativeTextFile?: (relativePath: string, fieldName: string) => Promise<string>;
  listRelativeChildDirectories?: (relativePath: string) => Promise<string[]>;
}

type ExtensionLocalizedField = (value: unknown, fieldName: string) => string;

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

export interface HostExtensionAuthor {
  name: string;
  email?: string;
  url?: string;
}

/**
 * Runtime extension manifest, parsed from the installed `.spirit/extension.json`
 * dump (identity + display + declaration + owning source id). The package.json
 * inside an installed extension is pure npm; only its `main` is read here.
 */
export interface HostExtensionManifest {
  schemaVersion: number;
  /** Composite identity: `<sourceId>/<name>`. */
  id: string;
  /** Owning marketplace source id (`built-in`, `personal`, or a user source id). */
  sourceId: string;
  /** Spirit-owned extension name (kebab-case), unique within its source. */
  name: string;
  /** User-visible display name. */
  displayName: string;
  /** Icon path relative to the install directory. */
  icon?: string;
  version: string;
  description?: string;
  author?: HostExtensionAuthor;
  category?: string;
  keywords?: string[];
  homepage?: string;
  main?: string;
  /** Hosts the extension declares it can be installed on (cli / desktop). */
  supportedHosts: ExtensionHostKind[];
  activationEvents?: HostExtensionActivationEventName[];
  requestedCapabilities?: HostExtensionRequestedCapability[];
  contributes?: HostExtensionContributionSet;
  settingsSchema?: HostExtensionSettingDefinition[];
  secretSlots?: string[];
}

export interface HostMarketplaceCatalogItem extends HostInstalledExtension {
  /** False when the bundled template is listed but not copied into the host extensions directory. */
  installed: boolean;
}

export type HostExtensionInstallSource = "built-in" | "archive" | "marketplace";

/** Derive the legacy install-source label from the owning source id. */
export function installSourceForSourceId(sourceId: string): HostExtensionInstallSource {
  if (sourceId === "built-in") {
    return "built-in";
  }
  if (sourceId === "personal") {
    return "archive";
  }
  return "marketplace";
}

/** Composite extension identity: `<sourceId>/<name>`. */
export function composeExtensionId(sourceId: string, name: string): string {
  return `${sourceId}/${name}`;
}

export interface HostExtensionRegistryEntry {
  /** Composite identity: `<sourceId>/<name>`. */
  id: string;
  /** Install path relative to the host extensions directory: `<sourceId>/<name>`. */
  relativePath: string;
  installedAtUnixMs: number;
  archiveFileName?: string;
}

export interface HostInstalledExtension {
  /** Composite identity: `<sourceId>/<name>`. */
  id: string;
  /** Owning marketplace source id. */
  sourceId: string;
  /** Install path relative to the host extensions directory: `<sourceId>/<name>`. */
  relativePath: string;
  manifest: HostExtensionManifest;
  directoryPath: string;
  /** Path of the installed `.spirit/extension.json` dump. */
  manifestPath: string;
  installedAtUnixMs: number;
  /** Enabled unless the per-host toggle state file disables this id; disabled extensions contribute nothing. */
  enabled: boolean;
  archiveFileName?: string;
  installSource: HostExtensionInstallSource;
}

export interface ImportExtensionArchiveRequest {
  archiveBase64: string;
  fileName?: string;
}

export interface InstallPreparedExtensionDirectoryRequest {
  preparedDirectoryPath: string;
  fileName?: string;
  replaceExisting?: boolean;
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
  signal: AbortSignal;
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

export interface HostExtensionPageContext {
  workspaceRoot: string;
  sessionKey: string;
  branch: string;
}

export interface HostExtensionTabRequestContext<THostApi> {
  signal: AbortSignal;
  extension: HostExtensionRuntimeInfo;
  host: THostApi;
  contributionId: string;
  instanceId: string;
  method: string;
  params?: unknown;
  context: HostExtensionPageContext;
  settings: HostExtensionSettingsAccessor;
  secrets: HostExtensionSecretsAccessor;
  log(message: string): void;
}

export interface InvokeExtensionTabRequest<THostApi> {
  signal?: AbortSignal;
  context: HostExtensionPageContext;
  extensionId: string;
  contributionId: string;
  instanceId: string;
  method: string;
  params?: unknown;
  host: THostApi;
  logger?: Pick<Console, "error" | "log">;
}

export interface HostExtensionWebViewEvent {
  extensionId: string;
  contributionId: string;
  instanceId: string;
  state: {
    viewId: string;
    url: string;
    title: string;
    isLoading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    error?: string;
  };
}

export interface DispatchExtensionWebViewEventRequest<THostApi> {
  event: HostExtensionWebViewEvent;
  host: THostApi;
  logger?: Pick<Console, "error" | "log">;
}

export interface HostExtensionActionExecutionContext<THostApi> {
  signal: AbortSignal;
  extension: HostExtensionRuntimeInfo;
  host: THostApi;
  actionId: string;
  params?: unknown;
  log(message: string): void;
  settings: HostExtensionSettingsAccessor;
  secrets: HostExtensionSecretsAccessor;
}

export type HostExtensionActionHandler<THostApi> = (
  context: HostExtensionActionExecutionContext<THostApi>,
) => Promise<unknown> | unknown;

export interface InvokeExtensionActionRequest<THostApi> {
  extensionId: string;
  actionId: string;
  params?: unknown;
  host: THostApi;
  logger?: Pick<Console, "error" | "log">;
}

export interface InvokeExtensionAutomationTriggerRequest<THostApi> {
  locale?: string;
  extensionId: string;
  contributionId: string;
  host: THostApi;
  logger?: Pick<Console, "error" | "log">;
}

export interface ValidateExtensionAutomationTriggerRequest<
  THostApi,
> extends InvokeExtensionAutomationTriggerRequest<THostApi> {
  config: JsonObject;
}

export interface InvokeExtensionAutomationTriggerMenuRequest<
  THostApi,
> extends InvokeExtensionAutomationTriggerRequest<THostApi> {
  path: string[];
  query?: string;
  page: number;
  signal: AbortSignal;
}

export interface InvokeExtensionAutomationTriggerPollRequest<
  THostApi,
> extends InvokeExtensionAutomationTriggerRequest<THostApi> {
  triggers: AutomationTriggerPollTarget[];
  signal: AbortSignal;
}

export interface HostExtensionOpenLinkContext<
  THostApi,
> extends HostExtensionActionExecutionContext<THostApi> {
  url: string;
  sourceTabId?: string;
}

export interface HostActivatedExtension {
  onViewRequest?<THostApi>(
    request: HostExtensionTabRequestContext<THostApi>,
  ): Promise<unknown> | unknown;
  onOpenLink?<THostApi>(
    request: HostExtensionOpenLinkContext<THostApi>,
  ): Promise<boolean> | boolean;
  actions?: Record<string, HostExtensionActionHandler<unknown>>;
  automationTriggers?: Record<string, AutomationTriggerProvider<unknown>>;
  onWebViewEvent?(event: HostExtensionWebViewEvent): Promise<void> | void;
  onTabRequest?<THostApi>(
    request: HostExtensionTabRequestContext<THostApi>,
  ): Promise<unknown> | unknown;
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
  invokeTabRequest<THostApi>(request: InvokeExtensionTabRequest<THostApi>): Promise<unknown>;
  invokeViewRequest<THostApi>(request: InvokeExtensionTabRequest<THostApi>): Promise<unknown>;
  openLink<THostApi>(
    request: InvokeExtensionActionRequest<THostApi> & { url: string; sourceTabId?: string },
  ): Promise<boolean>;
  invokeAction<THostApi>(request: InvokeExtensionActionRequest<THostApi>): Promise<unknown>;
  getAuthorizationConfigurations(id: string): Promise<Record<string, boolean>>;
  validateAutomationTrigger<THostApi>(
    request: ValidateExtensionAutomationTriggerRequest<THostApi>,
  ): Promise<AutomationTriggerValidation>;
  invokeAutomationTriggerMenu<THostApi>(
    request: InvokeExtensionAutomationTriggerMenuRequest<THostApi>,
  ): Promise<AutomationTriggerMenuPage>;
  invokeAutomationTriggerPoll<THostApi>(
    request: InvokeExtensionAutomationTriggerPollRequest<THostApi>,
  ): Promise<AutomationTriggerPollOutput>;
  getSettingsValues(id: string): Promise<HostExtensionSettingsValues>;
  setSettingsValues(request: UpdateExtensionSettingsRequest): Promise<HostExtensionSettingsValues>;
  collectSystemPromptContributions<THostApi>(
    request: CollectExtensionSystemPromptContributionsRequest<THostApi>,
  ): Promise<HostExtensionSystemPromptContribution[]>;
  dispatchEvent<THostApi>(request: DispatchExtensionEventRequest<THostApi>): Promise<void>;
  dispatchWebViewEvent<THostApi>(
    request: DispatchExtensionWebViewEventRequest<THostApi>,
  ): Promise<void>;
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
    async invokeTabRequest(request) {
      return invokeExtensionTabRequest(context, activatedExtensions, stateStore, request);
    },
    async invokeViewRequest(request) {
      return invokeExtensionPageRequest(context, activatedExtensions, stateStore, request, "view");
    },
    async openLink(request) {
      const target = await requireInstalledExtension(context, request.extensionId);
      if (!target.enabled) return false;
      const contribution = target.manifest.contributes?.desktop?.linkHandlers?.find(
        (item) => item.id === request.actionId,
      );
      if (!contribution?.origins.includes(new URL(request.url).origin)) return false;
      const entry = await ensureActivatedExtension(target, activatedExtensions, stateStore, {
        host: request.host,
        log: (message) => request.logger?.log(message),
      });
      const handler = entry.activatedExtension?.onOpenLink;
      if (!handler) throw new Error(`The extension does not export onOpenLink: ${target.id}`);
      return handler({
        signal: entry.lifecycle.signal,
        extension: entry.runtimeInfo,
        host: bindHostForExtension(request.host, target.id),
        actionId: request.actionId,
        url: request.url,
        ...(request.sourceTabId ? { sourceTabId: request.sourceTabId } : {}),
        settings: createSettingsAccessor(target, stateStore),
        secrets: createSecretsAccessor(target, stateStore, entry.lifecycle.signal),
        log: (message) => request.logger?.log(`[extension:${target.id}] ${message}`),
      });
    },
    async invokeAction(request) {
      return invokeExtensionAction(context, activatedExtensions, stateStore, request);
    },
    async getAuthorizationConfigurations(id) {
      return loadExtensionAuthorizationConfigurations(context, stateStore, id);
    },
    async validateAutomationTrigger(request) {
      return validateExtensionAutomationTrigger(context, activatedExtensions, stateStore, request);
    },
    async invokeAutomationTriggerMenu(request) {
      return invokeExtensionAutomationTriggerMenu(
        context,
        activatedExtensions,
        stateStore,
        request,
      );
    },
    async invokeAutomationTriggerPoll(request) {
      return invokeExtensionAutomationTriggerPoll(
        context,
        activatedExtensions,
        stateStore,
        request,
      );
    },
    async getSettingsValues(id) {
      return loadExtensionSettingsValues(context, stateStore, id);
    },
    async setSettingsValues(request) {
      return saveExtensionSettingsValues(context, stateStore, request);
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
    async dispatchWebViewEvent(request) {
      await dispatchExtensionWebViewEvent(context, activatedExtensions, stateStore, request);
    },
    async deactivateAll() {
      await deactivateAllExtensions(activatedExtensions);
    },
  };
}

interface ActivatedExtensionCacheEntry {
  lifecycle: AbortController;
  activation?: Promise<void>;
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
  const installed: HostInstalledExtension[] = [];

  // Install layout: extensions/<host>/<sourceId>/<name>/ — same-name
  // extensions from different sources coexist without overwriting each other.
  const sourceEntries = await readdir(paths.extensionsDir, { withFileTypes: true });
  for (const sourceEntry of sourceEntries) {
    if (!sourceEntry.isDirectory() || sourceEntry.name.startsWith(".")) {
      continue;
    }
    const sourceDir = path.join(paths.extensionsDir, sourceEntry.name);
    const nameEntries = await readdir(sourceDir, { withFileTypes: true }).catch(
      () => [] as Dirent[],
    );
    for (const nameEntry of nameEntries) {
      if (!nameEntry.isDirectory() || nameEntry.name.startsWith(".")) {
        continue;
      }

      const relativePath = `${sourceEntry.name}/${nameEntry.name}`;
      const directoryPath = path.join(sourceDir, nameEntry.name);
      const dumpPath = path.join(directoryPath, SPIRIT_DIR_NAME, EXTENSION_DUMP_FILE_NAME);
      if (!existsSync(dumpPath)) {
        continue;
      }

      try {
        const manifest = await readInstalledExtensionDump(
          dumpPath,
          directoryPath,
          resolveExtensionContextLocale(context.locale),
        );
        const registryEntry = registryEntries.get(manifest.id);
        const installedAtUnixMs =
          registryEntry?.installedAtUnixMs ?? Math.trunc((await stat(directoryPath)).mtimeMs);

        installed.push({
          id: manifest.id,
          sourceId: manifest.sourceId,
          relativePath,
          manifest,
          directoryPath,
          manifestPath: dumpPath,
          installedAtUnixMs,
          enabled: enabledOverrides[manifest.id] ?? true,
          ...(registryEntry?.archiveFileName
            ? { archiveFileName: registryEntry.archiveFileName }
            : {}),
          installSource: installSourceForSourceId(manifest.sourceId),
        });
      } catch {
        continue;
      }
    }
  }

  installed.sort((left, right) => {
    const byName = left.manifest.displayName.localeCompare(
      right.manifest.displayName,
      resolveExtensionContextLocale(context.locale) ?? "en",
    );
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
  // ZIP layout = install directory layout: content plus `.spirit/extension.json`.
  const dumpEntryName = resolveManifestArchivePath(Object.keys(extracted));
  const contentRoot = archiveContentRootForDumpPath(dumpEntryName);
  const dumpRaw = Buffer.from(normalizedExtracted.get(dumpEntryName) ?? []).toString("utf8");
  // Structural validation; the deep declaration parse runs during install.
  parseExtensionDumpText(dumpRaw);

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
  const stagingDirectory = path.join(tempDirectory, "content");

  try {
    await mkdir(stagingDirectory, { recursive: true });

    for (const [entryName, content] of normalizedExtracted) {
      const relativePath = resolveArchiveRelativePath(entryName, contentRoot);
      if (!relativePath) {
        continue;
      }

      const targetFilePath = path.join(stagingDirectory, ...relativePath.split("/"));
      await mkdir(path.dirname(targetFilePath), { recursive: true });
      await writeFile(targetFilePath, Buffer.from(content));
    }

    // ZIP import is a self-declared side channel: route through the Personal
    // registry (index upsert + install from the Personal source).
    // `await` is required: the finally block deletes the staging directory.
    const { importPreparedDirectoryToPersonal } = await import("./marketplace/import-zip.js");
    return await importPreparedDirectoryToPersonal(context, {
      preparedDirectoryPath: stagingDirectory,
      ...(request.fileName?.trim() ? { fileName: request.fileName.trim() } : {}),
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function readPreparedExtensionManifestDirectory(
  preparedDirectoryPath: string,
): Promise<HostExtensionManifest> {
  const dumpPath = path.join(preparedDirectoryPath, SPIRIT_DIR_NAME, EXTENSION_DUMP_FILE_NAME);
  if (!existsSync(dumpPath)) {
    throw new Error(
      `The prepared extension directory is missing ${SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}.`,
    );
  }
  return readInstalledExtensionDump(dumpPath, preparedDirectoryPath);
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
  const relativePath = `${manifest.sourceId}/${manifest.name}`;
  const sourceDirectory = path.join(paths.extensionsDir, manifest.sourceId);
  const targetDirectory = path.join(paths.extensionsDir, relativePath);

  const registryEntries = await loadExtensionRegistry(paths.extensionsIndexFile);
  const replaceExisting = request.replaceExisting === true;
  if (!replaceExisting && (existsSync(targetDirectory) || registryEntries.has(manifest.id))) {
    throw new Error(`The extension already exists; remove it before importing: ${manifest.id}`);
  }
  const previousSecretState =
    replaceExisting &&
    existsSync(path.join(targetDirectory, SPIRIT_DIR_NAME, EXTENSION_DUMP_FILE_NAME))
      ? await readInstalledExtensionSecretState(
          path.join(targetDirectory, SPIRIT_DIR_NAME, EXTENSION_DUMP_FILE_NAME),
        )
      : undefined;

  if (manifest.main) {
    const mainFilePath = path.join(preparedDirectoryPath, ...manifest.main.split("/"));
    if (!existsSync(mainFilePath)) {
      throw new Error(`The extension main file does not exist: ${manifest.main}`);
    }
  }

  if (manifest.icon) {
    const iconFilePath = path.join(preparedDirectoryPath, ...manifest.icon.split("/"));
    if (!existsSync(iconFilePath)) {
      throw new Error(`The extension icon file does not exist: ${manifest.icon}`);
    }
  }

  await mkdir(sourceDirectory, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(sourceDirectory, ".stage-"));
  const stagedDirectory = path.join(stagingRoot, manifest.name);
  const backupDirectory = path.join(
    sourceDirectory,
    `.backup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const hadExistingDirectory = replaceExisting && existsSync(targetDirectory);
  let renamedExisting = false;
  let movedIntoPlace = false;
  let updateApplied = false;

  try {
    await cp(preparedDirectoryPath, stagedDirectory, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });

    if (hadExistingDirectory) {
      await rename(targetDirectory, backupDirectory);
      renamedExisting = true;
    }

    await rename(stagedDirectory, targetDirectory);
    movedIntoPlace = true;

    if (previousSecretState) {
      const removedSlots = previousSecretState.secretSlots.filter(
        (key) => !(manifest.secretSlots ?? []).includes(key),
      );
      // Keep the old package restorable until cleanup finishes so a failed
      // keyring operation can be retried from the old manifest.
      await deleteExtensionSecretSlots(context, previousSecretState.id, removedSlots);
    }
    updateApplied = true;
  } catch (error) {
    if (renamedExisting) {
      if (movedIntoPlace) {
        await rm(targetDirectory, { recursive: true, force: true });
      }
      if (existsSync(backupDirectory)) {
        await rename(backupDirectory, targetDirectory);
        renamedExisting = false;
      }
    } else if (!hadExistingDirectory) {
      await rm(targetDirectory, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
    if (updateApplied && renamedExisting && existsSync(backupDirectory)) {
      await rm(backupDirectory, { recursive: true, force: true });
    }
  }

  const installedAtUnixMs = Date.now();
  const nextRegistryEntries = [
    ...Array.from(registryEntries.values()).filter((entry) => entry.id !== manifest.id),
    {
      id: manifest.id,
      relativePath,
      installedAtUnixMs,
      ...(request.fileName?.trim() ? { archiveFileName: request.fileName.trim() } : {}),
    },
  ];
  await writeExtensionRegistry(paths.extensionsIndexFile, nextRegistryEntries);

  const toggleState = await loadToggleState(paths.extensionsStateFile);
  if (manifest.sourceId === BUILT_IN_MARKETPLACE_SOURCE_ID) {
    await clearBuiltInExtensionRemoved(context.spiritDataDir, manifest.id);
  }
  return {
    id: manifest.id,
    sourceId: manifest.sourceId,
    relativePath,
    manifest,
    directoryPath: targetDirectory,
    manifestPath: path.join(targetDirectory, SPIRIT_DIR_NAME, EXTENSION_DUMP_FILE_NAME),
    installedAtUnixMs,
    enabled: toggleState.enabledOverrides?.[manifest.id] ?? true,
    ...(request.fileName?.trim() ? { archiveFileName: request.fileName.trim() } : {}),
    installSource: installSourceForSourceId(manifest.sourceId),
  };
}

async function readInstalledExtensionSecretState(
  dumpPath: string,
): Promise<{ id: string; secretSlots: string[] }> {
  const parsed: unknown = JSON.parse(await readFile(dumpPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`The installed extension dump must be an object: ${dumpPath}`);
  }
  const sourceId = stringField(parsed.sourceId, "extension.json.sourceId");
  const name = stringField(parsed.name, "extension.json.name");
  return {
    id: composeExtensionId(sourceId, name),
    secretSlots: optionalSecretSlotsField(
      isRecord(parsed.manifest) ? parsed.manifest.secretSlots : undefined,
      "extension.json.manifest.secretSlots",
    ),
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

  await deleteExtensionSecretSlots(context, target.id, target.manifest.secretSlots ?? []);
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

  if (target.sourceId === BUILT_IN_MARKETPLACE_SOURCE_ID) {
    await noteBuiltInExtensionRemoved(context.spiritDataDir, normalizedId);
  }

  // Personal entries are a ZIP-import byproduct whose lifecycle is bound to
  // the install state: uninstalling deletes the registry record along with its
  // content copy. Hosts are isolated — a copy another host installed stays
  // installed there and is managed by that host.
  if (target.sourceId === PERSONAL_MARKETPLACE_SOURCE_ID) {
    await removePersonalRegistryEntry(context.spiritDataDir, target.manifest.name);
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
    host: bindHostForExtension(request.host, target.id),
    toolName: tool.name,
    arguments: request.arguments,
    ...(request.logger ? { logger: request.logger } : {}),
    ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
    ...(request.questionsResult !== undefined ? { questionsResult: request.questionsResult } : {}),
  });
  return renderExtensionToolResult(result);
}

async function requireAutomationTriggerProvider<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: InvokeExtensionAutomationTriggerRequest<THostApi>,
) {
  const target = await requireInstalledExtension(context, request.extensionId);
  if (!target.enabled) {
    throw new Error(`The extension is disabled: ${target.id}`);
  }
  const contribution = target.manifest.contributes?.automationTriggers?.find(
    (entry) => entry.id === request.contributionId,
  );
  if (!contribution) {
    throw new Error(
      `The extension does not declare the Automation trigger: ${request.contributionId}`,
    );
  }
  const entry = await ensureActivatedExtension(target, activatedExtensions, stateStore, {
    host: request.host,
    ...(request.logger ? { logger: request.logger } : {}),
    log: (message) => {
      request.logger?.log(`[extension:${target.id}] ${message}`);
    },
  });
  const provider = entry.activatedExtension?.automationTriggers?.[request.contributionId];
  if (!provider) {
    throw new Error(
      `The extension does not export the Automation trigger provider: ${request.contributionId}`,
    );
  }
  return { target, entry, provider };
}

function automationTriggerBaseContext<THostApi>(
  target: HostInstalledExtension,
  entry: ActivatedExtensionCacheEntry,
  stateStore: ExtensionStateStore,
  request: InvokeExtensionAutomationTriggerRequest<THostApi>,
) {
  return {
    ...(request.locale ? { locale: request.locale } : {}),
    extension: entry.runtimeInfo,
    host: bindHostForExtension(request.host, target.id),
    contributionId: request.contributionId,
    settings: createSettingsAccessor(target, stateStore),
    secrets: createSecretsAccessor(target, stateStore, entry.lifecycle.signal),
  };
}

export async function validateExtensionAutomationTrigger<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: ValidateExtensionAutomationTriggerRequest<THostApi>,
): Promise<AutomationTriggerValidation> {
  assertHostExtensionJsonValue(request.config, "Automation trigger config");
  if (Array.isArray(request.config)) {
    throw new Error("Automation trigger config must be an object.");
  }
  const { target, entry, provider } = await requireAutomationTriggerProvider(
    context,
    activatedExtensions,
    stateStore,
    request,
  );
  const validation = await provider.validate({
    ...automationTriggerBaseContext(target, entry, stateStore, request),
    config: request.config,
  });
  if (!isRecord(validation) || typeof validation.label !== "string" || !validation.label.trim()) {
    throw new Error("Automation trigger validation must return a non-empty label.");
  }
  assertHostExtensionJsonValue(validation.config, "Validated Automation trigger config");
  if (Array.isArray(validation.config)) {
    throw new Error("Validated Automation trigger config must be an object.");
  }
  return { config: validation.config, label: validation.label.trim() };
}

export async function invokeExtensionAutomationTriggerMenu<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: InvokeExtensionAutomationTriggerMenuRequest<THostApi>,
): Promise<AutomationTriggerMenuPage> {
  if (!Number.isInteger(request.page) || request.page < 1) {
    throw new Error("Automation trigger menu page must be a positive integer.");
  }
  if (request.path.some((entry) => !entry.trim())) {
    throw new Error("Automation trigger menu path ids must not be empty.");
  }
  const { target, entry, provider } = await requireAutomationTriggerProvider(
    context,
    activatedExtensions,
    stateStore,
    request,
  );
  if (!provider.menu) {
    throw new Error(`The Automation trigger does not provide a menu: ${request.contributionId}`);
  }
  const page = await provider.menu({
    ...automationTriggerBaseContext(target, entry, stateStore, request),
    path: request.path,
    ...(request.query === undefined ? {} : { query: request.query }),
    page: request.page,
    signal: request.signal,
  });
  if (!isRecord(page) || !Array.isArray(page.items)) {
    throw new Error("Automation trigger menu must return an items array.");
  }
  return page;
}

export async function invokeExtensionAutomationTriggerPoll<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: InvokeExtensionAutomationTriggerPollRequest<THostApi>,
): Promise<AutomationTriggerPollOutput> {
  for (const trigger of request.triggers) {
    if (!trigger.automationId.trim()) {
      throw new Error("Automation trigger poll targets require an automation id.");
    }
    assertHostExtensionJsonValue(trigger.config, "Automation trigger poll config");
    if (trigger.state !== undefined) {
      assertHostExtensionJsonValue(trigger.state, "Automation trigger poll state");
    }
  }
  const { target, entry, provider } = await requireAutomationTriggerProvider(
    context,
    activatedExtensions,
    stateStore,
    request,
  );
  const output = await provider.poll({
    ...automationTriggerBaseContext(target, entry, stateStore, request),
    triggers: request.triggers,
    signal: request.signal,
  });
  if (!isRecord(output) || !Array.isArray(output.results)) {
    throw new Error("Automation trigger poll must return a results array.");
  }
  return output;
}

export async function invokeExtensionAction<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: InvokeExtensionActionRequest<THostApi>,
): Promise<unknown> {
  const target = await requireInstalledExtension(context, request.extensionId);
  if (!target.enabled) {
    throw new Error(`The extension is disabled: ${target.id}`);
  }
  const actionId = request.actionId.trim();
  if (!target.manifest.contributes?.authorizations?.some((entry) => entry.action === actionId)) {
    throw new Error(`The extension does not declare the action: ${actionId}`);
  }
  const entry = await ensureActivatedExtension(target, activatedExtensions, stateStore, {
    host: request.host,
    ...(request.logger ? { logger: request.logger } : {}),
    log: (message) => {
      request.logger?.log(`[extension:${target.id}] ${message}`);
    },
  });
  const handler = entry.activatedExtension?.actions?.[actionId];
  if (!handler) {
    throw new Error(`The extension does not export the action: ${actionId}`);
  }
  return handler({
    signal: entry.lifecycle.signal,
    extension: entry.runtimeInfo,
    host: bindHostForExtension(request.host, target.id),
    actionId,
    ...(request.params === undefined ? {} : { params: request.params }),
    log: (message) => {
      request.logger?.log(`[extension:${target.id}] ${message}`);
    },
    settings: createSettingsAccessor(target, stateStore),
    secrets: createSecretsAccessor(target, stateStore, entry.lifecycle.signal),
  });
}

export async function invokeExtensionTabRequest<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: InvokeExtensionTabRequest<THostApi>,
): Promise<unknown> {
  return invokeExtensionPageRequest(context, activatedExtensions, stateStore, request, "tab");
}

async function invokeExtensionPageRequest<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: InvokeExtensionTabRequest<THostApi>,
  kind: "tab" | "view",
): Promise<unknown> {
  const target = await requireInstalledExtension(context, request.extensionId);
  if (!target.enabled) {
    throw new Error(`The extension is disabled: ${target.id}`);
  }
  const contribution = (
    kind === "tab"
      ? target.manifest.contributes?.desktop?.tabs
      : target.manifest.contributes?.desktop?.views
  )?.find((entry) => entry.id === request.contributionId);
  if (!contribution) {
    throw new Error(`The extension does not declare the ${kind}: ${request.contributionId}`);
  }
  const entry = await ensureActivatedExtension(target, activatedExtensions, stateStore, {
    host: request.host,
    ...(request.logger ? { logger: request.logger } : {}),
    log: (message) => {
      request.logger?.log(`[extension:${target.id}] ${message}`);
    },
  });
  const handler =
    kind === "tab"
      ? entry.activatedExtension?.onTabRequest
      : entry.activatedExtension?.onViewRequest;
  if (!handler) {
    throw new Error(`The extension does not export a ${kind} request handler: ${target.id}`);
  }
  const signal = request.signal
    ? AbortSignal.any([request.signal, entry.lifecycle.signal])
    : entry.lifecycle.signal;
  signal.throwIfAborted();
  return handler({
    signal,
    extension: entry.runtimeInfo,
    host: bindHostForExtension(request.host, target.id),
    contributionId: request.contributionId,
    instanceId: request.instanceId,
    method: request.method,
    context: request.context,
    settings: createSettingsAccessor(target, stateStore),
    secrets: createSecretsAccessor(target, stateStore, signal),
    log: (message) => request.logger?.log(`[extension:${target.id}] ${message}`),
    ...(request.params === undefined ? {} : { params: request.params }),
  });
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

export async function loadExtensionAuthorizationConfigurations(
  context: ExtensionManagementContext,
  stateStore: ExtensionStateStore,
  id: string,
): Promise<Record<string, boolean>> {
  const extension = await requireInstalledExtension(context, id);
  const result: Record<string, boolean> = {};
  for (const authorization of extension.manifest.contributes?.authorizations ?? []) {
    const configured = await Promise.all(
      authorization.secretSlots.map((key) => hasExtensionSecret(stateStore, extension.id, key)),
    );
    result[authorization.id] = configured.every(Boolean);
  }
  return result;
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
        `Extension event execution failed: ${extension.manifest.displayName} (${error instanceof Error ? error.message : String(error)})`,
        { cause: error },
      );
    }
  }
}

export async function dispatchExtensionWebViewEvent<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: DispatchExtensionWebViewEventRequest<THostApi>,
): Promise<void> {
  const target = await requireInstalledExtension(context, request.event.extensionId);
  if (!target.enabled) {
    throw new Error(`The extension is disabled: ${target.id}`);
  }
  const entry = await ensureActivatedExtension(target, activatedExtensions, stateStore, {
    host: request.host,
    ...(request.logger ? { logger: request.logger } : {}),
    log: (message) => {
      request.logger?.log(`[extension:${target.id}] ${message}`);
    },
  });
  await entry.activatedExtension?.onWebViewEvent?.(request.event);
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
        extensionName: extension.manifest.displayName,
        content,
      });
    } catch (error) {
      request.logger?.error(`[extension:${extension.id}] collect system prompt failed`, error);
    }
  }

  return contributions;
}

type BindableExtensionHost = {
  boundExtensionId?: string;
  forExtension?: (extensionId: string) => unknown;
};

function bindHostForExtension<THostApi>(host: THostApi, extensionId: string): THostApi {
  const candidate = host as BindableExtensionHost;
  if (candidate.boundExtensionId === extensionId || typeof candidate.forExtension !== "function") {
    return host;
  }
  return candidate.forExtension(extensionId) as THostApi;
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
    await cached.activation;
    cached.lifecycle.signal.throwIfAborted();
    return cached;
  }
  if (cached) {
    cached.lifecycle.abort();
    await cached.dispose?.();
    activatedExtensions.delete(target.id);
  }
  const mainEntry = target.manifest.main;
  if (!mainEntry)
    throw new Error(`The extension does not declare main and cannot execute: ${target.id}`);
  const mainFilePath = path.join(target.directoryPath, ...mainEntry.split("/"));
  if (!existsSync(mainFilePath))
    throw new Error(`The extension main file does not exist: ${mainEntry}`);
  const entry: ActivatedExtensionCacheEntry = {
    id: target.id,
    installedAtUnixMs: target.installedAtUnixMs,
    activationEvents: target.manifest.activationEvents ?? [],
    runtimeInfo: createRuntimeInfo(target),
    lifecycle: new AbortController(),
  };
  // Publish the lifetime before awaiting module activation so disable/remove can cancel it.
  activatedExtensions.set(target.id, entry);
  entry.activation = (async () => {
    const activated = await activateExtension(target, mainFilePath, {
      host: bindHostForExtension(options.host, target.id),
      ...(options.logger ? { logger: options.logger } : {}),
      log: options.log,
      signal: entry.lifecycle.signal,
      settings: createSettingsAccessor(target, stateStore),
      secrets: createSecretsAccessor(target, stateStore, entry.lifecycle.signal),
      ...(options.activationEvent ? { activationEvent: options.activationEvent } : {}),
    });
    if (entry.lifecycle.signal.aborted) {
      await activated?.dispose?.();
      entry.lifecycle.signal.throwIfAborted();
    }
    if (activated) entry.activatedExtension = activated;
    if (activated?.onEvent) entry.onEvent = activated.onEvent;
    if (activated?.dispose) entry.dispose = activated.dispose;
  })();
  try {
    await entry.activation;
    return entry;
  } catch (error) {
    entry.lifecycle.abort();
    if (activatedExtensions.get(target.id) === entry) activatedExtensions.delete(target.id);
    throw error;
  }
}

function createRuntimeInfo(target: HostInstalledExtension): HostExtensionRuntimeInfo {
  return {
    id: target.id,
    name: target.manifest.displayName,
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
  signal?: AbortSignal,
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
      signal?.throwIfAborted();
      assertSecretSlot(extension.manifest, key);
      if (value.length === 0) {
        throw new Error(`Extension secret values must not be empty: ${key}`);
      }
      if (!stateStore.saveSecret) {
        throw new Error(
          `The current host does not implement extension secret storage: ${extension.id}`,
        );
      }
      await stateStore.saveSecret(extension.id, key, value);
    },
    async delete(key) {
      signal?.throwIfAborted();
      assertSecretSlot(extension.manifest, key);
      await stateStore.deleteSecret?.(extension.id, key);
    },
  };
}

async function deleteExtensionSecretSlots(
  context: ExtensionManagementContext,
  extensionId: string,
  keys: readonly string[],
): Promise<void> {
  const stateStore = context.stateStore ?? createFileExtensionStateStore(context);
  if (!stateStore.deleteSecret) {
    return;
  }
  for (const key of new Set(keys)) {
    await stateStore.deleteSecret(extensionId, key);
  }
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
  if (!manifest.secretSlots?.includes(key)) {
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
        extensionName: extension.manifest.displayName,
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
    entry.lifecycle.abort();
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

  entry.lifecycle.abort();
  await entry.dispose?.();
  activatedExtensions.delete(normalizedId);
}

async function ensureExtensionDirectories(paths: ExtensionPaths): Promise<void> {
  await mkdir(paths.extensionsDir, { recursive: true });
  await mkdir(paths.extensionStateDir, { recursive: true });
  await mkdir(path.dirname(paths.extensionsIndexFile), { recursive: true });
}

async function readInstalledExtensionDump(
  dumpPath: string,
  directoryPath: string,
  locale?: string,
): Promise<HostExtensionManifest> {
  const raw = await readFile(dumpPath, "utf8");
  const dump = parseExtensionDumpText(raw);
  return buildHostExtensionManifestFromDump(dump, directoryPath, { locale });
}

/**
 * Deep-parse a validated extension dump into a runtime manifest, resolving
 * declared contribution files and the pure-npm package.json `main` under
 * `directoryPath` (the install dir, or a registry content dir for catalog
 * display of not-yet-installed entries).
 */
export async function buildHostExtensionManifestFromDump(
  dump: MarketplaceExtensionDump,
  directoryPath?: string,
  options: { locale?: string | undefined } = {},
): Promise<HostExtensionManifest> {
  const manifest = await parseExtensionManifestFields(
    dump,
    options.locale,
    directoryPath
      ? {
          readRelativeTextFile: async (relativePath, fieldName) => {
            const targetPath = path.join(
              directoryPath,
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
              directoryPath,
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
        }
      : {},
  );

  // package.json is pure npm; only its `main` module entry is read here.
  const main = directoryPath
    ? await readPackageJsonMain(path.join(directoryPath, "package.json"))
    : undefined;
  return main ? { ...manifest, main } : manifest;
}

async function readPackageJsonMain(packageJsonPath: string): Promise<string | undefined> {
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (!isRecord(parsed)) {
    return undefined;
  }
  const main = parsed.main;
  if (typeof main !== "string" || !main.trim()) {
    return undefined;
  }
  const trimmed = main.trim();
  assertSafeRelativePath(trimmed, "main");
  return trimmed;
}

/** Deep-parse the declaration fields of a validated extension dump. */
async function parseExtensionManifestFields(
  dump: MarketplaceExtensionDump,
  locale: string | undefined,
  options: HostExtensionManifestParseOptions = {},
): Promise<HostExtensionManifest> {
  const text = (value: unknown, fieldName: string): string =>
    localizeExtensionText(dump, parseLocalizableText(value, fieldName), locale);
  const activationEvents = optionalActivationEventsField(
    dump.manifest.activationEvents,
    "manifest.activationEvents",
  );
  const requestedCapabilities = optionalRequestedCapabilitiesField(
    dump.manifest.requestedCapabilities,
    "manifest.requestedCapabilities",
  );
  const contributes = await optionalContributionSetField(
    dump.manifest.contributes,
    options,
    "manifest.contributes",
    text,
  );
  const settingsSchema = optionalSettingsSchemaField(
    dump.manifest.settingsSchema,
    "manifest.settingsSchema",
    text,
  );
  const secretSlots = optionalSecretSlotsField(dump.manifest.secretSlots, "manifest.secretSlots");
  const supportedHosts = requiredSupportedHostsField(
    dump.manifest.supportedHosts,
    "manifest.supportedHosts",
  );
  if (
    (contributes?.authorizations?.length ?? 0) > 0 &&
    !requestedCapabilities.includes("secret-storage")
  ) {
    throw new Error("Authorization contributions require the secret-storage capability.");
  }
  if (
    (contributes?.automationTriggers?.length ?? 0) > 0 &&
    !requestedCapabilities.includes("automation-triggers")
  ) {
    throw new Error("Automation trigger contributions require the automation-triggers capability.");
  }
  for (const authorization of contributes?.authorizations ?? []) {
    for (const key of authorization.secretSlots) {
      if (!secretSlots.includes(key)) {
        throw new Error(
          `Authorization ${authorization.id} references an undeclared secret slot: ${key}`,
        );
      }
    }
  }

  for (const tab of contributes?.desktop?.tabs ?? []) {
    if (
      tab.authorization &&
      !contributes?.authorizations?.some((item) => item.id === tab.authorization)
    )
      throw new Error(`Tab ${tab.id} references an undeclared authorization.`);
  }
  for (const trigger of contributes?.automationTriggers ?? []) {
    if (
      trigger.authorization &&
      !contributes?.authorizations?.some((entry) => entry.id === trigger.authorization)
    ) {
      throw new Error(
        `Automation trigger ${trigger.id} references an unknown authorization: ${trigger.authorization}`,
      );
    }
  }

  // The declared-file check runs whenever the caller can read package files
  // (install, ZIP import, local catalog display); remote catalog entries
  // without local files are display-only and skip it.
  if (options.readRelativeTextFile) {
    await assertDeclaredInstructionContributionFiles(contributes, options, secretSlots);
  }

  return {
    schemaVersion: dump.schemaVersion,
    id: composeExtensionId(dump.sourceId, dump.name),
    sourceId: dump.sourceId,
    name: dump.name,
    displayName: text(dump.displayName, "extension.json.displayName"),
    ...(dump.icon ? { icon: dump.icon } : {}),
    version: dump.version,
    description: text(dump.description, "extension.json.description"),
    ...(dump.author ? { author: dump.author } : {}),
    ...(dump.category ? { category: dump.category } : {}),
    ...(dump.keywords?.length
      ? {
          keywords: dump.keywords.map((entry, index) =>
            text(entry, `extension.json.keywords[${index}]`),
          ),
        }
      : {}),
    ...(dump.homepage ? { homepage: dump.homepage } : {}),
    supportedHosts,
    ...(activationEvents.length > 0 ? { activationEvents } : {}),
    ...(requestedCapabilities.length > 0 ? { requestedCapabilities } : {}),
    ...(contributes ? { contributes } : {}),
    ...(settingsSchema.length > 0 ? { settingsSchema } : {}),
    ...(secretSlots.length > 0 ? { secretSlots } : {}),
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
        .filter((entry) => typeof entry?.id === "string" && typeof entry?.relativePath === "string")
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
    "id" | "relativePath" | "installedAtUnixMs" | "archiveFileName"
  >,
): HostExtensionRegistryEntry {
  return {
    id: item.id,
    relativePath: item.relativePath,
    installedAtUnixMs: item.installedAtUnixMs,
    ...(item.archiveFileName ? { archiveFileName: item.archiveFileName } : {}),
  };
}

function resolveManifestArchivePath(entryNames: readonly string[]): string {
  const dumpSuffix = `${SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}`;
  const candidates = entryNames.filter((entryName) => {
    const normalized = normalizeArchivePath(entryName);
    return normalized.endsWith(`/${dumpSuffix}`) || normalized === dumpSuffix;
  });

  if (candidates.length === 0) {
    throw new Error(`The extension ZIP is missing ${SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}.`);
  }

  if (candidates.length > 1) {
    throw new Error(
      `The extension ZIP contains multiple ${SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}.`,
    );
  }

  const dumpPath = candidates[0];
  if (!dumpPath) {
    throw new Error(`The extension ZIP is missing ${SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}.`);
  }

  return normalizeArchivePath(dumpPath);
}

/**
 * Content root of a ZIP dump entry: the dump lives at
 * `<contentRoot>/.spirit/extension.json`, so the root is two levels up.
 */
function archiveContentRootForDumpPath(dumpEntryName: string): string {
  const normalized = normalizeArchivePath(dumpEntryName);
  const suffix = `${SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}`;
  if (normalized === suffix) {
    return "";
  }
  return normalized.slice(0, normalized.length - suffix.length - 1);
}

function resolveArchiveRelativePath(entryName: string, contentRoot: string): string | undefined {
  const normalizedEntryName = normalizeArchivePath(entryName);
  if (contentRoot && !normalizedEntryName.startsWith(`${contentRoot}/`)) {
    return undefined;
  }

  const relativePath = contentRoot
    ? normalizedEntryName.slice(contentRoot.length + 1)
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

async function activateExtension<THostApi>(
  target: HostInstalledExtension,
  mainFilePath: string,
  options: {
    host: THostApi;
    signal: AbortSignal;
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
      `Extension ${target.manifest.displayName} does not export activate; export activate(context) or a default export of that function.`,
    );
  }

  try {
    const activationResult = await activate({
      extension: {
        id: target.id,
        name: target.manifest.displayName,
        version: target.manifest.version,
        directoryPath: target.directoryPath,
        manifestPath: target.manifestPath,
        main: target.manifest.main ?? "",
      },
      host: options.host,
      signal: options.signal,
      log: options.log,
      settings: options.settings,
      secrets: options.secrets,
      ...(options.activationEvent ? { activationEvent: options.activationEvent } : {}),
    });

    return resolveActivatedExtension(activationResult) ?? resolveActivatedExtension(loadedModule);
  } catch (error) {
    options.logger?.error(`[extension:${target.id}] activate failed`, error);
    throw new Error(
      `Failed to execute extension: ${target.manifest.displayName} (${error instanceof Error ? error.message : String(error)})`,
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
      `Failed to load extension: ${target.manifest.displayName} (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

function resolveActivatedExtension(value: unknown): HostActivatedExtension | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const actions = resolveActivatedExtensionActions(value.actions);
  const automationTriggers = resolveActivatedAutomationTriggers(value.automationTriggers);
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
  const onViewRequest = typeof value.onViewRequest === "function" ? value.onViewRequest : undefined;
  const onOpenLink = typeof value.onOpenLink === "function" ? value.onOpenLink : undefined;
  const onTabRequest = typeof value.onTabRequest === "function" ? value.onTabRequest : undefined;
  const onWebViewEvent =
    typeof value.onWebViewEvent === "function" ? value.onWebViewEvent : undefined;
  const dispose = typeof value.dispose === "function" ? value.dispose : undefined;
  if (
    !actions &&
    !automationTriggers &&
    !tools &&
    !invokeTool &&
    !systemPrompt &&
    !getSystemPrompt &&
    !onEvent &&
    !onTabRequest &&
    !onViewRequest &&
    !onOpenLink &&
    !onWebViewEvent &&
    !dispose
  ) {
    return undefined;
  }

  return Object.assign(
    {},
    actions ? { actions } : {},
    automationTriggers ? { automationTriggers } : {},
    tools ? { tools } : {},
    invokeTool ? { invokeTool } : {},
    systemPrompt ? { systemPrompt } : {},
    getSystemPrompt ? { getSystemPrompt } : {},
    onEvent ? { onEvent: onEvent as HostActivatedExtension["onEvent"] } : {},
    onViewRequest
      ? { onViewRequest: onViewRequest as HostActivatedExtension["onViewRequest"] }
      : {},
    onOpenLink ? { onOpenLink: onOpenLink as HostActivatedExtension["onOpenLink"] } : {},
    onTabRequest ? { onTabRequest: onTabRequest as HostActivatedExtension["onTabRequest"] } : {},
    onWebViewEvent
      ? { onWebViewEvent: onWebViewEvent as HostActivatedExtension["onWebViewEvent"] }
      : {},
    dispose ? { dispose: dispose as HostActivatedExtension["dispose"] } : {},
  ) as HostActivatedExtension;
}

function resolveActivatedAutomationTriggers(
  value: unknown,
): HostActivatedExtension["automationTriggers"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(([, provider]) => {
    if (!isRecord(provider)) {
      return false;
    }
    return typeof provider.validate === "function" && typeof provider.poll === "function";
  });
  return entries.length > 0
    ? (Object.fromEntries(entries) as HostActivatedExtension["automationTriggers"])
    : undefined;
}

function resolveActivatedExtensionActions(
  value: unknown,
): HostActivatedExtension["actions"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(([, handler]) => typeof handler === "function");
  return entries.length > 0
    ? (Object.fromEntries(entries) as HostActivatedExtension["actions"])
    : undefined;
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
  text: ExtensionLocalizedField,
): Promise<HostExtensionContributionSet | undefined> {
  if (!isRecord(value)) {
    return undefined;
  }

  const tools = optionalContributedToolsField(value.tools, `${fieldPrefix}.tools`, text);
  const authorizations = optionalAuthorizationsField(
    value.authorizations,
    `${fieldPrefix}.authorizations`,
    text,
  );
  const automationTriggers = optionalAutomationTriggersField(
    value.automationTriggers,
    `${fieldPrefix}.automationTriggers`,
    text,
  );
  const desktop = optionalDesktopContributionSetField(
    value.desktop,
    `${fieldPrefix}.desktop`,
    text,
  );
  const cli = await optionalCliContributionSetField(value.cli, options, `${fieldPrefix}.cli`);
  const mcp = optionalMcpPresentationField(value.mcp, `${fieldPrefix}.mcp`, text);
  const hooks = optionalHookPresentationField(value.hooks, `${fieldPrefix}.hooks`, text);
  const skills = optionalSkillPresentationField(value.skills, `${fieldPrefix}.skills`, text);
  const rules = optionalRulePresentationField(value.rules, `${fieldPrefix}.rules`, text);
  if (
    tools.length === 0 &&
    authorizations.length === 0 &&
    automationTriggers.length === 0 &&
    !desktop &&
    !cli &&
    mcp.length === 0 &&
    hooks.length === 0 &&
    skills.length === 0 &&
    !rules
  ) {
    return undefined;
  }

  return {
    ...(tools.length > 0 ? { tools } : {}),
    ...(authorizations.length > 0 ? { authorizations } : {}),
    ...(automationTriggers.length > 0 ? { automationTriggers } : {}),
    ...(desktop ? { desktop } : {}),
    ...(cli ? { cli } : {}),
    ...(mcp.length > 0 ? { mcp } : {}),
    ...(hooks.length > 0 ? { hooks } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(rules ? { rules } : {}),
  };
}

function optionalAutomationTriggersField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionAutomationTriggerDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const triggers = value.map((entry, index) => {
    const field = `${fieldPrefix}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`Extension field ${field} must be an object.`);
    }
    const id = stringField(entry.id, `${field}.id`);
    if (!EXTENSION_FIELD_KEY_PATTERN.test(id)) {
      throw new Error(`Extension field ${field}.id is invalid.`);
    }
    const configuration = entry.configuration;
    if (configuration !== undefined && configuration !== "menu") {
      throw new Error(`Extension field ${field}.configuration must be "menu" when present.`);
    }
    const inputSchema = schemaField(entry.inputSchema, `${field}.inputSchema`) as JsonObject;
    if (inputSchema.type !== "object") {
      throw new Error(`Extension field ${field}.inputSchema.type must be "object".`);
    }
    assertNoSchemaReferences(inputSchema, `${field}.inputSchema`);
    return {
      id,
      name: text(entry.name, `${field}.name`),
      description: text(entry.description, `${field}.description`),
      icon: parseDesktopTabIcon(entry.icon, `${field}.icon`),
      ...(configuration === "menu" ? { configuration: "menu" as const } : {}),
      inputSchema,
      ...(entry.authorization === undefined
        ? {}
        : { authorization: stringField(entry.authorization, `${field}.authorization`) }),
    };
  });
  if (new Set(triggers.map((entry) => entry.id)).size !== triggers.length) {
    throw new Error(`Extension field ${fieldPrefix} must not contain duplicate ids.`);
  }
  return triggers;
}

function assertNoSchemaReferences(value: unknown, fieldName: string): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoSchemaReferences(entry, `${fieldName}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref") {
      throw new Error(`Extension field ${fieldName} must be self-contained and cannot use $ref.`);
    }
    assertNoSchemaReferences(entry, `${fieldName}.${key}`);
  }
}

function optionalAuthorizationsField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionAuthorizationDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const authorizations = value.map((entry, index) => {
    const field = `${fieldPrefix}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`Extension field ${field} must be an object.`);
    }
    const id = stringField(entry.id, `${field}.id`);
    const action = stringField(entry.action, `${field}.action`);
    if (!EXTENSION_FIELD_KEY_PATTERN.test(id) || !EXTENSION_FIELD_KEY_PATTERN.test(action)) {
      throw new Error(`Extension field ${field} has an invalid id or action.`);
    }
    const secretSlots = optionalSecretSlotsField(entry.secretSlots, `${field}.secretSlots`);
    if (secretSlots.length === 0) {
      throw new Error(`Extension field ${field}.secretSlots must not be empty.`);
    }
    return {
      id,
      displayName: text(entry.displayName, `${field}.displayName`),
      action,
      secretSlots,
    };
  });
  if (new Set(authorizations.map((entry) => entry.id)).size !== authorizations.length) {
    throw new Error(`Extension field ${fieldPrefix} must not contain duplicate ids.`);
  }
  return authorizations;
}

function optionalMcpPresentationField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): NonNullable<HostExtensionContributionSet["mcp"]> {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const field = `${fieldPrefix}[${index}]`;
    if (!isRecord(entry)) throw new Error(`Extension field ${field} must be an object.`);
    const transport = enumField(entry.transport, `${field}.transport`, ["stdio", "http"] as const);
    return {
      name: stringField(entry.name, `${field}.name`),
      displayName: text(entry.displayName, `${field}.displayName`),
      transport,
    };
  });
}

function optionalHookPresentationField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): NonNullable<HostExtensionContributionSet["hooks"]> {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const field = `${fieldPrefix}[${index}]`;
    if (!isRecord(entry)) throw new Error(`Extension field ${field} must be an object.`);
    return {
      event: stringField(entry.event, `${field}.event`),
      displayName: text(entry.displayName, `${field}.displayName`),
    };
  });
}

function optionalSkillPresentationField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): NonNullable<HostExtensionContributionSet["skills"]> {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const field = `${fieldPrefix}[${index}]`;
    if (!isRecord(entry)) throw new Error(`Extension field ${field} must be an object.`);
    return {
      name: stringField(entry.name, `${field}.name`),
      displayName: text(entry.displayName, `${field}.displayName`),
      summary: text(entry.summary, `${field}.summary`),
    };
  });
}

function optionalRulePresentationField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionContributionSet["rules"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Extension field ${fieldPrefix} must be an object.`);
  return {
    displayName: text(value.displayName, `${fieldPrefix}.displayName`),
    summary: text(value.summary, `${fieldPrefix}.summary`),
  };
}

function optionalContributedToolsField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionContributedToolDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) =>
    parseContributedToolDefinition(entry, index, fieldPrefix, text),
  );
}

function optionalDesktopContributionSetField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionDesktopContributionSet | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const css = optionalDesktopCssDefinitionsField(value.css, `${fieldPrefix}.css`);
  const settingsPage = optionalDesktopSettingsPageDefinitionField(
    value.settingsPage,
    `${fieldPrefix}.settingsPage`,
    text,
  );
  const views = optionalDesktopViewDefinitionsField(value.views, `${fieldPrefix}.views`, text);
  const tabs = optionalDesktopTabDefinitionsField(value.tabs, `${fieldPrefix}.tabs`, text);
  const linkHandlers: HostExtensionDesktopLinkHandlerDefinition[] = Array.isArray(
    value.linkHandlers,
  )
    ? value.linkHandlers.map((entry, index) => {
        if (!isRecord(entry)) throw new Error("Invalid Desktop link handler.");
        const id = stringField(entry.id, `${fieldPrefix}.linkHandlers[${index}].id`);
        const tab = stringField(entry.tab, `${fieldPrefix}.linkHandlers[${index}].tab`);
        if (!EXTENSION_FIELD_KEY_PATTERN.test(id) || !tabs.some((item) => item.id === tab))
          throw new Error("Link handlers require a valid id and declared tab.");
        if (!Array.isArray(entry.origins) || entry.origins.length === 0)
          throw new Error("Link handlers require URL origins.");
        const origins = entry.origins.map((value) => {
          if (typeof value !== "string") throw new Error("Invalid link origin.");
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol) || url.origin !== value)
            throw new Error("Link origins must be exact HTTP(S) origins.");
          return value;
        });
        return { id, tab, origins };
      })
    : [];
  if (new Set(linkHandlers.map((item) => item.id)).size !== linkHandlers.length)
    throw new Error("Duplicate link handler id.");
  if (
    css.length === 0 &&
    !settingsPage &&
    views.length === 0 &&
    tabs.length === 0 &&
    linkHandlers.length === 0
  ) {
    return undefined;
  }

  return {
    ...(css.length > 0 ? { css } : {}),
    ...(settingsPage ? { settingsPage } : {}),
    ...(views.length > 0 ? { views } : {}),
    ...(tabs.length > 0 ? { tabs } : {}),
    ...(linkHandlers.length > 0 ? { linkHandlers } : {}),
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

function optionalDesktopViewDefinitionsField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionDesktopViewDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const views = value.map((entry, index) =>
    parseDesktopViewDefinition(entry, index, fieldPrefix, text),
  );
  const seen = new Set<string>();
  for (const view of views) {
    if (seen.has(view.id)) {
      throw new Error(`Extension field ${fieldPrefix} has a duplicate view id: ${view.id}`);
    }
    seen.add(view.id);
  }
  return views;
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

function optionalDesktopTabDefinitionsField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionDesktopTabDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tabs = value.map((entry, index) =>
    parseDesktopTabDefinition(entry, index, fieldPrefix, text),
  );
  const seen = new Set<string>();
  for (const tab of tabs) {
    if (seen.has(tab.id)) {
      throw new Error(`Extension field ${fieldPrefix} has a duplicate tab id: ${tab.id}`);
    }
    seen.add(tab.id);
  }
  return tabs;
}

function parseDesktopTabDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionDesktopTabDefinition {
  if (!isRecord(value)) {
    throw new Error(`Extension field ${fieldPrefix}[${index}] must be an object.`);
  }

  const id = stringField(value.id, `${fieldPrefix}[${index}].id`);
  if (!EXTENSION_FIELD_KEY_PATTERN.test(id)) {
    throw new Error(`Invalid extension tab id: ${id}`);
  }
  const name = text(value.name, `${fieldPrefix}[${index}].name`);
  const authorization = optionalStringField(value.authorization);
  const tabPath = stringField(value.path, `${fieldPrefix}[${index}].path`);
  assertSafeRelativePath(tabPath, `${fieldPrefix}[${index}].path`);
  if (!tabPath.toLowerCase().endsWith(".html")) {
    throw new Error(`Extension field ${fieldPrefix}[${index}].path must be an HTML page.`);
  }
  const icon = parseDesktopTabIcon(value.icon, `${fieldPrefix}[${index}].icon`);
  const defaultScope = optionalEnumField(
    value.defaultScope,
    `${fieldPrefix}[${index}].defaultScope`,
    SUPPORTED_HOST_EXTENSION_DESKTOP_TAB_SCOPES,
  );

  return {
    id,
    name,
    path: tabPath,
    icon,
    ...(defaultScope ? { defaultScope } : {}),
    ...(authorization ? { authorization } : {}),
  };
}

function parseDesktopTabIcon(value: unknown, fieldPrefix: string): HostExtensionDesktopTabIcon {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error(`Extension field ${fieldPrefix} must be an icon descriptor.`);
  }
  if (value.type === "spirit") {
    const name = stringField(value.name, `${fieldPrefix}.name`);
    if (!isSpiritIconName(name)) {
      throw new Error(`Unknown Spirit Icon name: ${name}`);
    }
    return { type: "spirit", name };
  }
  if (value.type === "file") {
    if (value.monochrome !== undefined && typeof value.monochrome !== "boolean")
      throw new Error("Icon monochrome must be a boolean.");
    const iconPath = stringField(value.path, `${fieldPrefix}.path`);
    assertSafeRelativePath(iconPath, `${fieldPrefix}.path`);
    if (!/\.(?:svg|png|jpe?g|webp)$/iu.test(iconPath)) {
      throw new Error(
        `Extension field ${fieldPrefix}.path must reference an SVG, PNG, JPEG, or WebP icon.`,
      );
    }
    return {
      type: "file",
      path: iconPath,
      ...(value.monochrome === true ? { monochrome: true } : {}),
    };
  }
  throw new Error(`Extension field ${fieldPrefix}.type must be "spirit" or "file".`);
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

function parseDesktopViewDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionDesktopViewDefinition {
  if (!isRecord(value)) {
    throw new Error(`Extension field ${fieldPrefix}[${index}] must be an object.`);
  }

  const id = stringField(value.id, `${fieldPrefix}[${index}].id`);
  if (!EXTENSION_FIELD_KEY_PATTERN.test(id)) {
    throw new Error(`Invalid extension view id: ${id}`);
  }

  const viewPath = stringField(value.path, `${fieldPrefix}[${index}].path`);
  assertSafeRelativePath(viewPath, `${fieldPrefix}[${index}].path`);
  if (!viewPath.endsWith(".html")) {
    throw new Error(`Extension field ${fieldPrefix}[${index}].path must be an .html page.`);
  }

  const title =
    value.title === undefined ? undefined : text(value.title, `${fieldPrefix}[${index}].title`);
  const width = optionalPositiveNumberField(value.width, `${fieldPrefix}[${index}].width`);
  const height = optionalPositiveNumberField(value.height, `${fieldPrefix}[${index}].height`);
  const chrome = optionalEnumField(
    value.chrome,
    `${fieldPrefix}[${index}].chrome`,
    SUPPORTED_HOST_EXTENSION_DESKTOP_VIEW_CHROMES,
  );

  return {
    id,
    path: viewPath,
    ...(title ? { title } : {}),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(chrome ? { chrome } : {}),
  };
}

function optionalPositiveNumberField(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Extension field ${fieldName} must be a positive number.`);
  }
  return value;
}

function optionalDesktopSettingsPageDefinitionField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
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

  const title = value.title === undefined ? undefined : text(value.title, `${fieldPrefix}.title`);
  return title ? { title } : {};
}

/**
 * Declaration-vs-content check, owned by the marketplace toolkit (registry CI
 * runs the same code). The host injects the agent-core MCP / hooks config
 * parsers so both sides validate with identical semantics.
 */
async function assertDeclaredInstructionContributionFiles(
  contributes: HostExtensionContributionSet | undefined,
  options: HostExtensionManifestParseOptions,
  secretSlots: readonly string[],
): Promise<void> {
  await assertToolkitDeclaredInstructionContributionFiles(contributes, {
    ...(options.readRelativeTextFile ? { readRelativeTextFile: options.readRelativeTextFile } : {}),
    ...(options.listRelativeChildDirectories
      ? { listRelativeChildDirectories: options.listRelativeChildDirectories }
      : {}),
    validators: { parseMcpConfigFile, parseHooksConfigFile },
    secretSlots,
    fieldPrefix: "manifest.contributes",
  });
}

function parseContributedToolDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionContributedToolDefinition {
  if (!isRecord(value)) {
    throw new Error(`Extension field ${fieldPrefix}[${index}] must be an object.`);
  }

  const name = stringField(value.name, `${fieldPrefix}[${index}].name`);
  if (!EXTENSION_FIELD_KEY_PATTERN.test(name)) {
    throw new Error(`Invalid extension tool name: ${name}`);
  }

  const description = stringField(value.description, `${fieldPrefix}[${index}].description`);
  if (!isRecord(value.presentation)) {
    throw new Error(`Extension field ${fieldPrefix}[${index}].presentation must be an object.`);
  }
  const presentation = {
    displayName: text(
      value.presentation.displayName,
      `${fieldPrefix}[${index}].presentation.displayName`,
    ),
    summary: text(value.presentation.summary, `${fieldPrefix}[${index}].presentation.summary`),
  };
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
    presentation,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    ...(approvalMode ? { approvalMode } : {}),
    ...(executionMode ? { executionMode } : {}),
  };
}

function optionalSettingsSchemaField(
  value: unknown,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
): HostExtensionSettingDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => parseSettingDefinition(entry, index, fieldPrefix, text));
}

function parseSettingDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
  text: ExtensionLocalizedField,
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
  const title = text(value.title, `${fieldPrefix}[${index}].title`);
  const description =
    value.description === undefined
      ? undefined
      : text(value.description, `${fieldPrefix}[${index}].description`);
  const placeholder =
    value.placeholder === undefined
      ? undefined
      : text(value.placeholder, `${fieldPrefix}[${index}].placeholder`);
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
    text,
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
  text: ExtensionLocalizedField,
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
    const label = text(entry.label, `${fieldName}[${optionIndex}].label`);
    const description =
      entry.description === undefined
        ? undefined
        : text(entry.description, `${fieldName}[${optionIndex}].description`);
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

function optionalSecretSlotsField(value: unknown, fieldPrefix: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const slots = value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`Extension field ${fieldPrefix}[${index}] must be a string.`);
    }
    const key = entry.trim();
    if (!EXTENSION_SECRET_SLOT_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid extension secret slot key: ${key}`);
    }
    return key;
  });
  if (new Set(slots).size !== slots.length) {
    throw new Error(`Extension field ${fieldPrefix} must not contain duplicate slots.`);
  }
  return slots;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
