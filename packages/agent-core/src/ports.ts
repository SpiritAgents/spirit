export type AgentMode = "agent" | "plan" | "ask" | "debug";

export function normalizeAgentMode(input?: { agentMode?: unknown; planMode?: boolean }): AgentMode {
  if (
    input?.agentMode === "agent" ||
    input?.agentMode === "plan" ||
    input?.agentMode === "ask" ||
    input?.agentMode === "debug"
  ) {
    return input.agentMode;
  }
  return input?.planMode === true ? "plan" : "agent";
}

export function readAgentModeFromTransportConfig(
  config: { agentMode?: AgentMode; planMode?: boolean } | undefined,
): AgentMode {
  if (
    config?.agentMode === "agent" ||
    config?.agentMode === "plan" ||
    config?.agentMode === "ask" ||
    config?.agentMode === "debug"
  ) {
    return config.agentMode;
  }
  return config?.planMode === true ? "plan" : "agent";
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface LlmToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface LlmTextContentPart extends JsonObject {
  type: "text";
  text: string;
}

export interface LlmImageContentPart extends JsonObject {
  type: "image";
  path: string;
}

export interface LlmVideoContentPart extends JsonObject {
  type: "video";
  path: string;
}

export type LlmContentPart = LlmTextContentPart | LlmImageContentPart | LlmVideoContentPart;
export type LlmMessageContent = LlmContentPart[];

export interface LlmMessage {
  role: ChatRole;
  content: LlmMessageContent;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
  providerState?: JsonObject;
}

export interface LegacyLlmMessageArchiveEntry {
  role: ChatRole;
  content: string;
  imagePaths?: string[];
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
  providerState?: JsonObject;
}

export interface StoredLlmMessageArchiveEntry {
  role: ChatRole;
  content: LlmMessageContent;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
  providerState?: JsonObject;
}

function cloneLlmToolCalls(toolCalls: readonly LlmToolCall[]): LlmToolCall[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    argumentsJson: toolCall.argumentsJson,
  }));
}

export function cloneLlmProviderState(providerState: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(providerState).map(([key, value]) => [key, cloneJsonValue(value)]),
  );
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }
  if (typeof value === "object" && value !== null) {
    return cloneLlmProviderState(value);
  }
  return value;
}

export interface ToolExecutionOutput {
  content: LlmMessageContent;
  summaryText: string;
  hostUi?: ToolExecutionHostUi;
}

export interface ToolExecutionHostUi {
  lspWriteDiagnostics?: import("./lsp/types.js").LspWriteDiagnosticsUi;
}

export const DEFAULT_IMAGE_GENERATION_SIZE = "1024x1024";
export const DEFAULT_VIDEO_GENERATION_DURATION = 5;

export interface ImageGenerationRequest {
  prompt: string;
  size: string;
}

export interface VideoGenerationRequest {
  prompt: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
}

export interface GeneratedImageSaveRequest {
  data: Uint8Array;
  mediaType: string;
  prompt: string;
  model: string;
}

export interface GeneratedImageFile {
  path: string;
  mimeType: string;
  markdownRef: string;
}

export interface GeneratedVideoSaveRequest {
  data: Uint8Array;
  mediaType: string;
  prompt: string;
  model: string;
}

export interface GeneratedVideoFile {
  path: string;
  mimeType: string;
  markdownRef: string;
}

export function createToolExecutionTextOutput(text: string): ToolExecutionOutput {
  return {
    content: createLlmMessageContentFromText(text),
    summaryText: text,
  };
}

export function createLlmTextContentPart(text: string): LlmTextContentPart {
  return { type: "text", text };
}

export function createLlmImageContentPart(path: string): LlmImageContentPart {
  return { type: "image", path };
}

export function createLlmVideoContentPart(path: string): LlmVideoContentPart {
  return { type: "video", path };
}

export function createLlmMessageContentFromText(text: string): LlmMessageContent {
  return text.length > 0 ? [createLlmTextContentPart(text)] : [];
}

export function createLlmMessageContentFromTextAndImages(
  text: string,
  imagePaths: readonly string[] = [],
  videoPaths: readonly string[] = [],
): LlmMessageContent {
  const content: LlmMessageContent = [];
  if (text.length > 0) {
    content.push(createLlmTextContentPart(text));
  }
  for (const imagePath of imagePaths) {
    content.push(createLlmImageContentPart(imagePath));
  }
  for (const videoPath of videoPaths) {
    content.push(createLlmVideoContentPart(videoPath));
  }
  return content;
}

