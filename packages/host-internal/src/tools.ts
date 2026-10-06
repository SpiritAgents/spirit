import { randomUUID } from "node:crypto";
import { product } from "@spiritagent/product";
import { existsSync, realpathSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { release as osRelease } from "node:os";
import path from "node:path";

import { glob as globPaths } from "glob";

import {
  APPLY_PATCH_HOST_TOOL_NAME,
  throwUnknownToolError,
  toolNamesFromDefinitions,
  type JsonValue,
  type PermissionMemoryTarget,
  type ToolApprovalFileDiffPreview,
  type ToolApprovalRequest,
  type ToolExecutionFileChangeDiff,
  type ToolExecutionHostUi,
} from "@spiritagent/agent-core";

import { applyDiff } from "./apply-diff.js";
import {
  APPROVAL_FILE_PREVIEW_MAX_BYTES,
  buildApprovalFileContentPreview,
  buildApprovalFileDiffPreview,
  type ApprovalFileDiffPreviewSource,
} from "./approval-file-preview.js";
import {
  GREP_TOOL_MAX_MATCHES,
  formatGrepToolOutput,
  runRipgrepSearch,
  type GrepToolOutputMode,
} from "./ripgrep-search.js";
import { resolveTranscriptsDir } from "./transcript.js";
import {
  defaultShellForPty,
  commandParameterDescriptionForResolvedShell,
  shellDisplayNameForResolvedShell,
  withShellCommandHighRiskConfirmHint,
} from "./default-terminal-shell.js";
import { runShell } from "./shell-execution.js";
import { resolveToolOutputArchivesDir } from "./tool-output-archive.js";
import {
  readHostFileSnapshot,
  type HostFileChangeKind,
  type HostFileChangeObserver,
  type HostFileChangeRequestSummary,
  type HostRecordedFileChange,
  type HostToolRequestMetadata,
} from "./file-rewind.js";
import {
  type HostExtensionManager,
  type HostExtensionToolApprovalMode,
  type HostExtensionToolExecutionMode,
} from "./extensions.js";
import {
  CREATE_AUTOMATION_TOOL_NAME,
  type CreateAutomationApprovalLevel,
  deriveAutomationTitle,
  parseCreateAutomationApprovalLevel,
  parseCreateAutomationTriggerInput,
} from "./automation-host-tool.js";
import {
  createHostAutomationStore,
  formatTriggerLabel,
  type HostAutomationDefinition,
  type HostAutomationTrigger,
} from "./automations.js";
import type { ModelReasoningEffort } from "./reasoning-effort.js";
import type { ModelRef } from "./config-v2.js";
import { resolveInstructionPaths, type InstructionDiscoveryContext } from "./storage.js";
import { isPathUnderPlansDir, resolvePlanFilePath } from "./plans.js";
import {
  createHostDreamStore,
  type HostDreamScope,
  type HostDreamStore,
  type HostDreamSourceSessionRef,
} from "./dreams.js";
import {
  createHostTodoStore,
  type HostTodoItem,
  type HostTodoScope,
  type HostTodoStore,
} from "./todos.js";
import { detectSupportedImageFile, hasSupportedImageExtension } from "./image-file-support.js";
import {
  GENERATED_IMAGES_DIR,
  GENERATED_VIDEOS_DIR,
  generatedDirForKind,
  generatedImageMarkdownRef,
  generatedVideoMarkdownRef,
  parseManagedGeneratedAssetReference,
} from "./managed-generated-asset.js";
import { detectSupportedVideoFile, hasSupportedVideoExtension } from "./video-file-support.js";
import { filterWorkspaceFilePathsByIgnore } from "./workspace-ignore.js";
import type { PermissionConfig } from "./credentials/types.js";
import {
  createPermissionConfigLoader,
  evaluateReadFilePermission,
  evaluateShellPermission,
  savePermissionRule,
  type PermissionConfigLoadResult,
} from "./permissions/index.js";
import { buildShellToolResult, serializeShellToolResult } from "@spiritagent/agent-core";
import {
  convertFetchedPageToToolText,
  WEB_FETCH_ACCEPT_HEADER,
  WEB_FETCH_TIMEOUT_MS,
  WEB_FETCH_USER_AGENT,
} from "./web-fetch/index.js";
import { normalizeMimeType } from "./web-fetch/resolve-url.js";

const MAX_READ_LINES_DEFAULT = 200;
const WEB_FETCH_IMAGE_CACHE_DIR = "tool-web-fetch-images";
const WEB_FETCH_IMAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const WEB_FETCH_IMAGE_CACHE_MAX_FILES = 128;

const SEARCH_IGNORE_DIR_NAMES = new Set([".git", "target", "node_modules"]);

export type HostJsonPrimitive = string | number | boolean | null;
export type HostJsonValue = HostJsonPrimitive | HostJsonObject | HostJsonValue[];

export interface HostJsonObject {
  [key: string]: HostJsonValue;
}

export interface HostToolTextContentPart {
  type: "text";
  text: string;
}

export interface HostToolImageContentPart {
  type: "image";
  path: string;
}

export interface HostToolVideoContentPart {
  type: "video";
  path: string;
}

export type HostToolContentPart =
  | HostToolTextContentPart
  | HostToolImageContentPart
  | HostToolVideoContentPart;

export interface HostToolModelCapabilities {
  imageInput?: true;
  audioInput?: true;
  videoInput?: true;
}

export interface HostToolModelCompatibilityProfile {
  hasExplicitCapabilities: boolean;
  capabilities: HostToolModelCapabilities;
}

export interface HostToolExecutionOutput {
  content: HostToolContentPart[];
  summaryText: string;
  hostUi?: ToolExecutionHostUi;
}

export interface HostGeneratedImageSaveRequest {
  data: Uint8Array;
  mediaType: string;
  prompt: string;
  model: string;
}

export interface HostGeneratedImageFile {
  path: string;
  mimeType: string;
  markdownRef: string;
}

export interface HostGeneratedVideoSaveRequest {
  data: Uint8Array;
  mediaType: string;
  prompt: string;
  model: string;
}

export interface HostGeneratedVideoFile {
  path: string;
  mimeType: string;
  markdownRef: string;
}

interface ResolvedReadFileTarget {
  canonicalPath: string;
  displayPath: string;
  managed: boolean;
}

export interface HostBuiltinToolDefinitionEnvironment {
  shellDisplayName: string;
  commandParameterDescription: string;
}

export interface HostOperatingSystemInfo {
  name: string;
  version: string;
}

export interface HostAskQuestionsOptionSpec {
  id: string;
  label: string;
  summary?: string;
}

export interface HostAskQuestionsQuestionSpec {
  id: string;
  title: string;
  allowMultiple: boolean;
  options: HostAskQuestionsOptionSpec[];
}

export interface HostAskQuestionsRequest<QuestionSpec = HostAskQuestionsQuestionSpec> {
  title?: string;
  questions: QuestionSpec[];
}

export interface SubagentRequest {
  task: string;
  success_criteria?: string;
  context_summary?: string;
  files_to_inspect: string[];
  expected_output?: string;
  worktree?: boolean;
}

export type ApplyPatchOperationType = "create_file" | "update_file" | "delete_file";

export interface ApplyPatchOperation {
  type: ApplyPatchOperationType;
  path: string;
  diff?: string;
}

export type HostToolRequest<QuestionSpec = HostAskQuestionsQuestionSpec> =
  | { name: "finish_task"; summary?: string }
  | { name: "shell"; command: string; reason: string }
  | { name: "web_fetch"; url: string }
  | { name: "ls"; path: string }
  | { name: "glob"; pattern: string }
  | {
      name: "read_file";
      path: string;
      offset?: number;
      limit?: number;
    }
  | {
      name: "grep";
      pattern: string;
      glob?: string;
      caseInsensitive?: boolean;
      outputMode?: GrepToolOutputMode;
      headLimit?: number;
      offset?: number;
      lineNumbers?: boolean;
      afterContext?: number;
      beforeContext?: number;
      contextLines?: number;
      fileType?: string;
      includeIgnored?: boolean;
      multiline?: boolean;
    }
  | {
      name: "subagent";
      task: string;
      success_criteria?: string;
      context_summary?: string;
      files_to_inspect: string[];
      expected_output?: string;
      worktree?: boolean;
    }
  | {
      name: "generate_image";
      prompt: string;
      size?: string;
    }
  | {
      name: "generate_video";
      prompt: string;
      duration?: number;
      aspect_ratio?: string;
      resolution?: string;
    }
  | {
      name: "ask_questions";
      title?: string;
      questions: QuestionSpec[];
    }
  | {
      name: "extension_tool";
      extension_id: string;
      tool_name: string;
      arguments: HostJsonObject;
      approval_mode?: HostExtensionToolApprovalMode;
      execution_mode?: HostExtensionToolExecutionMode;
      questions_result?: HostJsonValue;
    }
  | { name: "create_file"; path: string; content: string }
  | { name: "create_plan"; plan_name: string; content: string }
  | { name: "edit_file"; path: string; old_text: string; new_text: string }
  | { name: "delete_file"; path: string }
  | { name: typeof APPLY_PATCH_HOST_TOOL_NAME; operation: ApplyPatchOperation }
  | { name: "dream_list"; include_deleted: boolean; include_expired: boolean }
  | { name: "dream_read"; id: string }
  | { name: "dream_record"; title: string; summary: string; details?: string; tags: string[] }
  | {
      name: "dream_update";
      id: string;
      title?: string;
      summary?: string;
      details?: string;
      tags?: string[];
    }
  | { name: "dream_delete"; id: string; reason: string }
  | { name: "todo_list"; include_completed: boolean }
  | { name: "todo_write"; todos: HostTodoItem[] }
  | {
      name: typeof CREATE_AUTOMATION_TOOL_NAME;
      title: string;
      overview: string;
      trigger: HostAutomationTrigger;
      approval_level: CreateAutomationApprovalLevel;
    };

export type HostAuthorizationDecision<QuestionSpec = HostAskQuestionsQuestionSpec> =
  | { kind: "allowed" }
  | {
      kind: "need-approval";
      approval: ToolApprovalRequest;
      rememberTarget?: PermissionMemoryTarget;
    }
  | { kind: "need-questions"; questions: HostAskQuestionsRequest<QuestionSpec> }
  | { kind: "denied"; reason: string };

export type HostMcpStatusState = "idle" | "loading" | "ready" | "error";

export interface HostMcpStatusSnapshot {
  revision: number;
  state: HostMcpStatusState;
  configuredServers: number;
  loadedServers: number;
  cachedTools: number;
  lastError?: string;
}

function createHostToolTextOutput(text: string): HostToolExecutionOutput {
  return createHostToolOutput(text);
}

/**
 * Attaches the exact before/after pair of an apply_patch write to the tool output, so hosts can
 * render a real diff on the completed tool card. Over-sized sides drop the payload; the card
 * then falls back to reconstructing the diff from the patch text.
 */
function hostOutputWithFileChangeDiff(
  summaryText: string,
  fileChangeDiff: ToolExecutionFileChangeDiff,
): HostToolExecutionOutput {
  const output = createHostToolTextOutput(summaryText);
  const encoder = new TextEncoder();
  if (
    encoder.encode(fileChangeDiff.before).length > APPROVAL_FILE_PREVIEW_MAX_BYTES ||
    encoder.encode(fileChangeDiff.after).length > APPROVAL_FILE_PREVIEW_MAX_BYTES
  ) {
    return output;
  }
  return { ...output, hostUi: { fileChangeDiff } };
}

function createHostToolOutput(
  summaryText: string,
  extraContent: HostToolContentPart[] = [],
): HostToolExecutionOutput {
  return {
    content: [
      ...(summaryText.length > 0
        ? [{ type: "text", text: summaryText } satisfies HostToolTextContentPart]
        : []),
      ...extraContent,
    ],
    summaryText,
  };
}

export interface HostBuiltinToolService<QuestionSpec = HostAskQuestionsQuestionSpec> {
  toolDefinitionEnvironment(): HostBuiltinToolDefinitionEnvironment;
  operatingSystemInfo(): HostOperatingSystemInfo;
  parseCommand(message: string): Promise<HostToolRequest<QuestionSpec>>;
  requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<HostToolRequest<QuestionSpec>>;
  authorize(
    request: HostToolRequest<QuestionSpec>,
  ): Promise<HostAuthorizationDecision<QuestionSpec>>;
  rememberApproval(target: PermissionMemoryTarget, scope: "session" | "config"): Promise<void>;
  execute(request: HostToolRequest<QuestionSpec>): Promise<HostToolExecutionOutput | string>;
  attachRequestMetadata?(
    request: HostToolRequest<QuestionSpec>,
    metadata: HostToolRequestMetadata,
  ): HostToolRequest<QuestionSpec>;
  shouldExecuteInBackground?(request: HostToolRequest<QuestionSpec>): boolean;
  backgroundStatusText?(request: HostToolRequest<QuestionSpec>): string | undefined;
  abortRunningShell?(): void;
  abortShell?(toolCallId: string): boolean;
  startMcpBackgroundRefresh(): void;
  mcpStatusSnapshot(): HostMcpStatusSnapshot;
  addMcpServer(name: string, config: HostJsonValue): Promise<string>;
  listMcpServers(): Promise<unknown[]>;
  inspectMcpServer(name: string): Promise<unknown>;
  listMcpTools(name: string): Promise<unknown[]>;
  listMcpResources(name: string): Promise<unknown[]>;
  readMcpResource(name: string, uri: string): Promise<HostJsonValue>;
  listCachedMcpPrompts(name: string): Promise<unknown[]>;
  listMcpPrompts(name: string): Promise<unknown[]>;
  getMcpPrompt(name: string, prompt: string, argsJson?: string): Promise<HostJsonValue>;
}

export type HostFileToolRequest<QuestionSpec = HostAskQuestionsQuestionSpec> = Extract<
  HostToolRequest<QuestionSpec>,
  { name: "create_file" | "create_plan" | "edit_file" | "delete_file" }
>;

export type HostWritableFileToolRequest<QuestionSpec = HostAskQuestionsQuestionSpec> =
  | HostFileToolRequest<QuestionSpec>
  | Extract<HostToolRequest<QuestionSpec>, { name: typeof APPLY_PATCH_HOST_TOOL_NAME }>;

export interface HostMcpAdapter {
  startBackgroundRefresh(): void;
  statusSnapshot(): HostMcpStatusSnapshot;
  addServer(name: string, config: HostJsonValue): Promise<string>;
  listServers(): Promise<unknown[]>;
  inspectServer(name: string): Promise<unknown>;
  listTools(name: string): Promise<unknown[]>;
  listResources(name: string): Promise<unknown[]>;
  readResource(name: string, uri: string): Promise<HostJsonValue>;
  listCachedPrompts(name: string): Promise<unknown[]>;
  listPrompts(name: string): Promise<unknown[]>;
  getPrompt(name: string, prompt: string, argsJson?: string): Promise<HostJsonValue>;
}

export interface HostExtensionRuntimeBinding<THostApi> {
  manager: HostExtensionManager;
  getHost(): THostApi;
  logger?: Pick<Console, "error" | "log">;
}

import type { ApprovalLevel } from "./approval-level.js";

export type { ApprovalLevel } from "./approval-level.js";

export function normalizeApprovalLevel(value: unknown): ApprovalLevel {
  if (value === "bypass-approval") {
    return "bypass-approval";
  }
  if (value === "auto-approval") {
    return "auto-approval";
  }
  return "default";
}

export interface HostAutomationCreateDefaults {
  workspaceRoot: string;
  modelRef: ModelRef;
  reasoningEffort?: ModelReasoningEffort;
}

export interface NodeHostToolServiceOptions {
  mcp?: HostMcpAdapter;
  fileChangeObserver?: HostFileChangeObserver;
  extensions?: HostExtensionRuntimeBinding<unknown>;
  dreamScope?: HostDreamScope;
  dreamSourceSession?: HostDreamSourceSessionRef;
  todoScope?: HostTodoScope;
  getModelCompatibilityProfile?: () => HostToolModelCompatibilityProfile | undefined;
  getApprovalLevel?: () => ApprovalLevel;
  getAutomationCreateDefaults?: () => HostAutomationCreateDefaults;
  onAutomationCreated?: (definition: HostAutomationDefinition) => void;
  /** Full tool list exposed to the model (builtin + extension + MCP). Used for unknown-tool errors. */
  availableToolDefinitions?: () => JsonValue;
}

export function createNoopMcpAdapter(): HostMcpAdapter {
  return {
    startBackgroundRefresh() {},
    statusSnapshot() {
      return {
        revision: 0,
        state: "idle",
        configuredServers: 0,
        loadedServers: 0,
        cachedTools: 0,
      };
    },
    async addServer() {
      throw new Error("MCP server management is not implemented for this host.");
    },
    async listServers() {
      return [];
    },
    async inspectServer() {
      throw new Error("MCP server inspection is not implemented for this host.");
    },
    async listTools() {
      return [];
    },
    async listResources() {
      return [];
    },
    async readResource() {
      throw new Error("MCP resource reading is not implemented for this host.");
    },
    async listCachedPrompts() {
      return [];
    },
    async listPrompts() {
      return [];
    },
    async getPrompt() {
      throw new Error("MCP prompt retrieval is not implemented for this host.");
    },
  };
}

export function detectShellForTools(): HostBuiltinToolDefinitionEnvironment {
  if (process.platform !== "win32") {
    const shell = process.env.SHELL ?? "/bin/sh";
    const name = path.basename(shell);
    return {
      shellDisplayName: `POSIX shell (${name})`,
      commandParameterDescription: withShellCommandHighRiskConfirmHint(
        `The command to execute in POSIX shell (${name}). Prefer POSIX shell syntax such as ls, find, grep, cat, pwd, and cd.`,
      ),
    };
  }

  const { file } = defaultShellForPty();
  return {
    shellDisplayName: shellDisplayNameForResolvedShell(file),
    commandParameterDescription: commandParameterDescriptionForResolvedShell(file),
  };
}

export function detectOperatingSystemInfo(): HostOperatingSystemInfo {
  const name =
    process.platform === "win32"
      ? "Windows"
      : process.platform === "darwin"
        ? "macOS"
        : process.platform === "linux"
          ? "Linux"
          : process.platform;
  return {
    name,
    version: osRelease(),
  };
}

export class NodeHostToolService<
  QuestionSpec = HostAskQuestionsQuestionSpec,
> implements HostBuiltinToolService<QuestionSpec> {
  private readonly workspaceRoot: string;
  private readonly spiritDataDir: string;
  private readonly mcp: HostMcpAdapter;
  private readonly fileChangeObserver: HostFileChangeObserver | undefined;
  private readonly extensions: HostExtensionRuntimeBinding<unknown> | undefined;
  private readonly dreamStore: HostDreamStore | undefined;
  private readonly dreamSourceSession: HostDreamSourceSessionRef | undefined;
  private todoStore: HostTodoStore | undefined;
  private readonly permissionConfigLoader: () => PermissionConfigLoadResult;
  private lastLoggedPermissionWarnings: string[] | undefined;
  /** Session-scoped remembered approvals; keys from {@link sessionApprovalKey}. */
  private readonly sessionApprovals = new Set<string>();
  private readonly requestMetadata = new WeakMap<object, HostToolRequestMetadata>();
  private readonly activeShellKills = new Map<string, () => void>();
  private availableToolDefinitions: (() => JsonValue) | undefined;

  constructor(
    private readonly context: InstructionDiscoveryContext,
    options: NodeHostToolServiceOptions = {},
  ) {
    this.workspaceRoot = path.resolve(context.workspaceRoot);
    this.spiritDataDir = path.resolve(context.spiritDataDir);
    this.permissionConfigLoader = createPermissionConfigLoader(this.spiritDataDir);
    this.mcp = options.mcp ?? createNoopMcpAdapter();
    this.fileChangeObserver = options.fileChangeObserver;
    this.extensions = options.extensions;
    this.dreamStore = options.dreamScope
      ? createHostDreamStore({ spiritDataDir: this.spiritDataDir, scope: options.dreamScope })
      : undefined;
    this.dreamSourceSession = options.dreamSourceSession;
    this.todoStore = options.todoScope
      ? createHostTodoStore({ spiritDataDir: this.spiritDataDir, scope: options.todoScope })
      : undefined;
    this.getModelCompatibilityProfile = options.getModelCompatibilityProfile;
    this.getApprovalLevel = options.getApprovalLevel;
    this.getAutomationCreateDefaults = options.getAutomationCreateDefaults;
    this.onAutomationCreated = options.onAutomationCreated;
    this.availableToolDefinitions = options.availableToolDefinitions;
  }

  private readonly getModelCompatibilityProfile:
    | (() => HostToolModelCompatibilityProfile | undefined)
    | undefined;

  private readonly getApprovalLevel: (() => ApprovalLevel) | undefined;

  private readonly getAutomationCreateDefaults: (() => HostAutomationCreateDefaults) | undefined;

  private readonly onAutomationCreated:
    | ((definition: HostAutomationDefinition) => void)
    | undefined;

  bindAvailableToolDefinitions(provider: () => JsonValue): void {
    this.availableToolDefinitions = provider;
  }

  setTodoScope(todoScope: HostTodoScope | undefined): void {
    this.todoStore = todoScope
      ? createHostTodoStore({ spiritDataDir: this.spiritDataDir, scope: todoScope })
      : undefined;
  }

  toolDefinitionEnvironment(): HostBuiltinToolDefinitionEnvironment {
    return detectShellForTools();
  }

  operatingSystemInfo(): HostOperatingSystemInfo {
    return detectOperatingSystemInfo();
  }

  async parseCommand(message: string): Promise<HostToolRequest<QuestionSpec>> {
    const raw = message.startsWith("/tool") ? message.slice("/tool".length).trim() : "";
    if (!raw) {
      throw new Error(
        "Usage:\n/tool shell <command>\n/tool web <url>\n/tool ls <absolute-dir>\n/tool glob <pattern>\n/tool read <path> [start] [end]\n/tool search <query>",
      );
    }

    const tokens = tokenize(raw);
    const subcommand = tokens[0];
    if (!subcommand) {
      throw new Error("Missing subcommand");
    }

    switch (subcommand) {
      case "shell": {
        const command = raw.slice("shell".length).trim();
        if (!command) {
          throw new Error("Usage: /tool shell <command>");
        }
        return {
          name: "shell",
          command,
          reason: "Manually executed by user",
        };
      }
      case "web":
        if (tokens.length < 2) {
          throw new Error("Usage: /tool web <url>");
        }
        return { name: "web_fetch", url: tokens[1]! };
      case "ls":
        if (tokens.length < 2) {
          throw new Error("Usage: /tool ls <absolute-dir>");
        }
        return { name: "ls", path: tokens[1]! };
      case "glob": {
        const pattern = raw.slice("glob".length).trim();
        if (!pattern) {
          throw new Error("Usage: /tool glob <pattern>");
        }
        return { name: "glob", pattern };
      }
      case "read": {
        if (tokens.length < 2) {
          throw new Error("Usage: /tool read <path> [offset] [limit]");
        }
        const offset = parseOptionalManualLine(tokens[2], "offset");
        const limit = parseOptionalManualLine(tokens[3], "limit");
        return {
          name: "read_file",
          path: tokens[1]!,
          ...(offset !== undefined ? { offset } : {}),
          ...(limit !== undefined ? { limit } : {}),
        };
      }
      case "search": {
        const pattern = raw.slice("search".length).trim();
        if (!pattern) {
          throw new Error("Usage: /tool search <pattern>");
        }
        return {
          name: "grep",
          pattern,
        };
      }
      default:
        throw new Error(
          `Unknown /tool subcommand: ${subcommand}\nAvailable: shell | web | list | glob | read | search`,
        );
    }
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<HostToolRequest<QuestionSpec>> {
    const parsed = parseJsonObject(argumentsJson);

    switch (name) {
      case "finish_task": {
        const summary = optionalStringStrict(parsed, "summary");
        return {
          name,
          ...(summary ? { summary } : {}),
        };
      }
      case "shell":
        return {
          name,
          reason: requiredString(parsed, "reason"),
          command: requiredString(parsed, "command"),
        };
      case "web_fetch":
        return {
          name,
          url: requiredString(parsed, "url"),
        };
      case "ls":
        return {
          name,
          path: requiredString(parsed, "path"),
        };
      case "glob":
        return {
          name,
          pattern: requiredString(parsed, "pattern"),
        };
      case "read_file": {
        const offset = optionalPositiveInt(parsed, "offset");
        const limit = optionalPositiveInt(parsed, "limit");
        return {
          name,
          path: requiredString(parsed, "path"),
          ...(offset !== undefined ? { offset } : {}),
          ...(limit !== undefined ? { limit } : {}),
        };
      }
      case "grep": {
        const caseInsensitive = optionalBoolean(parsed, "-i");
        const glob = optionalStringStrict(parsed, "glob");
        const outputMode = optionalGrepOutputMode(parsed, "output_mode");
        const headLimit = optionalPositiveInt(parsed, "head_limit");
        const offset = optionalNonNegativeInt(parsed, "offset");
        const lineNumbers = optionalBoolean(parsed, "-n");
        const afterContext = optionalNonNegativeInt(parsed, "-A");
        const beforeContext = optionalNonNegativeInt(parsed, "-B");
        const contextLines = optionalNonNegativeInt(parsed, "-C");
        const fileType = optionalStringStrict(parsed, "type");
        const includeIgnored = optionalBoolean(parsed, "include_ignored");
        const multiline = optionalBoolean(parsed, "multiline");
        return {
          name,
          pattern: requiredString(parsed, "pattern"),
          ...(caseInsensitive !== undefined ? { caseInsensitive } : {}),
          ...(glob ? { glob } : {}),
          ...(outputMode !== undefined ? { outputMode } : {}),
          ...(headLimit !== undefined ? { headLimit } : {}),
          ...(offset !== undefined ? { offset } : {}),
          ...(lineNumbers !== undefined ? { lineNumbers } : {}),
          ...(afterContext !== undefined ? { afterContext } : {}),
          ...(beforeContext !== undefined ? { beforeContext } : {}),
          ...(contextLines !== undefined ? { contextLines } : {}),
          ...(fileType ? { fileType } : {}),
          ...(includeIgnored !== undefined ? { includeIgnored } : {}),
          ...(multiline !== undefined ? { multiline } : {}),
        };
      }
      case "subagent": {
        const successCriteria = optionalStringStrict(parsed, "success_criteria");
        const contextSummary = optionalStringStrict(parsed, "context_summary");
        const expectedOutput = optionalStringStrict(parsed, "expected_output");
        const worktree = optionalBoolean(parsed, "worktree");
        return {
          name,
          task: requiredString(parsed, "task"),
          ...(successCriteria ? { success_criteria: successCriteria } : {}),
          ...(contextSummary ? { context_summary: contextSummary } : {}),
          files_to_inspect: optionalStringArrayStrict(parsed, "files_to_inspect"),
          ...(expectedOutput ? { expected_output: expectedOutput } : {}),
          ...(worktree === true ? { worktree: true } : {}),
        };
      }
      case "generate_image": {
        const size = optionalStringStrict(parsed, "size");
        return {
          name,
          prompt: requiredString(parsed, "prompt"),
          ...(size ? { size } : {}),
        };
      }
      case "generate_video": {
        const duration = optionalPositiveInt(parsed, "duration");
        const aspectRatio = optionalStringStrict(parsed, "aspect_ratio");
        const resolution = optionalStringStrict(parsed, "resolution");
        return {
          name,
          prompt: requiredString(parsed, "prompt"),
          ...(duration !== undefined ? { duration } : {}),
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
          ...(resolution ? { resolution } : {}),
        };
      }
      case "ask_questions":
        return parseAskQuestionsRequest(parsed) as HostToolRequest<QuestionSpec>;
      case "create_file":
        return {
          name,
          path: requiredString(parsed, "path"),
          content: requiredString(parsed, "content"),
        };
      case "create_plan":
        return {
          name,
          plan_name: requiredString(parsed, "name"),
          content: requiredString(parsed, "content"),
        };
      case CREATE_AUTOMATION_TOOL_NAME: {
        const overview = requiredString(parsed, "overview");
        const explicitTitle = optionalStringStrict(parsed, "title");
        return {
          name: CREATE_AUTOMATION_TOOL_NAME,
          title: deriveAutomationTitle(overview, explicitTitle),
          overview,
          trigger: parseCreateAutomationTriggerInput(parsed),
          approval_level: parseCreateAutomationApprovalLevel(parsed.approval_level),
        };
      }
      case "edit_file":
        return {
          name,
          path: requiredString(parsed, "path"),
          old_text: requiredString(parsed, "old_text"),
          new_text: requiredString(parsed, "new_text"),
        };
      case "delete_file":
        return {
          name,
          path: requiredString(parsed, "path"),
        };
      case APPLY_PATCH_HOST_TOOL_NAME:
        return {
          name: APPLY_PATCH_HOST_TOOL_NAME,
          operation: parseApplyPatchOperation(parsed),
        };
      case "dream_list":
        return {
          name,
          include_deleted: optionalBoolean(parsed, "include_deleted") ?? false,
          include_expired: optionalBoolean(parsed, "include_expired") ?? false,
        };
      case "dream_read":
        return {
          name,
          id: requiredString(parsed, "id"),
        };
      case "dream_record": {
        const details = optionalStringStrict(parsed, "details");
        return {
          name,
          title: requiredString(parsed, "title"),
          summary: requiredString(parsed, "summary"),
          ...(details ? { details } : {}),
          tags: optionalStringArrayStrict(parsed, "tags"),
        };
      }
      case "dream_update": {
        const title = optionalStringStrict(parsed, "title");
        const summary = optionalStringStrict(parsed, "summary");
        const details = optionalStringStrict(parsed, "details");
        const tags = optionalStringArrayPatch(parsed, "tags");
        return {
          name,
          id: requiredString(parsed, "id"),
          ...(title ? { title } : {}),
          ...(summary ? { summary } : {}),
          ...(details ? { details } : {}),
          ...(tags !== undefined ? { tags } : {}),
        };
      }
      case "dream_delete":
        return {
          name,
          id: requiredString(parsed, "id"),
          reason: requiredString(parsed, "reason"),
        };
      case "todo_list":
        return {
          name,
          include_completed: optionalBoolean(parsed, "include_completed") ?? true,
        };
      case "todo_write":
        return {
          name,
          todos: parseTodoWriteItems(parsed),
        };
      default:
        {
          const extensionTool = await this.resolveExtensionToolRequest(name, parsed);
          if (extensionTool) {
            return extensionTool;
          }
        }
        throwUnknownToolError(
          name,
          toolNamesFromDefinitions(this.resolveAvailableToolDefinitions()),
        );
    }
  }

  async authorize(
    request: HostToolRequest<QuestionSpec>,
  ): Promise<HostAuthorizationDecision<QuestionSpec>> {
    const isExtensionQuestions =
      request.name === "extension_tool" && request.approval_mode === "need-questions";
    const bypassHighRiskApproval =
      this.getApprovalLevel?.() === "bypass-approval" &&
      request.name !== "ask_questions" &&
      !isExtensionQuestions;
    // shell / ls / read_file evaluate permission rules first and fold the
    // bypass themselves: a deny rule is absolute and must win over
    // bypass-approval, so these tools never short-circuit here.
    if (
      bypassHighRiskApproval &&
      request.name !== "shell" &&
      request.name !== "ls" &&
      request.name !== "read_file"
    ) {
      return { kind: "allowed" };
    }

    switch (request.name) {
      case "finish_task":
      case "glob":
      case "grep":
      case "subagent":
      case "generate_image":
      case "generate_video":
        return { kind: "allowed" };
      case "ask_questions":
        return {
          kind: "need-questions",
          questions: {
            ...(request.title ? { title: request.title } : {}),
            questions: request.questions,
          },
        };
      case "extension_tool":
        if (request.approval_mode === "need-questions") {
          if (request.questions_result !== undefined) {
            return { kind: "allowed" };
          }
          return buildExtensionQuestionsAuthorization(
            request,
          ) as HostAuthorizationDecision<QuestionSpec>;
        }
        if (request.approval_mode === "need-approval") {
          return {
            kind: "need-approval",
            approval: {
              kind: "extension_tool",
              extensionId: request.extension_id,
              toolName: request.tool_name,
              argumentsPreview: truncateChars(JSON.stringify(request.arguments, null, 2), 1_200),
            },
          };
        }
        return { kind: "allowed" };
      case "shell": {
        const metadata = this.requestMetadataFor(request);
        const evaluation = evaluateShellPermission(
          request.command,
          this.loadPermissionRules().shell ?? {},
        );
        // Deny is absolute: bypass-approval, userInitiated and session memory
        // never override it.
        if (evaluation.verdict === "deny") {
          const segment = evaluation.segments?.find((candidate) => candidate.verdict === "deny");
          return {
            kind: "denied",
            reason: `command segment "${segment?.segment ?? request.command}" matched deny rule "${evaluation.matched?.pattern ?? ""}" in permission.shell`,
          };
        }
        if (
          this.sessionApprovals.has(sessionApprovalKey({ kind: "shell", command: request.command }))
        ) {
          return { kind: "allowed" };
        }
        if (evaluation.verdict === "allow") {
          return { kind: "allowed" };
        }
        // Verdict "ask": an explicit ask rule, no matching rule (fail-safe), or
        // a command line the splitter could not parse (also fail-safe ask).
        if (bypassHighRiskApproval || metadata?.userInitiated) {
          return { kind: "allowed" };
        }
        return {
          kind: "need-approval",
          approval: this.describeShellApproval(request),
          rememberTarget: { kind: "shell", command: request.command },
        };
      }
      case "web_fetch":
        return {
          kind: "need-approval",
          approval: { kind: "web_fetch", url: request.url },
        };
      case "ls": {
        const canonical = await this.resolveExistingAbsoluteDirectory(request.path);
        return this.authorizeExternalReadPath(
          canonical,
          "ls",
          bypassHighRiskApproval || this.requestMetadataFor(request)?.userInitiated === true,
        );
      }
      case "read_file": {
        const target = await this.resolveReadFileTarget(request.path);
        if (target.managed) {
          return { kind: "allowed" };
        }
        const canonical = target.canonicalPath;
        return this.authorizeExternalReadPath(
          canonical,
          "read_file",
          bypassHighRiskApproval || this.requestMetadataFor(request)?.userInitiated === true,
        );
      }
      case "create_file": {
        return {
          kind: "need-approval",
          approval: await this.describeCreateFileApproval(request),
        };
      }
      case "create_plan": {
        return {
          kind: "need-approval",
          approval: await this.describeCreatePlanApproval(request),
        };
      }
      case CREATE_AUTOMATION_TOOL_NAME:
        return {
          kind: "need-approval",
          approval: this.describeCreateAutomationApproval(request),
        };
      case "edit_file": {
        return {
          kind: "need-approval",
          approval: await this.describeEditFileApproval(request),
        };
      }
      case "delete_file": {
        return {
          kind: "need-approval",
          approval: await this.describeDeleteFileApproval(request),
        };
      }
      case APPLY_PATCH_HOST_TOOL_NAME: {
        return {
          kind: "need-approval",
          approval: await this.describeApplyPatchApproval(request),
        };
      }
      case "dream_list":
      case "dream_read":
      case "dream_record":
      case "dream_update":
      case "dream_delete":
      case "todo_list":
      case "todo_write":
        return { kind: "allowed" };
    }
  }

  /**
   * Structured approval descriptor for a call the host would auto-allow, used to enrich
   * hook-gated approvals with the same rich form (ToolExecutor.describeApproval). Best-effort:
   * unresolvable paths or unknown tools return undefined and the hook message stands alone.
   */
  async describeApproval(
    request: HostToolRequest<QuestionSpec>,
  ): Promise<ToolApprovalRequest | undefined> {
    try {
      switch (request.name) {
        case "shell":
          return this.describeShellApproval(request);
        case "web_fetch":
          return { kind: "web_fetch", url: request.url };
        case "ls": {
          const canonical = await this.resolveExistingAbsoluteDirectory(request.path);
          return this.buildReadPathApprovalDescriptor(canonical, "ls");
        }
        case "read_file": {
          const target = await this.resolveReadFileTarget(request.path);
          return this.buildReadPathApprovalDescriptor(target.canonicalPath, "read_file");
        }
        case "create_file":
          return this.describeCreateFileApproval(request);
        case "create_plan":
          return this.describeCreatePlanApproval(request);
        case "edit_file":
          return this.describeEditFileApproval(request);
        case "delete_file":
          return this.describeDeleteFileApproval(request);
        case APPLY_PATCH_HOST_TOOL_NAME:
          return this.describeApplyPatchApproval(request);
        case CREATE_AUTOMATION_TOOL_NAME:
          return this.describeCreateAutomationApproval(request);
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  private describeShellApproval(
    request: Extract<HostToolRequest<QuestionSpec>, { name: "shell" }>,
  ): ToolApprovalRequest {
    const shell = this.toolDefinitionEnvironment();
    return {
      kind: "shell",
      command: request.command,
      reason: request.reason,
      terminal: shell.shellDisplayName,
    };
  }

  private async describeCreateFileApproval(
    request: Extract<HostToolRequest<QuestionSpec>, { name: "create_file" }>,
  ): Promise<ToolApprovalRequest> {
    const fileDiffPreview = await this.approvalFileDiffPreview({
      kind: "create_file",
      path: request.path,
      content: request.content,
    });
    return {
      kind: "create_file",
      path: request.path,
      contentChars: [...request.content].length,
      ...(fileDiffPreview ? { fileDiffPreview } : {}),
    };
  }

  private async describeCreatePlanApproval(
    request: Extract<HostToolRequest<QuestionSpec>, { name: "create_plan" }>,
  ): Promise<ToolApprovalRequest> {
    const fileDiffPreview = await this.approvalFileDiffPreview({
      kind: "create_plan",
      planName: request.plan_name,
      content: request.content,
    });
    return {
      kind: "create_plan",
      planName: request.plan_name,
      contentChars: [...request.content].length,
      ...(fileDiffPreview ? { fileDiffPreview } : {}),
    };
  }

  private describeCreateAutomationApproval(
    request: Extract<HostToolRequest<QuestionSpec>, { name: typeof CREATE_AUTOMATION_TOOL_NAME }>,
  ): ToolApprovalRequest {
    return {
      kind: "create_automation",
      title: request.title,
      trigger: request.trigger as JsonValue,
      approvalLevel: request.approval_level,
      overview: request.overview,
      overviewChars: [...request.overview].length,
    };
  }

  private async describeEditFileApproval(
    request: Extract<HostToolRequest<QuestionSpec>, { name: "edit_file" }>,
  ): Promise<ToolApprovalRequest> {
    const fileDiffPreview = await this.approvalFileDiffPreview({
      kind: "edit_file",
      path: request.path,
      oldText: request.old_text,
      newText: request.new_text,
    });
    return {
      kind: "edit_file",
      path: request.path,
      oldChars: [...request.old_text].length,
      newChars: [...request.new_text].length,
      ...(fileDiffPreview ? { fileDiffPreview } : {}),
    };
  }

  private async describeDeleteFileApproval(
    request: Extract<HostToolRequest<QuestionSpec>, { name: "delete_file" }>,
  ): Promise<ToolApprovalRequest> {
    const fileDiffPreview = await this.approvalFileDiffPreview({
      kind: "delete_file",
      path: request.path,
    });
    return {
      kind: "delete_file",
      path: request.path,
      ...(fileDiffPreview ? { fileDiffPreview } : {}),
    };
  }

  private async describeApplyPatchApproval(
    request: Extract<HostToolRequest<QuestionSpec>, { name: typeof APPLY_PATCH_HOST_TOOL_NAME }>,
  ): Promise<ToolApprovalRequest> {
    const diffLines =
      request.operation.diff === undefined ? 0 : request.operation.diff.split(/\r?\n/).length;
    const fileDiffPreview = await this.approvalFileDiffPreview({
      kind: "apply_patch",
      operation: request.operation,
    });
    return {
      kind: "apply_patch",
      operation: request.operation.type,
      path: request.operation.path,
      ...(request.operation.type === "update_file" ? { diffLines } : {}),
      ...(fileDiffPreview ? { fileDiffPreview } : {}),
    };
  }

  /**
   * Comparison roots for read approvals: the descriptor path is realpath'd, so the workspace
   * root must be too (macOS /var -> /private/var and similar symlinked roots never match
   * otherwise). A missing root falls back to the unresolved path — display concerns must not
   * kill the descriptor.
   */
  private readPathWorkspaceRoots(): string[] {
    const roots = [path.resolve(this.workspaceRoot)];
    try {
      const resolvedRoot = realpathSync(this.workspaceRoot);
      if (resolvedRoot !== roots[0]) {
        roots.push(resolvedRoot);
      }
    } catch {
      // Keep the unresolved root.
    }
    return roots;
  }

  private async buildReadPathApprovalDescriptor(
    canonical: string,
    operation: "read_file" | "ls",
  ): Promise<ToolApprovalRequest> {
    // Best-effort like the diff previews: an unreadable/binary/over-sized target just drops the
    // content preview, and the approval form falls back to the plain path text.
    let fileContentPreview;
    try {
      fileContentPreview = await buildApprovalFileContentPreview(canonical, operation);
    } catch {
      fileContentPreview = undefined;
    }
    // Display path: workspace-relative when inside the workspace, else the global absolute path.
    const withinRoot = this.readPathWorkspaceRoots().find((root) => isWithinRoot(canonical, root));
    let displayPath = canonical;
    if (withinRoot !== undefined) {
      const relative = path.relative(withinRoot, canonical).replace(/\\/g, "/");
      if (relative) {
        displayPath = relative;
      }
    }
    return {
      kind: "read_path",
      operation,
      path: displayPath,
      workspaceExternal: withinRoot === undefined,
      ...(fileContentPreview
        ? { fileContentPreview: { path: displayPath, content: fileContentPreview.content } }
        : {}),
    };
  }

  /**
   * Best-effort diff preview for the approval form: the target may vanish or the patch may not
   * apply between the tool call and the approval decision, so preview failures degrade to the
   * plain text prompt instead of failing the authorization.
   */
  private async approvalFileDiffPreview(
    source: ApprovalFileDiffPreviewSource,
  ): Promise<ToolApprovalFileDiffPreview | undefined> {
    try {
      return await buildApprovalFileDiffPreview(source, (inputPath) =>
        this.resolveWorkspaceWriteTarget(inputPath),
      );
    } catch {
      return undefined;
    }
  }

  async rememberApproval(
    target: PermissionMemoryTarget,
    scope: "session" | "config",
  ): Promise<void> {
    if (scope === "session") {
      this.sessionApprovals.add(sessionApprovalKey(target));
      return;
    }
    // Config scope persists the exact value as an allow rule; no wildcard inference.
    await savePermissionRule(
      this.spiritDataDir,
      target.kind,
      target.kind === "shell" ? target.command : target.path,
      "allow",
    );
  }

  async execute(request: HostToolRequest<QuestionSpec>): Promise<HostToolExecutionOutput | string> {
    switch (request.name) {
      case "finish_task":
        return createHostToolTextOutput(request.summary?.trim() || "Task marked complete.");
      case "shell": {
        const shellMetadata = this.requestMetadataFor(request);
        return this.executeShell(request.command, {
          ...(shellMetadata?.onOutputChunk ? { onOutputChunk: shellMetadata.onOutputChunk } : {}),
          ...(shellMetadata?.toolCallId ? { toolCallId: shellMetadata.toolCallId } : {}),
        });
      }
      case "web_fetch":
        return this.executeWebFetch(request.url);
      case "ls":
        return this.executeLs(request.path);
      case "glob":
        return this.executeGlob(request.pattern);
      case "read_file":
        return this.executeReadFile(request.path, request.offset, request.limit);
      case "grep":
        return this.executeSearchFiles(request.pattern, {
          ...(request.caseInsensitive !== undefined
            ? { caseInsensitive: request.caseInsensitive }
            : {}),
          ...(request.glob !== undefined ? { glob: request.glob } : {}),
          ...(request.outputMode !== undefined ? { outputMode: request.outputMode } : {}),
          ...(request.headLimit !== undefined ? { headLimit: request.headLimit } : {}),
          ...(request.offset !== undefined ? { offset: request.offset } : {}),
          ...(request.lineNumbers !== undefined ? { lineNumbers: request.lineNumbers } : {}),
          ...(request.afterContext !== undefined ? { afterContext: request.afterContext } : {}),
          ...(request.beforeContext !== undefined ? { beforeContext: request.beforeContext } : {}),
          ...(request.contextLines !== undefined ? { contextLines: request.contextLines } : {}),
          ...(request.fileType !== undefined ? { fileType: request.fileType } : {}),
          ...(request.includeIgnored !== undefined
            ? { includeIgnored: request.includeIgnored }
            : {}),
          ...(request.multiline !== undefined ? { multiline: request.multiline } : {}),
        });
      case "subagent":
        throw new Error(
          "subagent must be handled by the Agent runtime, not the host-internal tool executor",
        );
      case "generate_image":
        throw new Error(
          "generate_image must be handled by the Agent runtime, not the host-internal tool executor",
        );
      case "generate_video":
        throw new Error(
          "generate_video must be handled by the Agent runtime, not the host-internal tool executor",
        );
      case "ask_questions":
        throw new Error(
          "ask_questions must be suspended by the runtime for user input, not executed directly",
        );
      case "extension_tool":
        if (!this.extensions) {
          throw new Error("Extension tool execution is not enabled for this host.");
        }
        return this.extensions.manager.invokeTool({
          extensionId: request.extension_id,
          toolName: request.tool_name,
          arguments: request.arguments,
          host: this.extensions.getHost(),
          ...(this.extensions.logger ? { logger: this.extensions.logger } : {}),
          ...(typeof request.questions_result === "object" && request.questions_result !== null
            ? { questionsResult: request.questions_result }
            : {}),
          ...(() => {
            const toolCallId = this.requestMetadata.get(request)?.toolCallId;
            return toolCallId ? { toolCallId } : {};
          })(),
        });
      case "create_file":
        return this.executeCreateFile(request);
      case "create_plan":
        return this.executeCreatePlan(request);
      case CREATE_AUTOMATION_TOOL_NAME:
        return this.executeCreateAutomation(request);
      case "edit_file":
        return this.executeEditFile(request);
      case "delete_file":
        return this.executeDeleteFile(request);
      case APPLY_PATCH_HOST_TOOL_NAME:
        return this.executeApplyPatch(request);
      case "dream_list":
        return JSON.stringify({
          dreams: await this.requireDreamStore().list({
            includeDeleted: request.include_deleted,
            includeExpired: request.include_expired,
          }),
        });
      case "dream_read": {
        const dream = await this.requireDreamStore().read(request.id);
        if (!dream) {
          throw new Error(`Dream not found: ${request.id}`);
        }
        return JSON.stringify({ dream });
      }
      case "dream_record":
        return JSON.stringify({
          dream: await this.requireDreamStore().record({
            title: request.title,
            summary: request.summary,
            ...(request.details ? { details: request.details } : {}),
            tags: request.tags,
            ...(this.dreamSourceSession ? { sourceSession: this.dreamSourceSession } : {}),
          }),
        });
      case "dream_update":
        return JSON.stringify({
          dream: await this.requireDreamStore().update({
            id: request.id,
            ...(request.title ? { title: request.title } : {}),
            ...(request.summary ? { summary: request.summary } : {}),
            ...(request.details ? { details: request.details } : {}),
            ...(request.tags !== undefined ? { tags: request.tags } : {}),
            ...(this.dreamSourceSession ? { sourceSession: this.dreamSourceSession } : {}),
          }),
        });
      case "dream_delete":
        return JSON.stringify({
          dream: await this.requireDreamStore().delete(request.id, request.reason),
        });
      case "todo_list":
        return JSON.stringify({
          todos: await this.requireTodoStore().listItems({
            includeCompleted: request.include_completed,
          }),
        });
      case "todo_write":
        return JSON.stringify({
          todos: await this.requireTodoStore().write(request.todos),
        });
    }
  }

  async saveGeneratedImage(
    request: HostGeneratedImageSaveRequest,
  ): Promise<HostGeneratedImageFile> {
    const imageType = detectGeneratedImageType(request.mediaType, request.data);
    const outputDir = path.join(this.spiritDataDir, GENERATED_IMAGES_DIR);
    await mkdir(outputDir, { recursive: true });

    const filePath = path.join(outputDir, `${Date.now()}-${randomUUID()}${imageType.extension}`);
    await writeFile(filePath, request.data);
    return {
      path: filePath,
      mimeType: imageType.mimeType,
      markdownRef: generatedImageMarkdownRef(filePath),
    };
  }

  async saveGeneratedVideo(
    request: HostGeneratedVideoSaveRequest,
  ): Promise<HostGeneratedVideoFile> {
    const videoType = detectGeneratedVideoType(request.mediaType, request.data);
    const outputDir = path.join(this.spiritDataDir, GENERATED_VIDEOS_DIR);
    await mkdir(outputDir, { recursive: true });

    const filePath = path.join(outputDir, `${Date.now()}-${randomUUID()}${videoType.extension}`);
    await writeFile(filePath, request.data);
    return {
      path: filePath,
      mimeType: videoType.mimeType,
      markdownRef: generatedVideoMarkdownRef(filePath),
    };
  }

  attachRequestMetadata(
    request: HostToolRequest<QuestionSpec>,
    metadata: HostToolRequestMetadata,
  ): HostToolRequest<QuestionSpec> {
    if (typeof request === "object" && request !== null) {
      this.requestMetadata.set(request, metadata);
    }
    return request;
  }

  shouldExecuteInBackground(request: HostToolRequest<QuestionSpec>): boolean {
    if (request.name === "shell" || request.name === "web_fetch") {
      return true;
    }
    return request.name === "extension_tool" && request.execution_mode === "background";
  }

  abortRunningShell(): void {
    for (const kill of this.activeShellKills.values()) {
      kill();
    }
    this.activeShellKills.clear();
  }

  abortShell(toolCallId: string): boolean {
    const trimmed = toolCallId.trim();
    if (!trimmed) {
      return false;
    }
    const kill = this.activeShellKills.get(trimmed);
    if (!kill) {
      return false;
    }
    kill();
    this.activeShellKills.delete(trimmed);
    return true;
  }

  backgroundStatusText(request: HostToolRequest<QuestionSpec>): string | undefined {
    if (request.name === "shell" || request.name === "web_fetch") {
      // Status is shown on the tool card; do not mirror into thinking aux.
      return undefined;
    }
    if (request.name !== "extension_tool" || request.execution_mode !== "background") {
      return undefined;
    }
    return `Running extension tool: ${request.tool_name}`;
  }

  startMcpBackgroundRefresh(): void {
    this.mcp.startBackgroundRefresh();
  }

  mcpStatusSnapshot(): HostMcpStatusSnapshot {
    return this.mcp.statusSnapshot();
  }

  async addMcpServer(name: string, config: HostJsonValue): Promise<string> {
    return this.mcp.addServer(name, config);
  }

  async listMcpServers(): Promise<unknown[]> {
    return this.mcp.listServers();
  }

  async inspectMcpServer(name: string): Promise<unknown> {
    return this.mcp.inspectServer(name);
  }

  async listMcpTools(name: string): Promise<unknown[]> {
    return this.mcp.listTools(name);
  }

  async listMcpResources(name: string): Promise<unknown[]> {
    return this.mcp.listResources(name);
  }

  async readMcpResource(name: string, uri: string): Promise<HostJsonValue> {
    return this.mcp.readResource(name, uri);
  }

  async listCachedMcpPrompts(name: string): Promise<unknown[]> {
    return this.mcp.listCachedPrompts(name);
  }

  async listMcpPrompts(name: string): Promise<unknown[]> {
    return this.mcp.listPrompts(name);
  }

  async getMcpPrompt(name: string, prompt: string, argsJson?: string): Promise<HostJsonValue> {
    return this.mcp.getPrompt(name, prompt, argsJson);
  }

  private resolveAvailableToolDefinitions(): JsonValue {
    return this.availableToolDefinitions?.() ?? [];
  }

  private async resolveExtensionToolRequest(
    name: string,
    parsed: HostJsonObject,
  ): Promise<HostToolRequest<QuestionSpec> | undefined> {
    if (!this.extensions) {
      return undefined;
    }

    const resolved = await this.extensions.manager.resolveTool(name);
    if (!resolved) {
      return undefined;
    }

    return {
      name: "extension_tool",
      extension_id: resolved.extensionId,
      tool_name: resolved.tool.name,
      arguments: parsed,
      ...(resolved.tool.approvalMode ? { approval_mode: resolved.tool.approvalMode } : {}),
      ...(resolved.tool.executionMode ? { execution_mode: resolved.tool.executionMode } : {}),
    };
  }

  private requireDreamStore(): HostDreamStore {
    if (!this.dreamStore) {
      throw new Error("Dream scope is not configured for this host.");
    }
    return this.dreamStore;
  }

  private requireTodoStore(): HostTodoStore {
    if (!this.todoStore) {
      throw new Error("Todo scope is not configured for this host.");
    }
    return this.todoStore;
  }

  /**
   * Current permission rules from `config.json`. The loader caches by file
   * mtime, so calling it on every authorize is cheap; lint warnings are
   * logged once per actual load (a reload returns a new warnings array).
   */
  private loadPermissionRules(): PermissionConfig {
    const { config, warnings } = this.permissionConfigLoader();
    if (warnings.length > 0 && warnings !== this.lastLoggedPermissionWarnings) {
      this.lastLoggedPermissionWarnings = warnings;
      for (const warning of warnings) {
        console.warn(`[permission] ${warning}`);
      }
    }
    return config;
  }

  /**
   * Authorization for ls / read_file once the target is canonicalized.
   * Order: deny rules (absolute; bypass-approval, userInitiated and session
   * memory never override) -> session memory -> matched ask / allow rules ->
   * built-in location fallback when NO rule matched. `foldAskToAllow` folds
   * every ask (rule or fallback) to allow under bypass-approval / userInitiated.
   */
  private async authorizeExternalReadPath(
    canonical: string,
    operation: "read_file" | "ls",
    foldAskToAllow: boolean,
  ): Promise<HostAuthorizationDecision<QuestionSpec>> {
    const evaluation = evaluateReadFilePermission(
      canonical,
      this.loadPermissionRules().read_file ?? {},
      { workspaceRoot: this.workspaceRoot },
    );
    if (evaluation.verdict === "deny") {
      return {
        kind: "denied",
        reason: `path "${canonical}" matched deny rule "${evaluation.matched?.pattern ?? ""}" in permission.read_file`,
      };
    }
    if (this.sessionApprovals.has(sessionApprovalKey({ kind: "read_file", path: canonical }))) {
      return { kind: "allowed" };
    }
    if (evaluation.matched !== undefined) {
      if (evaluation.verdict === "ask" && !foldAskToAllow) {
        return this.needReadPathApproval(canonical, operation);
      }
      return { kind: "allowed" };
    }
    // No rule matched: built-in location fallback. Workspace-internal and
    // Spirit-managed reads did not prompt before permission rules existed, so
    // the fail-safe ask lands only on paths outside those locations.
    if (this.isAllowedReadLocation(canonical) || foldAskToAllow) {
      return { kind: "allowed" };
    }
    return this.needReadPathApproval(canonical, operation);
  }

  private async needReadPathApproval(
    canonical: string,
    operation: "read_file" | "ls",
  ): Promise<HostAuthorizationDecision<QuestionSpec>> {
    return {
      kind: "need-approval",
      approval: await this.buildReadPathApprovalDescriptor(canonical, operation),
      rememberTarget: { kind: "read_file", path: canonical },
    };
  }

  /**
   * Built-in no-rule fallback for reads: locations that were always readable
   * without prompting (workspace, Spirit-managed user area, Spirit data
   * internal dirs). Only consulted when no read_file rule matches.
   */
  private isAllowedReadLocation(canonical: string): boolean {
    return (
      isWithinRoot(canonical, this.workspaceRoot) ||
      isInsideSpiritManagedUserArea(canonical, this.context) ||
      isSpiritDataInternalReadPath(canonical, this.context.spiritDataDir)
    );
  }

  private async resolveExistingAbsoluteDirectory(input: string): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error("path must not be empty");
    }
    if (!path.isAbsolute(trimmed)) {
      throw new Error(`ls only accepts absolute paths: ${trimmed}`);
    }
    const canonical = await realpath(trimmed);
    const st = await lstat(canonical);
    if (!st.isDirectory()) {
      throw new Error(`Not a directory: ${canonical}`);
    }
    return canonical;
  }

  private async resolveExistingFilePath(input: string): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error("path must not be empty");
    }
    const raw = path.isAbsolute(trimmed) ? trimmed : path.resolve(this.workspaceRoot, trimmed);
    return realpath(raw);
  }

  private async resolveReadFileTarget(input: string): Promise<ResolvedReadFileTarget> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error("path must not be empty");
    }

    const managedCanonical = await this.tryResolveManagedGeneratedAssetPath(trimmed);
    if (managedCanonical) {
      return {
        canonicalPath: managedCanonical,
        displayPath: trimmed,
        managed: true,
      };
    }

    const canonicalPath = await this.resolveExistingFilePath(trimmed);
    return {
      canonicalPath,
      displayPath: canonicalPath,
      managed: false,
    };
  }

  private async tryResolveManagedGeneratedAssetPath(
    reference: string,
  ): Promise<string | undefined> {
    const parsed = parseManagedGeneratedAssetReference(reference);
    if (!parsed) {
      return undefined;
    }

    const { kind, basename, reference: trimmed } = parsed;
    const assetLabel = kind === "image" ? "image" : "video";

    const managedRoot = path.join(this.spiritDataDir, generatedDirForKind(kind));
    const candidatePath = path.join(managedRoot, basename);
    try {
      const managedRootStats = await lstat(managedRoot);
      if (!managedRootStats.isDirectory() || managedRootStats.isSymbolicLink()) {
        throw new Error(`Invalid ${product.name}-managed ${assetLabel} directory: ${trimmed}`);
      }

      const candidate = await lstat(candidatePath);
      if (candidate.isSymbolicLink()) {
        throw new Error(
          `${product.name}-managed ${assetLabel} reference must not be a symlink: ${trimmed}`,
        );
      }
      if (!candidate.isFile()) {
        throw new Error(`${product.name}-managed ${assetLabel} not found: ${trimmed}`);
      }

      const [canonicalSpiritRoot, canonicalRoot, canonical] = await Promise.all([
        realpath(this.spiritDataDir),
        realpath(managedRoot),
        realpath(candidatePath),
      ]);
      if (!pathHasPrefix(canonicalRoot, canonicalSpiritRoot)) {
        throw new Error(
          `${product.name}-managed ${assetLabel} directory escapes allowed root: ${trimmed}`,
        );
      }
      if (!pathHasPrefix(canonical, canonicalRoot)) {
        throw new Error(
          `${product.name}-managed ${assetLabel} reference escapes allowed root: ${trimmed}`,
        );
      }

      const st = await lstat(canonical);
      if (st.isSymbolicLink() || !st.isFile()) {
        throw new Error(`${product.name}-managed ${assetLabel} not found: ${trimmed}`);
      }

      return canonical;
    } catch (error) {
      if (error instanceof Error && error.message.includes(trimmed)) {
        throw error;
      }
      throw new Error(`${product.name}-managed ${assetLabel} not found: ${trimmed}`, {
        cause: error,
      });
    }
  }

  private resolveWorkspaceWriteTarget(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error("path must not be empty");
    }
    // Writes are gated by authorize(); do not re-apply a workspace allowlist here.
    return path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(this.workspaceRoot, trimmed);
  }

  private async executeLs(inputPath: string): Promise<string> {
    const root = await this.resolveExistingAbsoluteDirectory(inputPath);
    const files: string[] = [];
    const directories: string[] = [];
    let skippedDirs = 0;
    let skippedSymlinks = 0;

    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      skippedDirs += 1;
      return `[list]\npath: ${root}\nfiles: 0\nskipped_dirs: ${skippedDirs}\nskipped_symlinks: ${skippedSymlinks}\n\n(unable to read directory)`;
    }

    for (const entry of entries) {
      let fileType;
      try {
        fileType = await lstat(path.join(root, entry.name));
      } catch {
        continue;
      }
      const entryPath = path.join(root, entry.name);
      if (fileType.isSymbolicLink()) {
        skippedSymlinks += 1;
      } else if (fileType.isDirectory()) {
        directories.push(entryPath);
      } else if (fileType.isFile()) {
        files.push(entryPath);
      }
    }

    directories.sort((left, right) => left.localeCompare(right));
    files.sort((left, right) => left.localeCompare(right));

    let out = `[list]\npath: ${root}\ndirectories: ${directories.length}\nfiles: ${files.length}\nskipped_dirs: ${skippedDirs}\nskipped_symlinks: ${skippedSymlinks}\n\n`;

    if (directories.length === 0 && files.length === 0) {
      out += "(empty directory)";
    } else {
      if (directories.length > 0) {
        out += "directories\n";
        for (const directory of directories) {
          out += `${directory}\n`;
        }
        out += "\n";
      }
      if (files.length > 0) {
        out += "files\n";
        for (const file of files) {
          out += `${file}\n`;
        }
      }
    }

    return out;
  }

  private async executeReadFile(
    inputPath: string,
    offset?: number,
    limit?: number,
  ): Promise<HostToolExecutionOutput> {
    const target = await this.resolveReadFileTarget(inputPath);
    const canonical = target.canonicalPath;
    const errorPath = target.managed ? target.displayPath : canonical;

    let st;
    let bytes;
    try {
      st = await lstat(canonical);
      if (!st.isFile()) {
        throw new Error(`Not a file: ${errorPath}`);
      }

      bytes = await readFile(canonical);
    } catch (error) {
      if (error instanceof Error && error.message.includes(errorPath)) {
        throw error;
      }
      throw new Error(`Failed to read file: ${errorPath}`, { cause: error });
    }

    const image = detectSupportedImageFile(canonical, bytes);
    if (image) {
      return this.createImageToolOutput(
        "[read image]",
        `path: ${target.displayPath}`,
        canonical,
        image.mimeType,
      );
    }

    if (hasSupportedImageExtension(canonical)) {
      throw new Error(`Image file validation failed: ${errorPath}`);
    }

    const video = detectSupportedVideoFile(canonical, bytes);
    if (video) {
      return this.createVideoToolOutput(
        "[read video]",
        `path: ${target.displayPath}`,
        canonical,
        video.mimeType,
      );
    }

    if (hasSupportedVideoExtension(canonical)) {
      throw new Error(`Video file validation failed: ${errorPath}`);
    }

    if (bytes.includes(0)) {
      throw new Error(`Reading binary files as text is not supported: ${errorPath}`);
    }

    const content = bytes.toString("utf8");
    const start = offset ?? 1;
    if (start === 0) {
      throw new Error("offset is 1-based");
    }

    const lineLimit = limit ?? MAX_READ_LINES_DEFAULT;
    if (lineLimit < 1) {
      throw new Error("limit must be >= 1");
    }

    const end = start + lineLimit - 1;

    const lines = content.split(/\r?\n/u);
    const maxLine = Math.max(lines.length, 1);
    const s = Math.min(start, maxLine);
    const e = Math.min(end, maxLine);

    let out = `[read]\npath: ${target.displayPath}\nrange: ${s}-${e}\n\n`;
    for (let index = s; index <= e; index += 1) {
      const line = lines[index - 1] ?? "";
      out += `${String(index).padStart(6, " ")} | ${line}\n`;
    }
    return createHostToolTextOutput(out);
  }

  private async executeGlob(inputPattern: string): Promise<string> {
    const pattern = normalizeWorkspaceGlobPattern(inputPattern);
    const rawMatches = (
      await globPaths(pattern, {
        cwd: this.workspaceRoot,
        absolute: false,
        nodir: true,
        dot: true,
        windowsPathsNoEscape: true,
        ignore: [...SEARCH_IGNORE_DIR_NAMES].map((name) => `**/${name}/**`),
      })
    )
      .map((value) => value.replace(/\\/gu, "/"))
      .sort((left, right) => left.localeCompare(right));
    const matches = await filterWorkspaceFilePathsByIgnore(this.workspaceRoot, rawMatches);

    let out = `[glob]\npattern: ${pattern}\nmatches: ${matches.length}\n\n`;
    if (matches.length === 0) {
      out += "No files matched";
      return out;
    }

    for (const file of matches) {
      out += `${file}\n`;
    }
    return out;
  }

  private async executeSearchFiles(
    pattern: string,
    options: {
      caseInsensitive?: boolean;
      glob?: string;
      outputMode?: GrepToolOutputMode;
      headLimit?: number;
      offset?: number;
      lineNumbers?: boolean;
      afterContext?: number;
      beforeContext?: number;
      contextLines?: number;
      fileType?: string;
      includeIgnored?: boolean;
      multiline?: boolean;
    } = {},
  ): Promise<string> {
    const needle = pattern.trim();
    if (!needle) {
      throw new Error("search pattern must not be empty");
    }

    const globPattern =
      options.glob !== undefined && options.glob.trim() !== ""
        ? normalizeWorkspaceGlobPattern(options.glob)
        : null;

    const { matches, truncated } = await runRipgrepSearch({
      workspaceRoot: this.workspaceRoot,
      query: needle,
      isRegexp: true,
      caseSensitive: options.caseInsensitive !== true,
      globPattern,
      maxMatches: GREP_TOOL_MAX_MATCHES,
      ...(options.contextLines !== undefined ? { context: options.contextLines } : {}),
      ...(options.beforeContext !== undefined ? { beforeContext: options.beforeContext } : {}),
      ...(options.afterContext !== undefined ? { afterContext: options.afterContext } : {}),
      ...(options.fileType ? { fileType: options.fileType } : {}),
      ...(options.includeIgnored !== undefined ? { includeIgnored: options.includeIgnored } : {}),
      ...(options.multiline !== undefined ? { multiline: options.multiline } : {}),
    });

    const hasContext =
      (options.contextLines ?? 0) > 0 ||
      (options.beforeContext ?? 0) > 0 ||
      (options.afterContext ?? 0) > 0;

    return formatGrepToolOutput(matches, {
      ...(options.outputMode !== undefined ? { mode: options.outputMode } : {}),
      ...(options.lineNumbers !== undefined ? { lineNumbers: options.lineNumbers } : {}),
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
      ...(options.headLimit !== undefined ? { headLimit: options.headLimit } : {}),
      blockSeparators: hasContext,
      truncated,
    });
  }

  private async executeShell(
    command: string,
    options: { onOutputChunk?: (chunk: string) => void; toolCallId?: string } = {},
  ): Promise<string> {
    const shell = this.toolDefinitionEnvironment();
    const handle = runShell({
      workspaceRoot: this.workspaceRoot,
      command,
      ...(options.onOutputChunk ? { onOutputChunk: options.onOutputChunk } : {}),
    });
    const toolCallId = options.toolCallId?.trim();
    if (toolCallId) {
      this.activeShellKills.set(toolCallId, handle.kill);
    }
    let result;
    try {
      result = await handle.result;
    } finally {
      if (toolCallId) {
        this.activeShellKills.delete(toolCallId);
      }
    }

    return serializeShellToolResult(
      buildShellToolResult({
        terminal: shell.shellDisplayName,
        workspace: this.workspaceRoot,
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
    );
  }

  private createImageToolOutput(
    header: string,
    locationLine: string,
    imagePath: string,
    mimeType: string,
    extraLines: string[] = [],
  ): HostToolExecutionOutput {
    const summaryLines = [header, locationLine, ...extraLines, `mime_type: ${mimeType}`];
    const compatibilityProfile = this.getModelCompatibilityProfile?.();
    if (isImageInputBlocked(compatibilityProfile)) {
      return createHostToolTextOutput(
        [
          ...summaryLines,
          "",
          "This model does not support image input; the image file cannot be returned as image input.",
        ].join("\n"),
      );
    }

    return createHostToolOutput(
      [...summaryLines, "", "Image file returned as image input."].join("\n"),
      [{ type: "image", path: imagePath }],
    );
  }

  private createVideoToolOutput(
    header: string,
    locationLine: string,
    videoPath: string,
    mimeType: string,
    extraLines: string[] = [],
  ): HostToolExecutionOutput {
    const summaryLines = [header, locationLine, ...extraLines, `mime_type: ${mimeType}`];
    const compatibilityProfile = this.getModelCompatibilityProfile?.();
    if (isVideoInputBlocked(compatibilityProfile)) {
      return createHostToolTextOutput(
        [
          ...summaryLines,
          "",
          "This model does not support video input; the video file cannot be returned as video input.",
        ].join("\n"),
      );
    }

    return createHostToolOutput(
      [...summaryLines, "", "Video file returned as video input."].join("\n"),
      [{ type: "video", path: videoPath }],
    );
  }

  private async persistWebFetchedImage(bytes: Uint8Array, extension: string): Promise<string> {
    const cacheDir = path.join(this.spiritDataDir, WEB_FETCH_IMAGE_CACHE_DIR);
    await mkdir(cacheDir, { recursive: true });

    const filePath = path.join(cacheDir, `${Date.now()}-${randomUUID()}${extension}`);
    await writeFile(filePath, bytes);
    await this.prunePersistedWebFetchedImages(cacheDir);
    return filePath;
  }

  private async prunePersistedWebFetchedImages(cacheDir: string): Promise<void> {
    try {
      const entries = await readdir(cacheDir);
      const now = Date.now();
      const retained: Array<{ path: string; mtimeMs: number }> = [];

      for (const entry of entries) {
        const filePath = path.join(cacheDir, entry);
        try {
          const metadata = await lstat(filePath);
          if (!metadata.isFile()) {
            continue;
          }

          if (now - metadata.mtimeMs > WEB_FETCH_IMAGE_RETENTION_MS) {
            await unlink(filePath);
            continue;
          }

          retained.push({ path: filePath, mtimeMs: metadata.mtimeMs });
        } catch {
          // Cleanup failure must not affect this tool result.
        }
      }

      retained.sort((left, right) => right.mtimeMs - left.mtimeMs);
      for (const stale of retained.slice(WEB_FETCH_IMAGE_CACHE_MAX_FILES)) {
        try {
          await unlink(stale.path);
        } catch {
          // Cleanup failure must not affect this tool result.
        }
      }
    } catch {
      // Cleanup failure must not affect this tool result.
    }
  }

  private async executeWebFetch(url: string): Promise<HostToolExecutionOutput> {
    const parsedUrl = parseWebFetchUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(parsedUrl, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": WEB_FETCH_USER_AGENT,
          Accept: WEB_FETCH_ACCEPT_HEADER,
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      });
      const status = response.status;
      const finalUrl = response.url || parsedUrl;
      const contentType = response.headers.get("content-type") ?? "unknown";
      const imageExtension = inferSupportedImageExtensionFromWebResponse(finalUrl, contentType);
      const normalizedMimeType = normalizeMimeType(contentType);

      if (imageExtension || normalizedMimeType.startsWith("image/")) {
        if (!imageExtension) {
          throw new Error(`Unsupported image response from web fetch: ${contentType}`);
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        const image = detectSupportedImageFile(`web-fetch${imageExtension}`, bytes);
        if (!image) {
          throw new Error(`Web image validation failed: ${finalUrl}`);
        }

        const cachedImagePath = await this.persistWebFetchedImage(bytes, imageExtension);
        return this.createImageToolOutput(
          "[web image]",
          `url: ${parsedUrl}`,
          cachedImagePath,
          image.mimeType,
          [
            `final_url: ${finalUrl}`,
            `status: ${status}`,
            `content_type: ${contentType}`,
            `path: ${cachedImagePath}`,
          ],
        );
      }

      const raw = await response.text();
      return createHostToolTextOutput(
        convertFetchedPageToToolText({
          url: parsedUrl,
          finalUrl,
          status,
          contentType,
          raw,
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertCreateFileAllowed(resolvedPath: string): void {
    if (isPathUnderPlansDir(resolvedPath, this.context)) {
      throw new Error(
        "Use create_plan to create files under plans/; use edit_file to modify existing plan files.",
      );
    }
  }

  private async executeCreateFile(
    request: Extract<HostToolRequest<QuestionSpec>, { name: "create_file" }>,
  ): Promise<string> {
    const inputPath = request.path;
    const content = request.content;
    const target = this.resolveWorkspaceWriteTarget(inputPath);
    this.assertCreateFileAllowed(target);
    if (existsSync(target)) {
      throw new Error(`File already exists: ${target}`);
    }
    const before = await readHostFileSnapshot(target);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    const after = await readHostFileSnapshot(target);
    await this.recordFileChange(request, target, before, after);
    return `[write]\naction: create_file\npath: ${target}\nchars: ${[...content].length}`;
  }

  private async executeCreateAutomation(
    request: Extract<HostToolRequest<QuestionSpec>, { name: typeof CREATE_AUTOMATION_TOOL_NAME }>,
  ): Promise<string> {
    const defaults = this.getAutomationCreateDefaults?.();
    if (!defaults) {
      throw new Error("create_automation is only available on the Desktop host.");
    }
    const store = createHostAutomationStore(this.spiritDataDir);
    const definition = await store.create({
      title: request.title,
      overview: request.overview,
      trigger: request.trigger,
      workspaceRoot: defaults.workspaceRoot,
      modelRef: defaults.modelRef,
      ...(defaults.reasoningEffort ? { reasoningEffort: defaults.reasoningEffort } : {}),
      approvalLevel: request.approval_level,
      enabled: true,
    });
    this.onAutomationCreated?.(definition);
    return (
      `[automation]\n` +
      `action: create_automation\n` +
      `id: ${definition.id}\n` +
      `title: ${definition.title}\n` +
      `trigger: ${formatTriggerLabel(definition.trigger)}\n` +
      `workspace: ${definition.workspaceRoot}`
    );
  }

  private async executeCreatePlan(
    request: Extract<HostToolRequest<QuestionSpec>, { name: "create_plan" }>,
  ): Promise<string> {
    const content = request.content;
    const target = resolvePlanFilePath(this.context, request.plan_name);
    if (existsSync(target)) {
      throw new Error(`Plan file already exists: ${target}`);
    }
    const before = await readHostFileSnapshot(target);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    const after = await readHostFileSnapshot(target);
    await this.recordFileChange(request, target, before, after);
    return `[plan]\npath: ${target}\naction: create_plan\nchars: ${[...content].length}`;
  }

  private async executeEditFile(
    request: Extract<HostToolRequest<QuestionSpec>, { name: "edit_file" }>,
  ): Promise<string> {
    const inputPath = request.path;
    const oldText = request.old_text;
    const newText = request.new_text;
    if (!oldText.length) {
      throw new Error("edit_file old_text must not be empty");
    }
    const target = this.resolveWorkspaceWriteTarget(inputPath);
    if (!existsSync(target)) {
      throw new Error(`Path does not exist or is inaccessible: ${target}`);
    }
    const st = await lstat(target);
    if (!st.isFile()) {
      throw new Error(`Not a file: ${target}`);
    }

    const source = await readFile(target, "utf8");
    const before = await readHostFileSnapshot(target);
    const occurrences = countSubstringOccurrences(source, oldText);
    if (occurrences === 0) {
      const normalizedSource = normalizeLineEndings(source);
      const normalizedOld = normalizeLineEndings(oldText);
      const normalizedHits = countSubstringOccurrences(normalizedSource, normalizedOld);
      if (normalizedHits === 1) {
        const replaced = replaceSingleMatchAllowingNewlineDifferences(source, oldText, newText);
        if (replaced) {
          await writeFile(target, replaced.updated, "utf8");
          const after = await readHostFileSnapshot(target);
          await this.recordFileChange(request, target, before, after);
          return `[write]\naction: edit_file\npath: ${target}\nreplaced_once: true\nmatch_mode: normalized_newlines\nold_chars: ${[...oldText].length}\nnew_chars: ${[...newText].length}`;
        }
      }
      throw new Error("edit_file failed: old_text did not match the target file");
    }
    if (occurrences > 1) {
      throw new Error(
        `edit_file failed: old_text matched ${occurrences} times; provide a more specific snippet`,
      );
    }

    await writeFile(target, source.replace(oldText, newText), "utf8");
    const after = await readHostFileSnapshot(target);
    await this.recordFileChange(request, target, before, after);
    return `[write]\naction: edit_file\npath: ${target}\nreplaced_once: true\nold_chars: ${[...oldText].length}\nnew_chars: ${[...newText].length}`;
  }

  private async executeApplyPatch(
    request: Extract<HostToolRequest<QuestionSpec>, { name: typeof APPLY_PATCH_HOST_TOOL_NAME }>,
  ): Promise<HostToolExecutionOutput> {
    const { operation } = request;
    switch (operation.type) {
      case "create_file": {
        if (operation.diff === undefined || operation.diff.trim().length === 0) {
          throw new Error("apply_patch create_file requires a non-empty diff");
        }
        const content = applyDiff("", operation.diff, "create");
        const summary = await this.executeCreateFile({
          name: "create_file",
          path: operation.path,
          content,
        });
        return hostOutputWithFileChangeDiff(summary, {
          path: operation.path,
          before: "",
          after: content,
        });
      }
      case "update_file": {
        if (operation.diff === undefined || operation.diff.trim().length === 0) {
          throw new Error("apply_patch update_file requires a non-empty diff");
        }
        const inputPath = operation.path;
        const target = this.resolveWorkspaceWriteTarget(inputPath);
        if (!existsSync(target)) {
          throw new Error(`Path does not exist or is inaccessible: ${target}`);
        }
        const st = await lstat(target);
        if (!st.isFile()) {
          throw new Error(`Not a file: ${target}`);
        }
        const source = await readFile(target, "utf8");
        const before = await readHostFileSnapshot(target);
        const updated = applyDiff(source, operation.diff);
        await writeFile(target, updated, "utf8");
        const after = await readHostFileSnapshot(target);
        await this.recordWritableFileChange(request, target, before, after, "edit_file", {
          name: "edit_file",
          path: operation.path,
          oldChars: [...source].length,
          newChars: [...updated].length,
        });
        return hostOutputWithFileChangeDiff(
          `[write]\naction: apply_patch\noperation: update_file\npath: ${target}\nold_chars: ${[...source].length}\nnew_chars: ${[...updated].length}`,
          { path: operation.path, before: source, after: updated },
        );
      }
      case "delete_file": {
        // Read the doomed content before unlink so the tool card can render a real delete diff.
        const target = this.resolveWorkspaceWriteTarget(operation.path);
        const doomed = await readFile(target, "utf8").catch(() => undefined);
        const summary = await this.executeDeleteFile({
          name: "delete_file",
          path: operation.path,
        });
        if (doomed === undefined) {
          return createHostToolTextOutput(summary);
        }
        return hostOutputWithFileChangeDiff(summary, {
          path: operation.path,
          before: doomed,
          after: "",
        });
      }
      default:
        throw new Error(
          `Unsupported apply_patch operation: ${(operation as ApplyPatchOperation).type}`,
        );
    }
  }

  private async executeDeleteFile(
    request: Extract<HostToolRequest<QuestionSpec>, { name: "delete_file" }>,
  ): Promise<string> {
    const inputPath = request.path;
    const target = this.resolveWorkspaceWriteTarget(inputPath);
    if (!existsSync(target)) {
      throw new Error(`Path does not exist or is inaccessible: ${target}`);
    }
    const st = await lstat(target);
    if (!st.isFile()) {
      throw new Error(`Not a file: ${target}`);
    }
    const before = await readHostFileSnapshot(target);
    await unlink(target);
    const after = await readHostFileSnapshot(target);
    await this.recordFileChange(request, target, before, after);
    return `[write]\naction: delete_file\npath: ${target}`;
  }

  private async recordWritableFileChange(
    request: HostWritableFileToolRequest<QuestionSpec>,
    resolvedPath: string,
    before: HostRecordedFileChange["before"],
    after: HostRecordedFileChange["after"],
    kind: HostFileChangeKind,
    summary: HostFileChangeRequestSummary,
  ): Promise<void> {
    if (!this.fileChangeObserver) {
      return;
    }

    const metadata = this.requestMetadataFor(request);
    const change: HostRecordedFileChange = {
      kind,
      path: summary.path,
      resolvedPath,
      toolName: metadata?.toolName ?? request.name,
      ...(metadata?.toolCallId ? { toolCallId: metadata.toolCallId } : {}),
      ...(metadata?.subagentSessionId ? { subagentSessionId: metadata.subagentSessionId } : {}),
      ...(metadata?.subagentTitle ? { subagentTitle: metadata.subagentTitle } : {}),
      request: summary,
      before,
      after,
      createdAtUnixMs: Date.now(),
    };

    try {
      await this.fileChangeObserver.recordFileChange(change);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `File change was written, but recording the rewind snapshot failed: ${message}`,
        { cause: error },
      );
    }
  }

  private async recordFileChange(
    request: HostFileToolRequest<QuestionSpec>,
    resolvedPath: string,
    before: HostRecordedFileChange["before"],
    after: HostRecordedFileChange["after"],
  ): Promise<void> {
    const changeKind: HostFileChangeKind =
      request.name === "create_plan" ? "create_file" : request.name;
    await this.recordWritableFileChange(
      request,
      resolvedPath,
      before,
      after,
      changeKind,
      summarizeFileToolRequest(request),
    );
  }

  private requestMetadataFor(
    request: HostToolRequest<QuestionSpec>,
  ): HostToolRequestMetadata | undefined {
    if (typeof request !== "object" || request === null) {
      return undefined;
    }
    return this.requestMetadata.get(request);
  }
}

function summarizeFileToolRequest<QuestionSpec>(
  request: HostFileToolRequest<QuestionSpec>,
): HostFileChangeRequestSummary {
  switch (request.name) {
    case "create_file":
      return {
        name: request.name,
        path: request.path,
        contentChars: [...request.content].length,
      };
    case "create_plan":
      return {
        name: "create_file",
        path: request.plan_name,
        contentChars: [...request.content].length,
      };
    case "edit_file":
      return {
        name: request.name,
        path: request.path,
        oldChars: [...request.old_text].length,
        newChars: [...request.new_text].length,
      };
    case "delete_file":
      return {
        name: request.name,
        path: request.path,
      };
  }
}

/** Session-memory key: exact shell command text or canonical read path, domain-prefixed. */
function sessionApprovalKey(target: PermissionMemoryTarget): string {
  return target.kind === "shell" ? `shell:${target.command}` : `read_file:${target.path}`;
}

function parseJsonObject(argumentsJson: string): HostJsonObject {
  if (argumentsJson.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(argumentsJson) as HostJsonValue;
  if (!isJsonObject(parsed)) {
    throw new Error("Tool arguments must be an object.");
  }
  return parsed;
}

function parseTodoWriteItems(parsed: HostJsonObject): HostTodoItem[] {
  const rawItems = parsed.todos;
  if (!Array.isArray(rawItems)) {
    throw new Error("todos must be an array.");
  }
  return rawItems.map((entry, index) => {
    if (!isJsonObject(entry)) {
      throw new Error(`todos[${index}] must be an object.`);
    }
    const statusRaw = requiredString(entry, "status");
    if (statusRaw !== "pending" && statusRaw !== "in_progress" && statusRaw !== "completed") {
      throw new Error(`todos[${index}].status is invalid: ${statusRaw}`);
    }
    const idRaw = entry.id;
    const id = typeof idRaw === "string" && idRaw.trim().length > 0 ? idRaw.trim() : undefined;
    return {
      ...(id ? { id } : {}),
      title: requiredString(entry, "title"),
      status: statusRaw,
    };
  });
}

function parseApplyPatchOperation(parsed: HostJsonObject): ApplyPatchOperation {
  const operationRaw = parsed.operation;
  if (typeof operationRaw !== "object" || operationRaw === null || Array.isArray(operationRaw)) {
    throw new Error("apply_patch requires an operation object");
  }

  const operation = operationRaw as HostJsonObject;
  const type = requiredString(operation, "type");
  if (type !== "create_file" && type !== "update_file" && type !== "delete_file") {
    throw new Error(`apply_patch operation.type is invalid: ${type}`);
  }

  const path = requiredString(operation, "path");
  const diff = optionalStringStrict(operation, "diff");
  return {
    type,
    path,
    ...(diff !== undefined ? { diff } : {}),
  };
}

function requiredString(obj: HostJsonObject, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Field ${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(obj: HostJsonObject, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalStringStrict(obj: HostJsonObject, key: string): string | undefined {
  if (!(key in obj) || obj[key] === null) {
    return undefined;
  }
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalPositiveInt(obj: HostJsonObject, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Field ${key} must be an integer`);
  }
  const n = Math.trunc(value);
  if (n < 1) {
    throw new Error(`Field ${key} must be >= 1`);
  }
  return n;
}

function optionalBoolean(obj: HostJsonObject, key: string): boolean | undefined {
  const value = obj[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalNonNegativeInt(obj: HostJsonObject, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Field ${key} must be an integer`);
  }
  const n = Math.trunc(value);
  if (n < 0) {
    throw new Error(`Field ${key} must be >= 0`);
  }
  return n;
}

function optionalGrepOutputMode(obj: HostJsonObject, key: string): GrepToolOutputMode | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === "content" || value === "files_with_matches" || value === "count_matches") {
    return value;
  }
  throw new Error(`Field ${key} must be one of: content, files_with_matches, count_matches`);
}

function normalizeWorkspaceGlobPattern(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("pattern must not be empty");
  }

  const normalized = trimmed.replace(/\\/gu, "/").replace(/^(?:\.\/)+/u, "");
  if (!normalized) {
    throw new Error("pattern must not be empty");
  }
  if (path.win32.isAbsolute(trimmed) || path.posix.isAbsolute(normalized)) {
    throw new Error(`glob only accepts workspace-relative patterns: ${trimmed}`);
  }
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(`glob pattern must not escape the workspace: ${trimmed}`);
  }
  return normalized;
}

function isImageInputBlocked(profile: HostToolModelCompatibilityProfile | undefined): boolean {
  return profile?.hasExplicitCapabilities === true && profile.capabilities.imageInput !== true;
}

function isVideoInputBlocked(profile: HostToolModelCompatibilityProfile | undefined): boolean {
  return profile?.hasExplicitCapabilities === true && profile.capabilities.videoInput !== true;
}

function optionalStringArrayStrict(obj: HostJsonObject, key: string): string[] {
  if (!(key in obj) || obj[key] === null) {
    return [];
  }
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${key}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
}

function optionalStringArrayPatch(obj: HostJsonObject, key: string): string[] | undefined {
  if (!(key in obj) || obj[key] === null) {
    return undefined;
  }
  return optionalStringArrayStrict(obj, key);
}

function parseAskQuestionsRequest(
  obj: HostJsonObject,
): HostToolRequest<HostAskQuestionsQuestionSpec> {
  const questionsValue = obj.questions;
  if (!Array.isArray(questionsValue) || questionsValue.length === 0) {
    throw new Error("ask_questions requires at least one question");
  }

  const questions = questionsValue.map((item, index) => parseQuestion(item, index));
  validateQuestions(questions);

  const title = optionalString(obj, "title");
  return {
    name: "ask_questions",
    ...(title ? { title } : {}),
    questions,
  };
}

function parseQuestion(value: HostJsonValue, index: number): HostAskQuestionsQuestionSpec {
  if (!isJsonObject(value)) {
    throw new Error(`questions[${index}] must be an object.`);
  }

  const optionsValue = value.options;
  const options = Array.isArray(optionsValue)
    ? optionsValue.map((option, optionIndex) => {
        if (!isJsonObject(option)) {
          throw new Error(`questions[${index}].options[${optionIndex}] must be an object.`);
        }
        const summary = optionalString(option, "summary");
        const parsedOption: HostAskQuestionsOptionSpec = {
          id: requiredString(option, "id"),
          label: requiredString(option, "label"),
        };
        if (summary) {
          parsedOption.summary = summary;
        }
        return parsedOption;
      })
    : [];

  return {
    id: requiredString(value, "id"),
    title: requiredString(value, "title"),
    allowMultiple: optionalBoolean(value, "allowMultiple") ?? false,
    options,
  };
}

function validateQuestions(questions: HostAskQuestionsQuestionSpec[]): void {
  const seenIds = new Set<string>();
  for (const question of questions) {
    const id = question.id.trim();
    if (!id) {
      throw new Error("ask_questions question id must not be empty");
    }
    if (seenIds.has(id)) {
      throw new Error(`ask_questions question id must be unique: ${id}`);
    }
    seenIds.add(id);
    if (!question.title.trim()) {
      throw new Error(`ask_questions question title must not be empty: ${id}`);
    }

    const seenOptionIds = new Set<string>();
    for (const option of question.options) {
      const optionId = option.id.trim();
      if (!optionId) {
        throw new Error(`ask_questions option id must not be empty: ${id}`);
      }
      if (seenOptionIds.has(optionId)) {
        throw new Error(`ask_questions option id must be unique: ${id}/${optionId}`);
      }
      seenOptionIds.add(optionId);
      if (!option.label.trim()) {
        throw new Error(`ask_questions option label must not be empty: ${id}`);
      }
    }
  }
}

function countSubstringOccurrences(haystack: string, needle: string): number {
  if (!needle.length) {
    return 0;
  }
  let count = 0;
  let pos = 0;
  while (pos <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) {
      break;
    }
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}

function parseWebFetchUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `web_fetch only supports http/https; got scheme: ${parsed.protocol.replace(":", "")}`,
    );
  }
  return parsed.toString();
}

