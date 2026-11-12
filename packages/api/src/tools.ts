import {
  APPLY_PATCH_HOST_TOOL_NAME,
  type BackgroundOptions,
  type PermissionMemoryTarget,
  type ToolApprovalRequest,
  type ToolExecutionHostUi,
} from "@spiritagent/agent-core";
import {
  CREATE_AUTOMATION_TOOL_NAME,
  type CreateAutomationApprovalLevel,
} from "@spiritagent/automations/automation-host-tool";
import type { HostAutomationTrigger } from "@spiritagent/automations";

export type GrepToolOutputMode = "content" | "files_with_matches" | "count_matches";

export interface HostTodoScope {
  sessionKey: string;
}

export type HostTodoStatus = "pending" | "in_progress" | "completed";

export interface HostTodoItem {
  id?: string;
  title: string;
  status: HostTodoStatus;
}

export interface HostToolRequestMetadata {
  toolCallId?: string;
  toolName?: string;
  subagentSessionId?: string;
  subagentTitle?: string;
  userInitiated?: boolean;
  /** In-process only; not serialized across host bridge IPC. */
  onOutputChunk?: (chunk: string) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface HostBuiltinToolDefinitionEnvironment {
  shellDisplayName: string;
  commandParameterDescription: string;
}

export interface HostOperatingSystemInfo {
  name: string;
  version: string;
}

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
  documentInput?: true;
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
  execution?: { failed?: boolean; exitCode?: number };
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
  prompt: string;
  sessionId?: string;
  worktree?: boolean;
  background?: BackgroundOptions;
}

export type ApplyPatchOperationType = "create_file" | "update_file" | "delete_file";

export interface ApplyPatchOperation {
  type: ApplyPatchOperationType;
  path: string;
  diff?: string;
}

export type HostToolRequest<QuestionSpec = HostAskQuestionsQuestionSpec> =
  | { name: "finish_task"; summary?: string }
  | { name: "delay"; seconds?: number; task_id?: string }
  | { name: "stop_task"; task_id: string }
  | { name: "shell"; command: string; reason: string; background?: BackgroundOptions }
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
      prompt: string;
      sessionId?: string;
      worktree?: boolean;
      background?: BackgroundOptions;
    }
  | {
      name: "generate_image";
      prompt: string;
      size?: string;
      count?: number;
      output_format?: "webp" | "png" | "jpeg";
      reasoning_strength?: "low" | "high";
      response_format?: "b64_json" | "url";
      reference_images?: string[];
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
  manager: HostToolExtensionManager<THostApi>;
  getHost(): THostApi;
  logger?: Pick<Console, "error" | "log">;
}

type HostExtensionToolApprovalMode = "allowed" | "need-approval" | "need-questions";
type HostExtensionToolExecutionMode = "foreground" | "background";

export interface HostToolExtensionManager<THostApi> {
  resolveTool(name: string): Promise<
    | {
        extensionId: string;
        tool: {
          name: string;
          approvalMode?: HostExtensionToolApprovalMode;
          executionMode?: HostExtensionToolExecutionMode;
        };
      }
    | undefined
  >;
  invokeTool(request: {
    extensionId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    host: THostApi;
    logger?: Pick<Console, "error" | "log">;
    toolCallId?: string;
    questionsResult?: unknown;
  }): Promise<string>;
}