export function cloneLlmMessageContent(content: readonly LlmContentPart[]): LlmMessageContent {
  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }

    if (part.type === "video") {
      return { type: "video", path: part.path };
    }

    return { type: "image", path: part.path };
  });
}

export function llmMessageTextContent(content: readonly LlmContentPart[]): string {
  return content
    .filter((part): part is LlmTextContentPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function llmMessageImagePaths(content: readonly LlmContentPart[]): string[] {
  return content
    .filter((part): part is LlmImageContentPart => part.type === "image")
    .map((part) => part.path);
}

export function llmMessageHasImages(content: readonly LlmContentPart[]): boolean {
  return content.some((part) => part.type === "image");
}

export function llmMessageVideoPaths(content: readonly LlmContentPart[]): string[] {
  return content
    .filter((part): part is LlmVideoContentPart => part.type === "video")
    .map((part) => part.path);
}

export function llmMessageHasVideos(content: readonly LlmContentPart[]): boolean {
  return content.some((part) => part.type === "video");
}

export function llmMessageHasMedia(content: readonly LlmContentPart[]): boolean {
  return llmMessageHasImages(content) || llmMessageHasVideos(content);
}

export function llmMessageHasText(content: readonly LlmContentPart[]): boolean {
  return content.some((part) => part.type === "text" && part.text.trim().length > 0);
}

export function llmMessageContentWithoutImages(
  content: readonly LlmContentPart[],
): LlmMessageContent {
  return content
    .filter((part): part is LlmTextContentPart => part.type === "text")
    .map((part) => ({ type: "text", text: part.text }));
}

export function normalizeStoredLlmMessage(
  message: StoredLlmMessageArchiveEntry | LegacyLlmMessageArchiveEntry,
): LlmMessage {
  const toolCallId =
    "toolCallId" in message && typeof message.toolCallId === "string"
      ? message.toolCallId
      : "tool_call_id" in message && typeof message.tool_call_id === "string"
        ? message.tool_call_id
        : undefined;
  const toolCalls =
    "toolCalls" in message && Array.isArray(message.toolCalls)
      ? cloneLlmToolCalls(message.toolCalls)
      : "tool_calls" in message && Array.isArray(message.tool_calls)
        ? cloneLlmToolCalls(message.tool_calls)
        : undefined;
  const providerState =
    "providerState" in message &&
    typeof message.providerState === "object" &&
    message.providerState !== null
      ? cloneLlmProviderState(message.providerState)
      : "provider_state" in message &&
          typeof message.provider_state === "object" &&
          message.provider_state !== null
        ? cloneLlmProviderState(message.provider_state as JsonObject)
        : undefined;

  if (Array.isArray(message.content)) {
    return {
      role: message.role,
      content: cloneLlmMessageContent(message.content),
      ...(toolCallId !== undefined ? { toolCallId } : {}),
      ...(toolCalls !== undefined ? { toolCalls } : {}),
      ...(providerState !== undefined ? { providerState } : {}),
    };
  }

  return {
    role: message.role,
    content: createLlmMessageContentFromTextAndImages(
      message.content,
      "imagePaths" in message ? (message.imagePaths ?? []) : [],
    ),
    ...(toolCallId !== undefined ? { toolCallId } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(providerState !== undefined ? { providerState } : {}),
  };
}

export interface AssistantAuxArchiveEntry {
  messageIndex: number;
  thinking?: string;
  compaction?: string;
  finishTaskNotice?: string;
}

export type SubagentSessionStatus =
  | "bootstrapping"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export interface SubagentSessionSummary {
  sessionId: string;
  parentToolCallId: string;
  title: string;
  status: SubagentSessionStatus;
  startedAtUnixMs: number;
  updatedAtUnixMs: number;
  completedAtUnixMs?: number;
  latestMessage?: string;
  finalOutput?: string;
  error?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

export interface SubagentSessionArchiveEntry {
  summary: SubagentSessionSummary;
  llmHistory: Array<StoredLlmMessageArchiveEntry | LegacyLlmMessageArchiveEntry>;
}

export interface DreamScope {
  workspaceRoot: string;
  gitBranch: string;
}

export type DreamRecordStatus = "active" | "superseded" | "deleted";

export interface DreamSourceSessionRef {
  path: string;
  displayName?: string;
  savedAtUnixMs?: number;
}

export interface DreamRecord {
  id: string;
  scope: DreamScope;
  title: string;
  summary: string;
  details?: string;
  tags?: string[];
  status: DreamRecordStatus;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  expiresAtUnixMs: number;
  sourceSessions: DreamSourceSessionRef[];
}

export interface DreamQuery {
  scope: DreamScope;
  nowUnixMs?: number;
  includeExpired?: boolean;
  includeDeleted?: boolean;
}

export type DreamCollectorRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "backoff";

export type DreamCollectorDecision = "created" | "updated" | "deleted" | "unchanged" | "skipped";

export interface DreamCollectorRun {
  runId: string;
  scope: DreamScope;
  sourceSession?: DreamSourceSessionRef;
  status: DreamCollectorRunStatus;
  decision?: DreamCollectorDecision;
  dreamIds?: string[];
  startedAtUnixMs: number;
  completedAtUnixMs?: number;
  backoffUntilUnixMs?: number;
  error?: string;
  logPath?: string;
}

export type DreamLogLevel = "debug" | "info" | "warn" | "error";

export interface DreamLogEntry {
  timeUnixMs: number;
  level: DreamLogLevel;
  event: string;
  runId?: string;
  scope?: DreamScope;
  sourceSessionPath?: string;
  message?: string;
  data?: JsonObject;
}

export interface DreamSettings {
  enabled: boolean;
  collectorModel?: string;
  debugMode: boolean;
}

export interface ChatArchive {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  assistantAux: AssistantAuxArchiveEntry[];
  llmHistory: Array<StoredLlmMessageArchiveEntry | LegacyLlmMessageArchiveEntry>;
  subagentSessions?: SubagentSessionArchiveEntry[];
  loopEnabled?: boolean;
  approvalLevel?: "default" | "auto-approval" | "bypass-approval";
}

export type McpStatusState = "idle" | "loading" | "ready" | "error";

export interface McpStatusSnapshot {
  revision: number;
  state: McpStatusState;
  configuredServers: number;
  loadedServers: number;
  cachedTools: number;
  lastError?: string;
}

export interface AppPaths {
  workspaceRoot(): string;
  configFile(): string;
  chatsDir(): string;
  logFile(): string;
}

export interface Telemetry {
  logEvent(message: string): void;
  logJsonHttpBody(label: string, payload: JsonValue): void;
}

export interface ConfigStore<Config> {
  load(): Promise<Config>;
  save(config: Config): Promise<void>;
}

export interface SecretStore {
  loadGlobalApiKey(): Promise<string | undefined>;
  saveGlobalApiKey(apiKey: string): Promise<void>;
  removeGlobalApiKey(): Promise<void>;
  loadModelApiKey(modelName: string): Promise<string | undefined>;
  saveModelApiKey(modelName: string, apiKey: string): Promise<void>;
  removeModelApiKey(modelName: string): Promise<void>;
  hasModelApiKey(modelName: string): Promise<boolean>;
}

export interface ChatRepository {
  list(): Promise<string[]>;
  save(path: string | undefined, archive: ChatArchive): Promise<string>;
  load(path: string): Promise<ChatArchive>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  argumentsJson: string;
}

export type ToolAgentStep =
  | { kind: "tool-calls"; calls: ToolCallRequest[] }
  | { kind: "final-response-ready" };

export interface LlmTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface ToolAgentRoundResult<State = JsonValue> {
  state: State;
  step: ToolAgentStep;
  requestTrace: JsonValue[];
  usage?: LlmTokenUsage;
  /** Provider SDK executed built-in search in-stream but the answer step is not ready yet. */
  resumeStreamingAfterProviderSearch?: boolean;
}

export type ToolAgentRoundCompletion<State = JsonValue> =
  | { kind: "success"; result: ToolAgentRoundResult<State> }
  | { kind: "failure"; error: string; requestTrace: JsonValue[] };

export type LlmStreamEvent =
  | { kind: "thinking-chunk"; text: string }
  | {
      kind: "streaming-tool-preview";
      toolCallId: string;
      toolName: string;
      argumentsJson: string;
    }
  | { kind: "assistant-chunk"; text: string }
  | {
      kind: "history-compacted";
      newHistory: LlmMessage[];
      droppedMessages: number;
    }
  | { kind: "done" }
  | { kind: "error"; error: string };

export interface StartedToolAgentRound<State = JsonValue> {
  eventStream: AsyncIterable<LlmStreamEvent>;
  completion: Promise<ToolAgentRoundCompletion<State>>;
  cancel?: () => void;
}

export interface AskQuestionsOption {
  id: string;
  label: string;
  summary?: string;
}

export interface AskQuestionsQuestion {
  id: string;
  title: string;
  allowMultiple?: boolean;
  options?: AskQuestionsOption[];
}

export interface AskQuestionsRequest {
  title?: string;
  questions: AskQuestionsQuestion[];
}

export interface AskQuestionsAnswer {
  questionId: string;
  selectedOptionIds: string[];
  customText?: string;
}

export type AskQuestionsResult =
  | { status: "skipped" }
  | { status: "answered"; answers: AskQuestionsAnswer[] };

export interface SubagentRequest {
  task: string;
  subagentType?: string;
  successCriteria?: string;
  contextSummary?: string;
  filesToInspect?: string[];
  expectedOutput?: string;
  worktree?: boolean;
}

export type PermissionMemoryTarget =
  | { kind: "shell"; command: string }
  | { kind: "read_file"; path: string };

/**
 * Before/after file content pair attached to a file-change approval request, so hosts can render
 * a diff preview inside the approval form. Produced by the executor at authorization time and
 * kept as plain JSON to survive host-bridge IPC. Absent when the preview could not be built (an
 * unreadable target, an over-sized file, …); hosts then fall back to the plain text prompt.
 */
export interface ToolApprovalFileDiffPreview {
  /** Display path: the tool path for workspace files, `plans/{name}.md` for create_plan. */
  path: string;
  /** Content before the change; "" when the file is being created. */
  original: string;
  /** Content after the change; "" when the file is being deleted. */
  modified: string;
  /** Operation semantics; hosts use it for presentation (delete frames start collapsed). */
  operation: "create" | "update" | "delete";
}

/**
 * Text content preview attached to an out-of-workspace read approval, so the approval form can
 * show what the agent would receive instead of just the path. Plain JSON for host-bridge IPC;
 * absent when the target is binary, over-sized, or unreadable at authorization time.
 */
export interface ToolApprovalFileContentPreview {
  /** Display path: the canonical absolute path of the read target. */
  path: string;
  /** UTF-8 text content for read_file; newline-joined entry names for ls. */
  content: string;
}

/**
 * Structured description of a tool call that needs approval, produced by the executor side.
 * Display strings (localized) are built by each host; this payload must stay plain JSON so it
 * survives host-bridge IPC.
 */
export type ToolApprovalRequest =
  | { kind: "shell"; command: string; reason?: string; terminal: string }
  | { kind: "web_fetch"; url: string }
  | {
      kind: "read_path";
      operation: "read_file" | "ls";
      /** Display path: workspace-relative when inside the workspace, else global absolute. */
      path: string;
      /** False when the target sits inside the workspace (ask-rule / hook-gated reads). */
      workspaceExternal?: boolean;
      fileContentPreview?: ToolApprovalFileContentPreview;
    }
  | {
      kind: "create_file";
      path: string;
      contentChars: number;
      fileDiffPreview?: ToolApprovalFileDiffPreview;
    }
  | {
      kind: "create_plan";
      planName: string;
      contentChars: number;
      fileDiffPreview?: ToolApprovalFileDiffPreview;
    }
  | {
      kind: "edit_file";
      path: string;
      oldChars: number;
      newChars: number;
      fileDiffPreview?: ToolApprovalFileDiffPreview;
    }
  | {
      kind: "delete_file";
      path: string;
      fileDiffPreview?: ToolApprovalFileDiffPreview;
    }
  | {
      kind: "apply_patch";
      operation: string;
      path: string;
      diffLines?: number;
      fileDiffPreview?: ToolApprovalFileDiffPreview;
    }
  | {
      kind: "create_automation";
      title: string;
      trigger: JsonValue;
      approvalLevel: string;
      overview: string;
      overviewChars: number;
    }
  | { kind: "extension_tool"; extensionId: string; toolName: string; argumentsPreview: string }
  | {
      kind: "lazy_tool_call";
      provider: string;
      server: string;
      tool: string;
      arguments?: JsonValue;
    };

/** Approval prompt surfaced to hosts: a structured tool request, or free-form text from a hook. */
export type ToolApprovalPrompt =
  | { kind: "tool"; request: ToolApprovalRequest }
  | {
      kind: "hook";
      message: string | undefined;
      /**
       * The host authorization's structured request when the hook ask fires alongside a
       * need-approval outcome, so hosts can render the same command / file previews as a
       * direct tool approval. Absent when the hook asks on an otherwise auto-allowed call.
       */
      request?: ToolApprovalRequest;
    };

export type AuthorizationDecision =
  | { kind: "allowed" }
  | {
      kind: "need-approval";
      approval: ToolApprovalRequest;
      rememberTarget?: PermissionMemoryTarget;
    }
  | { kind: "need-questions"; questions: AskQuestionsRequest }
  | { kind: "denied"; reason: string };

export interface ToolRequestExecutionMetadata {
  toolCallId?: string;
  toolName?: string;
  subagentSessionId?: string;
  subagentTitle?: string;
  userInitiated?: boolean;
  /** In-process only; not serialized across host bridge IPC. */
  onOutputChunk?: (chunk: string) => void;
}

export interface ToolExecutor<
  ToolRequest = unknown,
  McpServer = unknown,
  McpTool = unknown,
  McpResource = unknown,
  McpPrompt = unknown,
  McpInspection = unknown,
> {
  toolDefinitionsJson(): JsonValue;
  /** When Loop is off, omit finish_task from toolDefinitionsJson(). */
  setLoopToolExposure?(loopEnabled: boolean): void;
  setAgentModeToolExposure?(agentMode: AgentMode): void;
  /** @deprecated Use {@link setAgentModeToolExposure}. */
  setPlanModeToolExposure?(planMode: boolean): void;
  parseCommand(message: string): Promise<ToolRequest>;
  requestFromFunctionCall(name: string, argumentsJson: string): Promise<ToolRequest>;
  authorize(request: ToolRequest): Promise<AuthorizationDecision>;
  /**
   * Best-effort structured approval descriptor for a call the host would auto-allow; the turn
   * machine uses it to enrich hook-gated approvals (hook ask + host allow) with the same rich
   * form a real approval would render. Lazy by design: only invoked for that corner, so
   * auto-allowed calls never pay for descriptor building. Returns undefined when the tool has
   * no descriptor. Pure: no state mutation, no permission side effects.
   */
  describeApproval?(request: ToolRequest): Promise<ToolApprovalRequest | undefined>;
  rememberApproval(target: PermissionMemoryTarget, scope: "session" | "config"): Promise<void>;
  execute(request: ToolRequest): Promise<ToolExecutionOutput>;
  attachRequestMetadata?(request: ToolRequest, metadata: ToolRequestExecutionMetadata): ToolRequest;
  continueAfterQuestions?(
    request: ToolRequest,
    result: AskQuestionsResult,
  ): Promise<ToolRequest | undefined>;
  shouldExecuteInBackground?(request: ToolRequest): boolean;
  backgroundStatusText?(request: ToolRequest): string | undefined;
  abortRunningShell?(): void;
  startMcpBackgroundRefresh(): void;
  mcpStatusSnapshot(): McpStatusSnapshot;
  addMcpServer(name: string, config: JsonValue): Promise<string>;
  listMcpServers(): Promise<McpServer[]>;
  inspectMcpServer(name: string): Promise<McpInspection>;
  listMcpTools(name: string): Promise<McpTool[]>;
  listMcpResources(name: string): Promise<McpResource[]>;
  readMcpResource(name: string, uri: string): Promise<JsonValue>;
  listCachedMcpPrompts(name: string): Promise<McpPrompt[]>;
  listMcpPrompts(name: string): Promise<McpPrompt[]>;
  getMcpPrompt(name: string, prompt: string, argsJson?: string): Promise<JsonValue>;
}

export interface CompactHistoryManualContext {
  transcriptDirPath?: string;
}

export interface LlmTransport<Config, State = JsonValue> {
  startToolAgentRound(
    config: Config,
    state: State,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<State>>;
  startToolAgentRoundStreaming?(
    config: Config,
    state: State,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<State>>;
  compactHistoryManual(
    config: Config,
    history: LlmMessage[],
    onProgress?: (message: string) => void,
    context?: CompactHistoryManualContext,
  ): Promise<{
    droppedMessages: number;
    beforeLength: number;
    afterLength: number;
  }>;
  compactSummaryText(history: LlmMessage[]): string | undefined;
  isContextOverflowError(error: string): boolean;
  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[];
  llmSystemPromptsForExport(): JsonValue;
}