function inferSupportedImageExtensionFromWebResponse(
  finalUrl: string,
  contentType: string,
): string | undefined {
  const mimeType = normalizeMimeType(contentType);
  switch (mimeType) {
    case "image/bmp":
      return ".bmp";
    case "image/gif":
      return ".gif";
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
      return ".ico";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      break;
  }

  try {
    const extension = path.extname(new URL(finalUrl).pathname).toLowerCase();
    return hasSupportedImageExtension(`file${extension}`) ? extension : undefined;
  } catch {
    return undefined;
  }
}

function buildExtensionQuestionsAuthorization<QuestionSpec>(
  request: Extract<HostToolRequest<QuestionSpec>, { name: "extension_tool" }>,
): HostAuthorizationDecision<QuestionSpec> {
  return {
    kind: "need-questions",
    questions: {
      title: `Additional execution info for extension tool: ${request.tool_name}`,
      questions: [
        {
          id: "execution_note",
          title: "Additional execution notes",
          allowMultiple: false,
          options: [],
        } as QuestionSpec,
      ],
    },
  };
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function lineEndingStyle(text: string): "none" | "crlf" | "lf" | "cr" | "mixed" {
  const hasCrlf = text.includes("\r\n");
  const normalized = text.replace(/\r\n/g, "");
  const hasLf = normalized.includes("\n");
  const hasCr = normalized.includes("\r");
  if (!hasCrlf && !hasLf && !hasCr) {
    return "none";
  }
  if (hasCrlf && !hasLf && !hasCr) {
    return "crlf";
  }
  if (!hasCrlf && hasLf && !hasCr) {
    return "lf";
  }
  if (!hasCrlf && !hasLf && hasCr) {
    return "cr";
  }
  return "mixed";
}

function rewriteLineEndings(text: string, targetStyle: "crlf" | "lf" | "cr"): string {
  const normalized = normalizeLineEndings(text);
  if (targetStyle === "crlf") {
    return normalized.replace(/\n/g, "\r\n");
  }
  if (targetStyle === "cr") {
    return normalized.replace(/\n/g, "\r");
  }
  return normalized;
}

function preferredLineEndingStyle(matchedSlice: string, source: string): "crlf" | "lf" | "cr" {
  const matchedStyle = lineEndingStyle(matchedSlice);
  if (matchedStyle === "crlf" || matchedStyle === "lf" || matchedStyle === "cr") {
    return matchedStyle;
  }
  const sourceStyle = lineEndingStyle(source);
  if (sourceStyle === "crlf" || sourceStyle === "cr") {
    return sourceStyle;
  }
  return "lf";
}

function normalizedByteOffsetsToSourceByteOffsets(source: string): number[] {
  const bytes = Buffer.from(source, "utf8");
  const mapping: number[] = [0];
  let index = 0;
  while (index < bytes.length) {
    if (bytes[index] === 0x0d && index + 1 < bytes.length && bytes[index + 1] === 0x0a) {
      mapping.push(index + 2);
      index += 2;
    } else if (bytes[index] === 0x0d) {
      mapping.push(index + 1);
      index += 1;
    } else {
      mapping.push(index + 1);
      index += 1;
    }
  }
  return mapping;
}

function replaceSingleMatchAllowingNewlineDifferences(
  source: string,
  oldText: string,
  newText: string,
): { updated: string } | undefined {
  const normalizedSource = normalizeLineEndings(source);
  const normalizedOld = normalizeLineEndings(oldText);
  const nBuf = Buffer.from(normalizedSource, "utf8");
  const oBuf = Buffer.from(normalizedOld, "utf8");
  const matches: number[] = [];
  if (!oBuf.length) {
    return undefined;
  }
  for (let index = 0; index <= nBuf.length - oBuf.length; index += 1) {
    if (nBuf.subarray(index, index + oBuf.length).equals(oBuf)) {
      matches.push(index);
    }
  }
  if (matches.length !== 1) {
    return undefined;
  }
  const normalizedStart = matches[0]!;
  const mapping = normalizedByteOffsetsToSourceByteOffsets(source);
  const normalizedEnd = normalizedStart + oBuf.length;
  const sourceStart = mapping[normalizedStart];
  const sourceEnd = mapping[normalizedEnd];
  if (sourceStart === undefined || sourceEnd === undefined) {
    return undefined;
  }
  const matchedBytes = Buffer.from(source, "utf8").subarray(sourceStart, sourceEnd);
  const matchedSlice = matchedBytes.toString("utf8");
  const replacement = rewriteLineEndings(newText, preferredLineEndingStyle(matchedSlice, source));
  const prefix = Buffer.from(source, "utf8").subarray(0, sourceStart).toString("utf8");
  const suffix = Buffer.from(source, "utf8").subarray(sourceEnd).toString("utf8");
  return { updated: `${prefix}${replacement}${suffix}` };
}

function truncateChars(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) {
    return value;
  }
  return chars.slice(0, maxChars).join("");
}

function detectGeneratedImageType(
  mediaType: string,
  bytes: Uint8Array,
): { extension: string; mimeType: string } {
  const normalizedMediaType = mediaType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const preferredExtension = imageExtensionForMediaType(normalizedMediaType);
  if (preferredExtension && detectSupportedImageFile(`generated${preferredExtension}`, bytes)) {
    return {
      extension: preferredExtension,
      mimeType: mimeTypeForImageExtension(preferredExtension) ?? "image/png",
    };
  }

  for (const extension of [".png", ".jpg", ".webp", ".gif", ".bmp", ".ico"] as const) {
    const detected = detectSupportedImageFile(`generated${extension}`, bytes);
    if (detected) {
      return {
        extension: detected.extension,
        mimeType: detected.mimeType,
      };
    }
  }

  const fallbackExtension = preferredExtension ?? ".png";
  return {
    extension: fallbackExtension,
    mimeType: mimeTypeForImageExtension(fallbackExtension) ?? "image/png",
  };
}

function imageExtensionForMediaType(mediaType: string): string | undefined {
  switch (mediaType) {
    case "image/bmp":
      return ".bmp";
    case "image/gif":
      return ".gif";
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
      return ".ico";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return undefined;
  }
}

function mimeTypeForImageExtension(extension: string): string | undefined {
  switch (extension) {
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".jpg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return undefined;
  }
}

function detectGeneratedVideoType(
  mediaType: string,
  bytes: Uint8Array,
): { extension: string; mimeType: string } {
  const normalizedMediaType = mediaType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const preferredExtension = videoExtensionForMediaType(normalizedMediaType);
  if (preferredExtension && detectSupportedVideoFile(`generated${preferredExtension}`, bytes)) {
    return {
      extension: preferredExtension,
      mimeType: mimeTypeForVideoExtension(preferredExtension) ?? "video/mp4",
    };
  }

  for (const extension of [".mp4", ".webm", ".mov", ".mpeg", ".mpg"] as const) {
    const detected = detectSupportedVideoFile(`generated${extension}`, bytes);
    if (detected) {
      return {
        extension: detected.extension,
        mimeType: detected.mimeType,
      };
    }
  }

  const fallbackExtension = preferredExtension ?? ".mp4";
  return {
    extension: fallbackExtension,
    mimeType: mimeTypeForVideoExtension(fallbackExtension) ?? "video/mp4",
  };
}

function videoExtensionForMediaType(mediaType: string): string | undefined {
  switch (mediaType) {
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "video/quicktime":
      return ".mov";
    case "video/mpeg":
      return ".mpeg";
    default:
      return undefined;
  }
}

function mimeTypeForVideoExtension(extension: string): string | undefined {
  switch (extension) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mpeg":
    case ".mpg":
      return "video/mpeg";
    default:
      return undefined;
  }
}

function isJsonObject(value: HostJsonValue): value is HostJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSpiritDataInternalReadPath(resolvedPath: string, spiritDataDir: string): boolean {
  // Part of the built-in no-rule read fallback (see isAllowedReadLocation):
  // Spirit's own transcripts / tool-output archives stay readable without a rule.
  const resolvedSpiritDataDir = path.resolve(spiritDataDir);
  const allowedRoots = [
    resolveTranscriptsDir(resolvedSpiritDataDir),
    resolveToolOutputArchivesDir(resolvedSpiritDataDir),
  ];
  return allowedRoots.some((allowed) => pathHasPrefix(resolvedPath, allowed));
}

function isInsideSpiritManagedUserArea(
  resolvedPath: string,
  context: InstructionDiscoveryContext,
): boolean {
  // Built-in no-rule read fallback: user rules, plans and user skills.
  const paths = resolveInstructionPaths({
    workspaceRoot: context.workspaceRoot,
    spiritDataDir: context.spiritDataDir,
  });
  return [paths.userRuleFile, paths.plansDir, paths.userSkillsDir]
    .map((allowed) => path.resolve(allowed))
    .some((allowed) => pathHasPrefix(resolvedPath, allowed));
}

function pathCompareKey(inputPath: string): string {
  let normalized = path.resolve(inputPath).replace(/\\/gu, "/");
  if (normalized.startsWith("//?/UNC/")) {
    normalized = `//${normalized.slice("//?/UNC/".length)}`;
  } else if (normalized.startsWith("//?/")) {
    normalized = normalized.slice("//?/".length);
  }
  return normalized.replace(/\/+$/u, "");
}

function pathHasPrefix(candidate: string, prefix: string): boolean {
  const c = pathCompareKey(candidate);
  const p = pathCompareKey(prefix);
  return c === p || c.startsWith(`${p}/`);
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let buffer = "";
  let inQuotes = false;

  for (const character of input) {
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (/\s/u.test(character) && !inQuotes) {
      if (buffer.length > 0) {
        tokens.push(buffer);
        buffer = "";
      }
      continue;
    }
    buffer += character;
  }

  if (buffer.length > 0) {
    tokens.push(buffer);
  }

  return tokens;
}

function parseOptionalManualLine(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} is invalid: ${value}`);
  }
  return parsed;
}
