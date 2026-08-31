import type {
  ModelProviderId,
  ProviderConnectSiteId,
} from "@spiritagent/host-internal/model-provider-presets";
import type {
  ModelEntryV2,
  ModelRef,
  ProviderGroupV2,
  SpiritConfigSchemaVersion,
} from "@spiritagent/host-internal/config-v2";
import type { ModelReasoningEffort } from "@spiritagent/agent-core/reasoning-effort";
import type { LspWriteDiagnosticsUi, PermissionMemoryTarget } from "@spiritagent/agent-core";

import type { DesktopAgentMode } from "./lib/agent-mode.js";
import type { DesktopAutomationTrigger } from "./lib/automation-trigger.js";
import type { TranslucencyPreference } from "./lib/translucency.js";

export type { DesktopAgentMode };
import type { WorkspaceFileReferenceSuggestionsResult as HostWorkspaceFileReferenceSuggestionsResult } from "@spiritagent/host-internal/workspace-file-reference-query";
import type { ApprovalLevel } from "@spiritagent/host-internal/approval-level";
import type { WorkLocationKind } from "@spiritagent/host-internal/work-location";
import type { LocalFileComposerRoute } from "@spiritagent/host-internal/local-file-composer-route";
import type {
  GitHubPullRequestCommit,
  GitHubPullRequestMergeMethod,
} from "@spiritagent/host-internal/github/types";
import type {
  WorkspaceCapabilityTrustDecision,
  WorkspaceCapabilityTrustRequest,
} from "@spiritagent/host-internal/hooks/trust";

export type {
  ApprovalLevel,
  WorkLocationKind,
  LocalFileComposerRoute,
  WorkspaceCapabilityTrustDecision,
  WorkspaceCapabilityTrustRequest,
};

import type { ComposerChipNavigateMeta } from "./lib/composer-chip-navigate-meta.js";
import type { RichSegment } from "./lib/composer-segment-model.js";
import type { ComposerLocalFileAttachmentView } from "./lib/local-file-attachments.js";

export type { ModelRef, ModelEntryV2, ProviderGroupV2, SpiritConfigSchemaVersion };

export type DesktopWorkspaceBinding = "project" | "none";

/** Web shell identity for `<basic_info>` (page URL from the browser). */
export interface DesktopClientHost {
  kind: "web";
  pageUrl: string;
}

export interface BootstrapRequest {
  workspaceRoot?: string;
  workspaceBinding?: DesktopWorkspaceBinding;
  /** HTTP web host: bind to a background provisional session without stealing desktop foreground. */
  isolateSession?: boolean;
  /** Desktop Web: host identity + page URL for `<basic_info>`. */
  clientHost?: DesktopClientHost;
}

export interface RememberWorkspaceRequest {
  workspaceRoot: string;
}

export interface ForgetWorkspaceRequest {
  workspaceRoot: string;
}

export interface CommitChangesRequest {
  message?: string;
}

export interface CheckoutGitBranchRequest {
  branch: string;
  discardLocalChanges?: boolean;
}

export interface UpdateConfigRequest {
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  lightweightChatModel?: ModelRef;
  apiBase: string;
  reasoningEffort?: DesktopModelReasoningEffort;
  reasoningMode?: DesktopModelReasoningMode;
  /** Vendor extended thinking; false disables it. Absent means no change. */
  thinkingEnabled?: boolean;
  uiLocale?: string;
  apiKey?: string;
  /** Desktop window-level translucent material (Off / Sidebar / All); absent means no change to the saved value. */
  translucency?: TranslucencyPreference;
  /** When off, do not send desktop system notifications (including Windows taskbar attention). Defaults to true. */
  systemNotifications?: boolean;
  /** When off, do not show the menu bar / tray status icon. Defaults to true. */
  trayIcon?: boolean;
  /** Whether first-launch onboarding (OOBE) has completed; absent means no change to the saved value. */
  onboardingCompleted?: boolean;
  /** Absent means no change to the run mode (Agent / Plan / Ask). */
  agentMode?: DesktopAgentMode;
  /** @deprecated Use agentMode. */
  planMode?: boolean;
  /** Absent means no change to the saved Desktop Web remote access config. */
  webHost?: DesktopWebHostConfigUpdate;
  /** Absent means no change to the saved dreams config. */
  dreams?: DesktopDreamConfigUpdate;
  /** Absent means no change to the saved agents config. */
  agents?: DesktopAgentsConfigUpdate;
  /** Absent means no change to the saved networks config. */
  networks?: DesktopNetworksConfigUpdate;
}

export interface DesktopNetworksConfigUpdate {
  llmHttpVersion?: "http1.1" | "http2";
}

export interface DesktopAgentsConfigUpdate {
  lsp?: {
    enabled?: boolean;
  };
  codeCompletion?: {
    enabled?: boolean;
  };
  attribution?: {
    commit?: {
      enabled?: boolean;
    };
    pr?: {
      enabled?: boolean;
    };
  };
}

export interface InstallLspProviderRequest {
  providerId: string;
}

export type DesktopLspProviderStatus = "ready" | "not_found" | "disabled";

export interface DesktopLspProviderSnapshot {
  id: string;
  displayName: string;
  languages: string[];
  status: DesktopLspProviderStatus;
  installKind: "npm" | "go" | "rustup" | "platform" | "manual" | "dotnet";
  npmPackage?: string;
  /** Command line that Settings will run if the user confirms Install. */
  installCommand?: string;
  command?: string;
}

export interface DesktopLspSnapshot {
  userEnabled: boolean;
  active: boolean;
  providers: DesktopLspProviderSnapshot[];
}

export interface DesktopCodeCompletionSnapshot {
  userEnabled: boolean;
}

export interface DesktopAttributionSnapshot {
  commitEnabled: boolean;
  prEnabled: boolean;
}

export interface DesktopWebHostConfigUpdate {
  enabled?: boolean;
  host?: string;
  port?: number;
  resetPairing?: boolean;
}

export interface DesktopDreamConfigUpdate {
  enabled?: boolean;
  collectorModel?: ModelRef;
  clearCollectorModel?: boolean;
  debugMode?: boolean;
}

/** Model provider (same source as `ModelProviderId` in `packages/host-internal`). */
export type DesktopModelProvider = ModelProviderId;
export type DesktopProviderConnectSiteId = ProviderConnectSiteId;

export type DesktopTransportKind = "openai-compatible" | "open-responses" | "anthropic" | "bedrock";

/** Model reasoning effort string; allowed values are constrained by provider / transportKind in agent-core. */
export type DesktopModelReasoningEffort = ModelReasoningEffort;

/** reasoning.mode (standard / pro) of GPT-5.6+ OpenAI-routed models. */
export type DesktopModelReasoningMode = "standard" | "pro";

export type DesktopModelCapability =
  | "chat"
  | "image"
  | "video"
  | "imageGeneration"
  | "videoGeneration";

export interface PreviewModelCatalogVideoDurationPricing {
  resolution: string;
  costPerSecondUsd: string;
  audio?: boolean;
}

export interface PreviewModelCatalogExamplePricing {
  priceUsd: string;
  description: string;
}

export interface PreviewModelCatalogPricing {
  inputPerTokenUsd?: string;
  outputPerTokenUsd?: string;
  cachedInputPerTokenUsd?: string;
  imagePerUnitUsd?: string;
  requestPerCallUsd?: string;
  videoDurationPricing?: PreviewModelCatalogVideoDurationPricing[];
  imagePerMegapixelUsd?: string;
  imageExamplePricing?: PreviewModelCatalogExamplePricing;
  videoExamplePricing?: PreviewModelCatalogExamplePricing;
}

export type DesktopAlibabaBillingMode = "token-plan";

export type DesktopStepfunBillingMode = "step-plan";

export type DesktopGlmCodingPlanBillingMode = "glm-coding-plan";

export interface PreviewModelCatalogEntry {
  id: string;
  displayName?: string;
  description?: string;
  pricing?: PreviewModelCatalogPricing;
  capabilities?: DesktopModelCapability[];
  supportedReasoningEfforts?: DesktopModelReasoningEffort[];
  contextLength?: number;
  maxCompletionTokens?: number;
  supportsThinkingType?: "only";
  supportsThinkingSwitch?: boolean;
  /** Hugging Face Hub media models: Inference Providers routing hint. */
  inferenceProvider?: string;
  /** DeepInfra `is_partner`: partner model (data forwarded to a third party); first version keeps it as catalog metadata only, no filtering. */
  isPartner?: boolean;
}

/** Preview the model ids listed under an endpoint (with a local TTL cache). */
export interface PreviewModelsRequest {
  apiBase: string;
  apiKey: string;
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  /** Site-based providers such as SiliconFlow: cn / intl. */
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  /** Alibaba Token Plan; absent means the standard pay-as-you-go mode. */
  alibabaBillingMode?: DesktopAlibabaBillingMode;
  stepfunBillingMode?: DesktopStepfunBillingMode;
  zAiBillingMode?: DesktopGlmCodingPlanBillingMode;
  zhipuBillingMode?: DesktopGlmCodingPlanBillingMode;
  awsRegion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  vertexProject?: string;
  vertexLocation?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  /** When true, ignore the TTL and force an upstream request. */
  forceRefresh?: boolean;
}

export interface PreviewModelsResponse {
  modelIds: string[];
  models?: PreviewModelCatalogEntry[];
  fromCache: boolean;
}

/** Batch-write multiple model ids under the same endpoint (sharing an API Key), for bulk import via provider connections. */
export interface AddProviderModelsRequest {
  groupId: string;
  apiBase: string;
  apiKey: string;
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  /** Site-based providers such as SiliconFlow: cn / intl. */
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  /** Alibaba Token Plan; absent means the standard pay-as-you-go mode. */
  alibabaBillingMode?: DesktopAlibabaBillingMode;
  stepfunBillingMode?: DesktopStepfunBillingMode;
  zAiBillingMode?: DesktopGlmCodingPlanBillingMode;
  zhipuBillingMode?: DesktopGlmCodingPlanBillingMode;
  awsRegion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  vertexProject?: string;
  vertexLocation?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  /** Custom provider connection display name; for `custom`, used to generate the groupId and written to `ProviderGroupV2.label`. */
  customGroupLabel?: string;
}

/** Attached to the snapshot: the most recent model-listing result for an apiBase in the local `model-catalog-cache` (for main-UI grouping and sorting). */
export interface DesktopModelCatalogHint {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  apiBase: string;
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  fetchedAtUnixMs: number;
}

/** Same as CLI `model add`: add a model, write the key, and switch the current model to the new one. */
export interface AddModelRequest {
  groupId: string;
  name: string;
  apiBase: string;
  apiKey: string;
  /** Absent means not written to config (same as the legacy three-field version). */
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  capabilities?: DesktopModelCapability[];
  /** Optional; positive integer; used e.g. as the denominator of the context usage ring. */
  contextLength?: number;
  /** Amazon Bedrock AWS region; required for `amazon-bedrock`. */
  awsRegion?: string;
  /** Site-based provider region (e.g. SiliconFlow cn / intl). */
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  alibabaBillingMode?: DesktopAlibabaBillingMode;
  stepfunBillingMode?: DesktopStepfunBillingMode;
  zAiBillingMode?: DesktopGlmCodingPlanBillingMode;
  zhipuBillingMode?: DesktopGlmCodingPlanBillingMode;
  /** Azure resource name; required for `azure`. */
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  /** Google Vertex GCP project ID. */
  vertexProject?: string;
  /** Google Vertex region (e.g. `us-central1`). */
  vertexLocation?: string;
  /** Custom provider connection display name; for `custom`, used to generate the groupId (`slugifyProviderGroupLabel`). */
  customGroupLabel?: string;
}

export interface RemoveModelRequest {
  ref: ModelRef;
}

export interface RemoveProviderGroupRequest {
  groupId: string;
}

/** @deprecated Use RemoveProviderGroupRequest */
export interface RemoveProviderModelsRequest {
  provider: DesktopModelProvider;
}

export interface DesktopMcpCapabilityToggles {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
}

export type DesktopMcpTransportType = "stdio" | "http";

export type DesktopMcpScope = "user" | "workspace";

export interface AddMcpServerRequest {
  name: string;
  scope: DesktopMcpScope;
  transportType: DesktopMcpTransportType;
  endpoint: string;
  metadata?: string;
  capabilities?: Partial<DesktopMcpCapabilityToggles>;
}

export interface DeleteMcpServerRequest {
  name: string;
  scope: DesktopMcpScope;
}

export type DesktopHookScope = "user" | "workspace";

export type DesktopHookEventName =
  | "sessionStart"
  | "sessionEnd"
  | "submitPrompt"
  | "preToolUse"
  | "postToolUse"
  | "subagentStart"
  | "subagentEnd";

export interface SaveHookEntryRequest {
  scope: DesktopHookScope;
  event: DesktopHookEventName;
  command: string;
  timeout?: number;
  failClosed?: boolean;
  matcher?: string;
}

export interface DeleteHookEntryRequest {
  scope: DesktopHookScope;
  event: DesktopHookEventName;
  index: number;
}

export interface DesktopHookListItem {
  id: string;
  scope: DesktopHookScope;
  event: DesktopHookEventName;
  index: number;
  command: string;
  configPath: string;
  timeout?: number;
  failClosed?: boolean;
  matcher?: string;
}

export interface ImportExtensionRequest {
  archiveBase64: string;
  fileName?: string;
}

export interface DeleteExtensionRequest {
  id: string;
}

export interface SetExtensionEnabledRequest {
  id: string;
  enabled: boolean;
}

export interface RunExtensionRequest {
  id: string;
}

export interface InstallMarketplaceExtensionRequest {
  extensionId: string;
  version?: string;
  reviewAcknowledged?: boolean;
}

export interface PrepareMarketplaceExtensionInstallRequest {
  extensionId: string;
  version?: string;
}

export type DesktopExtensionSettingValue = string | boolean | number | null;

export interface UpdateExtensionSettingsRequest {
  id: string;
  values: Record<string, DesktopExtensionSettingValue>;
}

export interface UpdateExtensionSecretRequest {
  id: string;
  key: string;
  value?: string;
}

export type DesktopExtensionToolApprovalMode = "allowed" | "need-approval" | "need-questions";

export type DesktopExtensionToolExecutionMode = "foreground" | "background";

export interface DesktopExtensionContributedTool {
  name: string;
  description: string;
  approvalMode?: DesktopExtensionToolApprovalMode;
  executionMode?: DesktopExtensionToolExecutionMode;
}

export interface DesktopExtensionDesktopCssEntry {
  path: string;
  media?: string;
}

export interface DesktopExtensionDesktopSettingsPage {
  title?: string;
}

export interface DesktopExtensionCliUiHookTokens {
  foreground?: string;
  border?: string;
  accent?: string;
}

export interface DesktopExtensionCliUiHookEntry {
  slot: string;
  variant?: string;
  tokens?: DesktopExtensionCliUiHookTokens;
  prefix?: string;
  suffix?: string;
}

export type DesktopExtensionSettingType = "string" | "boolean" | "number" | "select";

export interface DesktopExtensionSettingOption {
  value: string;
  label: string;
  description?: string;
}

export interface DesktopExtensionSettingDefinition {
  key: string;
  type: DesktopExtensionSettingType;
  title: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | boolean | number;
  options?: DesktopExtensionSettingOption[];
}

export interface DesktopExtensionSecretSlot {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
}

export interface DesktopExtensionSecretStatus {
  key: string;
  configured: boolean;
}

export type DesktopExtensionHostKind = "cli" | "desktop";

export interface DesktopExtensionInstructionContributionSummary {
  mcp?: Array<{ name: string; displayName?: string; transport: "stdio" | "http" }>;
  hooks?: string[];
  skills?: Array<{ name: string; description: string }>;
  rules?: { content: string };
}

export interface DesktopExtensionListItem {
  id: string;
  displayName: string;
  icon?: string;
  version: string;
  enabled: boolean;
  description?: string;
  author?: string;
  homepage?: string;
  main?: string;
  supportedHosts: DesktopExtensionHostKind[];
  activationEvents?: string[];
  requestedCapabilities?: string[];
  contributedTools?: DesktopExtensionContributedTool[];
  desktopCss?: DesktopExtensionDesktopCssEntry[];
  desktopSettingsPage?: DesktopExtensionDesktopSettingsPage;
  cliHooks?: DesktopExtensionCliUiHookEntry[];
  instructionContributions?: DesktopExtensionInstructionContributionSummary;
  settingsSchema?: DesktopExtensionSettingDefinition[];
  settingsValues?: Record<string, DesktopExtensionSettingValue>;
  secretSlots?: DesktopExtensionSecretSlot[];
  secretStatuses?: DesktopExtensionSecretStatus[];
  archiveFileName?: string;
  installSource?: "built-in" | "archive" | "marketplace";
  installedAtUnixMs: number;
}

export interface DesktopMcpStdioTransportSnapshot {
  type: "stdio";
  command: string;
  args: string[];
  metadata: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  summary: string;
}

export interface DesktopMcpHttpTransportSnapshot {
  type: "http";
  url: string;
  metadata: Record<string, string>;
  timeoutMs?: number;
  summary: string;
}

export type DesktopMcpTransportSnapshot =
  | DesktopMcpStdioTransportSnapshot
  | DesktopMcpHttpTransportSnapshot;

export interface DesktopMcpServerListItem {
  name: string;
  displayName: string;
  enabled: boolean;
  capabilities: DesktopMcpCapabilityToggles;
  scope: DesktopMcpScope;
  transport: DesktopMcpTransportSnapshot;
}

export interface DesktopMcpServerInspection {
  name: string;
  displayName: string;
  supportsTools: boolean;
  supportsResources: boolean;
  supportsPrompts: boolean;
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
}

export type DesktopSkillScope = "workspace" | "user";
export type DesktopSkillRootKind = "workspaceSpirit" | "workspaceAgents" | "user";

/** Create `skills/<name>/SKILL.md`; the root directory is determined by `rootKind` (user directory or workspace `.spirit` / `.agents`). */
export interface CreateSkillRequest {
  name: string;
  rootKind: DesktopSkillRootKind;
  /** Frontmatter `description`: an overview for the model to decide when to enable this Skill. */
  summary: string;
  /** SKILL.md body (after the frontmatter); required. */
  content: string;
}

export interface DeleteSkillRequest {
  name: string;
  rootKind: DesktopSkillRootKind;
}

export interface SubmitSkillSlashRequest {
  skillName: string;
  rawText: string;
  extraNote?: string;
}

export type GitChipAction = "commit" | "push" | "merge";

export interface SubmitGitChipRequest {
  action: GitChipAction;
  extraNote?: string;
}

export type DesktopRuleScope = "workspace" | "user";

/** Create a Markdown rule file in a fixed rule slot; the root directory is determined by `rootKind`. */
export interface CreateRuleRequest {
  rootKind: DesktopSkillRootKind;
  /** Body seed to write; required. */
  description: string;
}

export interface DeleteRuleRequest {
  id: string;
}

export interface RewindAndSubmitMessageRequest {
  messageId: number;
  text: string;
  localFilePaths?: string[];
  /** Host-only chip navigation sidecar; never forwarded to the agent. */
  chipNavigateMeta?: ComposerChipNavigateMeta[];
}

export interface ForkSessionRequest {
  messageId: number;
  /** Visible list index; disambiguates duplicate `messageId`s in the timeline. */
  listIndex?: number;
}

export interface SubmitUserTurnRequest {
  text: string;
  localFilePaths?: string[];
  referencedWorkspaceFilePaths?: string[];
  skillChipAliases?: string[];
  /** Host-only chip navigation sidecar; never forwarded to the agent. */
  chipNavigateMeta?: ComposerChipNavigateMeta[];
  /** Target a loaded split pane session without switching sidebar foreground. */
  sessionPath?: string;
}

export interface PollRequest {
  /** Project poll snapshot for this session without switching host foreground. */
  sessionPath?: string;
}

export interface AbortConversationRequest {
  /** Abort a loaded split pane session without switching sidebar foreground. */
  sessionPath?: string;
}

export interface ReplyPendingApprovalRequest {
  decision: DesktopApprovalDecision;
  /** Reply for a loaded split pane session without switching sidebar foreground. */
  sessionPath?: string;
}

export interface ReplyPendingQuestionsRequest {
  result: AskQuestionsResult;
  /** Reply for a loaded split pane session without switching sidebar foreground. */
  sessionPath?: string;
}

export interface ReplyWorkspaceCapabilityTrustRequest {
  decision: WorkspaceCapabilityTrustDecision;
}

export interface BeginSplitPaneSessionRequest {
  paneId: string;
  /** When true, only create the in-memory bundle; caller batches snapshot via syncSplitPaneSessions. */
  deferSnapshot?: boolean;
}

export interface BeginSplitPaneSessionResponse {
  sessionPath: string;
  snapshot?: DesktopSnapshot;
}

export interface BeginSideChatPaneSessionRequest {
  paneId: string;
}

export interface BeginSideChatPaneSessionResponse {
  sessionPath: string;
}

export interface ForkSessionIntoSideChatRequest {
  sourceSessionPath: string;
  targetPaneId: string;
  messageId: number;
  listIndex?: number;
}

export interface SetVisiblePaneSessionsRequest {
  sessionPaths: string[];
}

export interface CloseSplitPaneSessionRequest {
  sessionPath: string;
}

export interface FocusPaneSessionRequest {
  sessionPath: string;
}

export interface SyncSplitPaneSessionsRequest {
  sessionPaths: string[];
  focusSessionPath?: string;
}

export interface SwitchPaneWorkspaceRequest {
  sessionPath: string;
  workspaceRoot?: string;
  workspaceBinding: DesktopWorkspaceBinding;
}

export interface SwitchPaneModelRequest {
  sessionPath: string;
  modelRef: ModelRef;
}

export interface SetPanePendingGitBranchRequest {
  sessionPath: string;
  branch: string;
}

export interface SetPaneWorkLocationRequest {
  sessionPath: string;
  workLocation: WorkLocationKind;
}

export interface CheckoutPaneGitBranchRequest {
  sessionPath: string;
  branch: string;
  discardLocalChanges?: boolean;
}

export interface PaneSessionSlice {
  conversation: ConversationSnapshot;
  activeSession?: ActiveSessionSnapshot;
  composerSessionKey: string;
  isForegroundActive: boolean;
  workspaceRoot?: string;
  workspaceBinding?: DesktopWorkspaceBinding;
  git?: DesktopGitSnapshot;
  activeModel?: ModelRef;
}

export interface QueuedUserTurnRequest {
  queueId: string;
}

export interface DesktopSkillListItem {
  id: string;
  name: string;
  description: string;
  shortLabel: string;
  scope: DesktopSkillScope;
  rootKind: DesktopSkillRootKind;
  enabled: boolean;
  /** Absolute SKILL.md path; host-only, used to open the skill file from composer chips. */
  path: string;
}

export interface DesktopExtensionSkillSlashItem {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface DesktopRuleListItem {
  id: string;
  title: string;
  shortLabel: string;
  scope: DesktopRuleScope;
  rootKind: DesktopSkillRootKind;
  exists: boolean;
  enabled: boolean;
  previewExcerpt?: string;
  previewTruncated?: boolean;
}

/** Same as the `*.json` files saved by CLI `chat_store`. */
export interface ActiveSessionSnapshot {
  filePath: string;
  displayName: string;
  kind?: "stored" | "ephemeral";
  readOnly?: boolean;
}

export interface SessionListItem {
  path: string;
  displayName: string;
  modifiedAtUnixMs: number;
  workspaceRoot: string;
  gitBranch?: string;
  kind?: "stored" | "ephemeral";
  readOnly?: boolean;
  /** Absolute path to transcripts/.../transcript.json for this chat (deterministic from chat path). */
  transcriptPath: string;
  /** Agent turn in progress for this session (in-memory registry). */
  isBusy?: boolean;
  /** Waiting for approval or askQuestions; still counts as busy for host polling. */
  isBlocked?: boolean;
  /** Currently focused session in the desktop host. */
  isActive?: boolean;
}

export interface DesktopWorkspaceListItem {
  path: string;
  label: string;
}

/** Workspace file tree child node (the path relative to the workspace root is assembled by the frontend from `name` and the parent path). */
export type WorkspaceExplorerEntryKind = "file" | "dir";

export interface WorkspaceExplorerEntry {
  name: string;
  kind: WorkspaceExplorerEntryKind;
  /** True when ignored by Git / exclude rules; absent or false renders with normal color. */
  ignored?: boolean;
}

export interface WorkspaceExplorerListResult {
  entries: WorkspaceExplorerEntry[];
}

export interface QueryWorkspaceFileReferenceSuggestionsRequest {
  input: string;
  cursorChars: number;
}

export type WorkspaceFileReferenceSuggestionsResult = HostWorkspaceFileReferenceSuggestionsResult;
export type WorkspaceFileReferenceSuggestionsResponse =
  WorkspaceFileReferenceSuggestionsResult | null;

export interface WorkspaceFileReferenceIndexSnapshot {
  ready: boolean;
  files: string[];
}

/** Workspace text file content read by the host as UTF-8 (sidebar editor etc.). */
export interface WorkspaceReadTextFileResult {
  text: string;
  /** Binary file: no editable text is returned; the UI shows a placeholder hint. */
  binary?: true;
  /** Image verified by magic bytes: the UI shows a preview; it does not enter Monaco. */
  image?: { mimeType: string };
}

/** readWorkspaceTextFile options; with optional, a missing file returns empty text instead of throwing. */
export interface ReadWorkspaceTextFileOptions {
  optional?: boolean;
}

export interface WriteWorkspaceTextFileRequest {
  relativePath: string;
  text: string;
}

export type WorkspaceContentSearchRequest = {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  isRegexp?: boolean;
};

export type WorkspaceContentSearchSubmatch = {
  start: number;
  end: number;
};

export type WorkspaceContentSearchMatch = {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  submatches: WorkspaceContentSearchSubmatch[];
};

export type WorkspaceContentSearchResult = {
  matches: WorkspaceContentSearchMatch[];
  truncated?: boolean;
};

export type CodeCompletionKind = "insert" | "replace" | "delete";

export interface CodeCompletionOperationSnapshot {
  kind: CodeCompletionKind;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text?: string;
}

export interface CodeCompletionResponse {
  operations: CodeCompletionOperationSnapshot[];
}

export interface RequestCodeCompletionRequest {
  relativePath: string;
  languageId: string;
  documentText: string;
  cursorLine: number;
  cursorColumn: number;
}

export interface RecordCodeCompletionFileStateRequest {
  relativePath: string;
  baselineText: string;
  currentText: string;
}

export interface HostTextFileStatResult {
  exists: boolean;
  isFile: boolean;
}

export interface WriteHostTextFileRequest {
  absolutePath: string;
  text: string;
}

export interface DesktopSnapshot {
  workspaceRoot: string;
  /** User home directory; used by the sidebar to separate "no workspace" sessions from project workspace sessions. */
  userHomeDirectory: string;
  workspaceBinding: DesktopWorkspaceBinding;
  availableWorkspaces: DesktopWorkspaceListItem[];
  git: DesktopGitSnapshot;
  /**
   * Monotonic workspace-content invalidation. Bumps when an agent mutates files or when
   * a git working-tree refresh observes a real change; file views and git consumers
   * subscribe here instead of polling on their own.
   */
  workspaceContentInvalidation?: WorkspaceContentInvalidation;
  dreams: DesktopDreamSnapshot;
  runtimeReady: boolean;
  runtimeError?: string;
  config: DesktopConfigSnapshot;
  webHost: DesktopWebHostSnapshot;
  rules: DiscoverySummary;
  skills: DiscoverySummary;
  /** All Rules in the fixed slots (including ones not yet created), for the settings page list. */
  rulesList: DesktopRuleListItem[];
  /** All Skills discovered under the current workspace and user directory, for the settings page list. */
  skillsList: DesktopSkillListItem[];
  /** Extension-contributed skills for slash activation; omitted from settings lists. */
  extensionSkills: DesktopExtensionSkillSlashItem[];
  extensionsList: DesktopExtensionListItem[];
  extensionCss: DesktopExtensionCssLayer[];
  /** Extension background warmup in progress (does not block session navigation or sending messages). */
  extensionsLoading?: boolean;
  plan: PlanSnapshot;
  mcpStatus: McpStatusSnapshot;
  mcpServers: DesktopMcpServerListItem[];
  hooksList: DesktopHookListItem[];
  lsp: DesktopLspSnapshot;
  codeCompletion: DesktopCodeCompletionSnapshot;
  attribution: DesktopAttributionSnapshot;
  conversation: ConversationSnapshot;
  /** Per split-pane session projection keyed by resolved session file path. */
  paneSessions?: Record<string, PaneSessionSlice>;
  /** Session opened from disk; `undefined` when not opened from a file (new session/unsaved). */
  activeSession?: ActiveSessionSnapshot;
  /** Stable key for per-session composer draft persistence (`filePath` or synthetic bundle id). */
  composerSessionKey: string;
  /** Active SubAgent viewer overlay; present while renderer has a tool card open in viewer mode. */
  subagentViewer?: SubagentViewerSnapshot;
  automationsList: DesktopAutomationListItem[];
  /** Workspace hooks trust gate; blocks sessionStart workspace hooks until the user decides. */
  pendingWorkspaceCapabilityTrust?: WorkspaceCapabilityTrustRequest;
}

/** Tail-replacement delta for one conversation message list (foreground or a split-pane projection). */
export interface ConversationMessagesDelta {
  /** Revision the receiver must currently hold for this conversation; guards against missed pushes. */
  baseRevision: number;
  revision: number;
  /** All conversation fields except messages/revision, sent wholesale (small). */
  conversationHead: Omit<ConversationSnapshot, "messages" | "revision">;
  fromIndex: number;
  /** Replacement messages covering [fromIndex, totalCount). */
  tailMessages: ConversationMessageSnapshot[];
  totalCount: number;
}

/**
 * Incremental live update for the Electron push channel: carries the conversation head
 * wholesale plus only the changed message tail, so a streaming push costs O(delta) instead
 * of structured-cloning the entire transcript on every emit. Messages before `fromIndex`
 * are unchanged and keep their object identity on the receiver (renderer memo stays effective).
 */
export interface DesktopConversationDelta {
  kind: "conversation-delta";
  composerSessionKey: string;
  /** Foreground conversation delta fields. */
  baseRevision: number;
  revision: number;
  /** All conversation fields except messages/revision, sent wholesale (small). */
  conversationHead: Omit<ConversationSnapshot, "messages" | "revision">;
  fromIndex: number;
  /** Replacement messages covering [fromIndex, totalCount). */
  tailMessages: ConversationMessageSnapshot[];
  totalCount: number;
  /**
   * Changed split-pane projections (keyed by session file path), each applied with the same
   * tail-replacement rules. Panes whose slices did not change are omitted; opening/closing a
   * pane or changing a pane's non-conversation fields forces a full push instead.
   */
  paneDeltas?: Record<string, ConversationMessagesDelta>;
}

/** Push payload on the desktop live-update channel: either a full snapshot or a conversation delta. */
export type DesktopLiveUpdate =
  | { kind: "full"; snapshot: DesktopSnapshot }
  | DesktopConversationDelta;

export type SubagentViewerSessionStatus =
  | "bootstrapping"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export interface SubagentViewerSnapshot {
  parentToolCallId: string;
  sessionId: string;
  status: SubagentViewerSessionStatus;
  /** Same text as subagent tool card headlineDetail (delegated task). */
  promptText: string;
  messages: ConversationMessageSnapshot[];
  pendingAuxState?: PendingAssistantAux;
}

export interface DesktopExtensionCssLayer {
  extensionId: string;
  extensionName: string;
  sourcePath: string;
  cssText: string;
  media?: string;
}

export interface DesktopConfigSnapshot {
  providerGroups: ProviderGroupV2[];
  models: ModelProfileSnapshot[];
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  lightweightChatModel?: ModelRef;
  uiLocale?: string;
  activeApiKeyConfigured: boolean;
  /** Window-level translucent material: Off / Sidebar / All; treated as Sidebar when the field is absent or unknown. */
  translucency?: TranslucencyPreference;
  /** Whether to send system notifications; treated as true when the field is absent. */
  systemNotifications?: boolean;
  /** Whether to show the menu bar / tray status icon; treated as true when the field is absent. */
  trayIcon?: boolean;
  /** Whether first-launch onboarding (OOBE) has completed; treated as false when the field is absent. */
  onboardingCompleted?: boolean;
  /** Run mode: affects host instruction metadata, tool exposure, and agentMode. */
  agentMode: DesktopAgentMode;
  /** Aligned with `spiritDataDir()/model-catalog-cache`; an empty array when there is no cache. */
  modelCatalogHints?: DesktopModelCatalogHint[];
  networks: {
    llmHttpVersion: "http1.1" | "http2";
  };
}

export interface DesktopDreamSettingsSnapshot {
  enabled: boolean;
  collectorModel?: ModelRef;
  debugMode: boolean;
}

export type DesktopDreamCollectorState =
  | "disabled"
  | "missing-model"
  | "idle"
  | "running"
  | "backoff"
  | "error";

export interface DesktopDreamCollectorSnapshot {
  state: DesktopDreamCollectorState;
  lastRunAtUnixMs?: number;
  lastSuccessAtUnixMs?: number;
  lastError?: string;
  pendingCount: number;
  processedCount: number;
  backoffUntilUnixMs?: number;
}

export interface DesktopDreamSnapshot {
  settings: DesktopDreamSettingsSnapshot;
  collector: DesktopDreamCollectorSnapshot;
}

export interface DesktopDreamOverviewItem {
  id: string;
  title: string;
  summary: string;
  details?: string;
  tags: string[];
  workspaceRoot: string;
  gitBranch: string;
  updatedAtUnixMs: number;
}

export interface DesktopAutomationListItem {
  id: string;
  title: string;
  scheduleLabel: string;
  trigger: DesktopAutomationTrigger;
  enabled: boolean;
  githubPollError?: string;
  lastRunAtUnixMs?: number;
  updatedAtUnixMs: number;
}

export type {
  DesktopAutomationSchedule,
  DesktopAutomationWeekday,
} from "./lib/automation-schedule.js";
export type {
  DesktopAutomationGitHubEvent,
  DesktopAutomationTrigger,
} from "./lib/automation-trigger.js";

export interface DesktopGitHubAutomationRepositoryItem {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  updatedAt: string;
}

export interface ListGitHubAutomationRepositoriesRequest {
  page?: number;
}

export interface SearchGitHubAutomationRepositoriesRequest {
  query: string;
  page?: number;
}

export interface GitHubAutomationRepositoriesSnapshot {
  items: DesktopGitHubAutomationRepositoryItem[];
  hasNextPage: boolean;
}

export interface SearchGitHubAutomationRepositoriesSnapshot {
  items: DesktopGitHubAutomationRepositoryItem[];
  totalCount: number;
}

export type DesktopAutomationRunStatus = "running" | "blocked" | "completed" | "failed";

export interface DesktopAutomationRun {
  id: string;
  automationId: string;
  sessionPath: string;
  status: DesktopAutomationRunStatus;
  startedAtUnixMs: number;
  completedAtUnixMs?: number;
  error?: string;
}

export interface DesktopAutomationDefinition {
  id: string;
  title: string;
  overview: string;
  trigger: import("./lib/automation-trigger.js").DesktopAutomationTrigger;
  workspaceRoot: string;
  modelRef: ModelRef;
  reasoningEffort?: DesktopModelReasoningEffort;
  approvalLevel: ApprovalLevel;
  enabled: boolean;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  lastFiredAtUnixMs?: number;
}

export interface DesktopAutomationDetail {
  definition: DesktopAutomationDefinition;
  runs: DesktopAutomationRun[];
}

export interface DesktopCreateAutomationRequest {
  title: string;
  overview: string;
  trigger: import("./lib/automation-trigger.js").DesktopAutomationTrigger;
  workspaceRoot: string;
  modelRef: ModelRef;
  reasoningEffort?: DesktopModelReasoningEffort;
  approvalLevel: ApprovalLevel;
  enabled?: boolean;
}

export interface DesktopUpdateAutomationRequest {
  title?: string;
  overview?: string;
  trigger?: import("./lib/automation-trigger.js").DesktopAutomationTrigger;
  workspaceRoot?: string;
  modelRef?: ModelRef;
  reasoningEffort?: DesktopModelReasoningEffort;
  approvalLevel?: ApprovalLevel;
  enabled?: boolean;
}

export type WorkspaceContentInvalidationReason = "agent-file-change" | "git-working-tree";

export interface WorkspaceContentInvalidation {
  revision: number;
  /** Workspace-relative POSIX paths. Empty means "unspecified" (git working-tree refresh). */
  paths: string[];
  reason: WorkspaceContentInvalidationReason;
}

export interface DesktopGitSnapshot {
  /** Bumped on each successful workspace git summary refresh (poll or user git op). */
  revision: number;
  isRepository: boolean;
  hasChanges: boolean;
  workingTreeLineDelta?: { added: number; removed: number };
  branch?: string;
  branches: string[];
  upstreamRemote?: string;
  upstreamBranch?: string;
  aheadCount: number;
  behindCount: number;
  pushRemote?: string;
  needsPush: boolean;
  /** User-selected branch for the next send; defaults to `branch` when unset. */
  selectedBranch?: string;
  /** Session work-location preference; populated on client snapshots. */
  workLocation?: WorkLocationKind;
  /** True when the active workspace path is a linked Git worktree. */
  isWorktreeSession?: boolean;
  /** Primary repository root for the active worktree session. */
  primaryRepoRoot?: string;
  /** Directory name under `{repoRoot}.worktrees/`. */
  worktreeName?: string;
  /** Current spirit/ branch checked out in the worktree. */
  worktreeBranch?: string;
  /** Default branch on the primary repository (for merge UI). */
  defaultBranch?: string;
}

export interface GitWorkingTreeChange {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  code: string;
  previousPath?: string;
}

export interface GitWorkingTreeSnapshot {
  isRepository: boolean;
  changes: GitWorkingTreeChange[];
}

export interface GitCommitRecord {
  oid: string;
  parents: string[];
  subject: string;
  author: string;
  authoredAt: string;
  refs: string[];
}

export interface GitCommitGraphRow {
  commit: GitCommitRecord;
  lane: number;
  laneCount: number;
  passingLanes: number[];
  mergeLanes: number[];
  branchFromLane?: number;
}

export interface GitHistorySnapshot {
  isRepository: boolean;
  commits: GitCommitRecord[];
  rows: GitCommitGraphRow[];
  hasMore: boolean;
  logCommits: GitCommitRecord[];
}

export interface ReadGitHistoryRequest {
  maxCount?: number;
  skip?: number;
  /** When loading the next page, pass the prior `logCommits` to merge and rebuild the graph. */
  existingLogCommits?: GitCommitRecord[];
}

export interface ReadGitCommitMessageRequest {
  oid: string;
}

export interface GitCommitMessageSnapshot {
  isRepository: boolean;
  oid: string;
  subject: string;
  author: string;
  authoredAt: string;
  fullMessage: string;
}

export type {
  GitHubAuthStatus,
  GitHubDeviceAuthChallenge,
  GitHubPullRequestConversationSnapshot,
  GitHubPullRequestConversationItem,
  GitHubPullRequestChangedFile,
  GitHubPullRequestFileStatus,
  GitHubPullRequestFilesSnapshot,
  GitHubPullRequestCommit,
  GitHubPullRequestCommitsSnapshot,
  GitHubPullRequestCheck,
  GitHubPullRequestCheckState,
  GitHubPullRequestChecksSnapshot,
  GitHubPullRequestConversationCommit,
  GitHubPullRequestConversationMerged,
  GitHubPullRequestConversationIssueComment,
  GitHubPullRequestConversationReview,
  GitHubPullRequestConversationReviewThread,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewState,
  GitHubPullRequestDetail,
  GitHubPullRequestForBranchResult,
  GitHubPullRequestSummary,
  GitHubPullRequestListItem,
  GitHubPullRequestListSnapshot,
  GitHubPullRequestTabCounts,
  GitHubPullRequestTaskListProgress,
  GitHubRepositoryRef,
} from "@spiritagent/host-internal/github/types";

export interface ListGitHubPullRequestsRequest {
  owner: string;
  repo: string;
  state: "open" | "closed";
  page?: number;
  query?: string;
}

export interface GetGitHubPullRequestTabCountsRequest {
  owner: string;
  repo: string;
}

export interface GetGitHubPullRequestDetailRequest {
  owner: string;
  repo: string;
  number: number;
  checksAfter?: string;
  nodeId?: string;
  conversationTimelinePage?: number;
  conversationReviewCommentsPage?: number;
  conversationCommitsPage?: number;
  conversationKnownCommits?: GitHubPullRequestCommit[];
  conversationPreviousNextTimelinePage?: number;
  conversationPreviousNextReviewCommentsPage?: number;
  conversationPreviousNextCommitsPage?: number;
}

export interface MergeGitHubPullRequestRequest extends GetGitHubPullRequestDetailRequest {
  mergeMethod: GitHubPullRequestMergeMethod;
}

export type {
  GitHubPullRequestMergeMethod,
  GitHubPullRequestMergeResult,
} from "@spiritagent/host-internal/github/types";

export interface ModelProfileSnapshot {
  groupId?: string;
  ref?: ModelRef;
  name: string;
  apiBase: string;
  reasoningEffort: DesktopModelReasoningEffort;
  reasoningMode?: DesktopModelReasoningMode;
  /** Vendor extended thinking; defaults to true. Only thinking-type models persist false. */
  thinkingEnabled?: boolean;
  supportedReasoningEfforts?: DesktopModelReasoningEffort[];
  capabilities?: DesktopModelCapability[];
  /** Persistence origin; absent means a legacy custom configuration. */
  provider?: DesktopModelProvider;
  /** Transport family; currently mainly used to distinguish Anthropic from OpenAI-compatible. */
  transportKind?: DesktopTransportKind;
  /** Site-based provider region (e.g. SiliconFlow cn / intl). */
  providerSite?: DesktopProviderConnectSiteId;
  /** Alibaba workspace ID; required for regions such as Singapore/Frankfurt. */
  alibabaWorkspaceId?: string;
  /** Alibaba Token Plan; absent means the standard pay-as-you-go mode. */
  alibabaBillingMode?: DesktopAlibabaBillingMode;
  /** StepFun Step Plan; absent means the standard API. */
  stepfunBillingMode?: DesktopStepfunBillingMode;
  /** Z.ai GLM Coding Plan; absent means the standard API. */
  zAiBillingMode?: DesktopGlmCodingPlanBillingMode;
  /** Zhipu AI GLM Coding Plan; absent means the standard API. */
  zhipuBillingMode?: DesktopGlmCodingPlanBillingMode;
  /** Amazon Bedrock AWS region (e.g. `us-east-1`); used only by `amazon-bedrock`. */
  awsRegion?: string;
  /** Azure resource name; used only by `azure`. */
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  /** Google Vertex GCP project ID; used only by `google-vertex-ai`. */
  vertexProject?: string;
  /** Google Vertex region; used only by `google-vertex-ai`. */
  vertexLocation?: string;
  /** User-configured model context length (tokens); takes precedence over catalog resolution. */
  contextLength?: number;
  /** Kimi Code `supports_thinking_type`; `only` means thinking is always on. */
  supportsThinkingType?: "only";
  /** Catalog flag: the model supports the `thinking.type` switch (e.g. Meituan LongCat). */
  supportsThinkingSwitch?: boolean;
  /** Host snapshot: whether this model has a dedicated API Key entry in the system keychain (same as CLI; excludes environment variables and the global fallback). */
  keyConfigured?: boolean;
}

export interface DiscoverySummary {
  discovered: number;
  enabled: number;
}

export interface PlanSnapshot {
  path: string;
  exists: boolean;
  content?: string;
  modifiedAtUnixMs?: number;
}

export interface McpStatusSnapshot {
  revision: number;
  state: "idle" | "loading" | "ready" | "error";
  configuredServers: number;
  loadedServers: number;
  cachedTools: number;
  lastError?: string;
}

export type DesktopTodoStatus = "pending" | "in_progress" | "completed";

export interface DesktopTodoItem {
  id: string;
  title: string;
  status: DesktopTodoStatus;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  completedAtUnixMs?: number;
}

export interface ConversationTodoSnapshot {
  items: DesktopTodoItem[];
  clearingUntilUnixMs?: number;
}

export interface ConversationContextUsageSnapshot {
  inputTokens: number;
  contextLength: number;
  percent: number;
}

export interface ConversationSnapshot {
  /** Monotonic per session bundle; bumps on rewind restore so stale poll snapshots are ignored. */
  revision: number;
  messages: ConversationMessageSnapshot[];
  loopEnabled: boolean;
  approvalLevel: ApprovalLevel;
  pendingUserTurn?: string;
  pendingImagePaths: string[];
  pendingMcpResources: PendingMcpResource[];
  pendingAuxState?: PendingAssistantAux;
  pendingToolApproval?: PendingToolApprovalSnapshot;
  pendingQuestions?: PendingQuestionsSnapshot;
  isBusy: boolean;
  rewindWarnings?: FileRewindWarning[];
  todos?: ConversationTodoSnapshot;
  contextUsage?: ConversationContextUsageSnapshot;
}

export interface ConversationLocalFileAttachmentSnapshot {
  path: string;
  name: string;
  isImage: boolean;
}

export interface ConversationMessageSnapshot {
  id: number;
  role: "user" | "assistant";
  content: string;
  localFileAttachments?: ConversationLocalFileAttachmentSnapshot[];
  /** Host-only chip navigation sidecar aligned to navigable chips in document order. */
  chipNavigateMeta?: ComposerChipNavigateMeta[];
  tool?: ToolBlockSnapshot;
  aux?: MessageAuxSnapshot;
  pending: boolean;
  canRewind?: boolean;
  canContinue?: boolean;
  /** UI-only projection for unsent queued user turns (not in message timeline). */
  queued?: boolean;
  queueId?: string;
}

export interface MessageRewindDraftState {
  messageId: number;
  /** List index in the visible conversation; disambiguates duplicate `messageId`s in the timeline. */
  listIndex: number;
  segments: RichSegment[];
  localFileAttachments: ComposerLocalFileAttachmentView[];
}

export interface MessageRewindResult {
  restored: number;
  skipped: number;
  warnings: FileRewindWarning[];
}

export interface FileRewindWarning {
  changeId?: string;
  path: string;
  action: "create_file" | "edit_file" | "delete_file";
  message: string;
}

export interface ToolBlockSnapshot {
  toolCallId?: string;
  toolName: string;
  phase: "preview" | "pending-approval" | "running" | "succeeded" | "failed";
  headline: string;
  /** Muted secondary line shown after headline (e.g. shell command, grep query). */
  headlineDetail?: string;
  /** create_file / create_plan / edit_file / delete_file: line +/- counts on tool card headline. */
  editLineDelta?: { added: number; removed: number };
  /** delete_file: the full text frozen before deletion, for the expanded Diff (the file no longer exists on disk after completion). */
  deleteFileBaselineText?: string;
  /** Full argument JSON during the preview phase, for the streaming Diff in the expanded area; cleared after completion. */
  streamingArgumentsJson?: string;
  /** Completed file-type tool: the full request JSON (for Diff; separate from the UI's argsExcerpt truncation). */
  fileToolDiffArgumentsJson?: string;
  /** todo_write: the session TODOs before execution, for incremental detail recomputation and language switching. */
  todoWriteBeforeTodos?: Array<{ title: string; status: DesktopTodoStatus }>;
  detailLines: string[];
  argsExcerpt?: string;
  outputExcerpt?: string;
  imagePaths?: string[];
  videoPaths?: string[];
  /** Error/warning summary from the LSP auto-check after a write-file tool (for the tool card badge and hover). */
  lspWriteDiagnostics?: LspWriteDiagnosticsUi;
  /** Provider tools like Moonshot Formula: forbid expanding to avoid showing encrypted gibberish. */
  suppressExpand?: boolean;
}

export interface MessageAuxSnapshot {
  thinking?: string;
  compaction?: string;
  /** Loop finish_task: no tool card; show a gray note line below the assistant body */
  finishTaskNotice?: string;
  /** Turn-level LLM/transport failure: show the error copy as a card instead of normal Agent body text */
  turnError?: boolean;
  /** Retryable errors such as 429: show a Loading ring and retry progress (attempt/maxAttempts) */
  turnErrorRetry?: {
    attempt: number;
    maxAttempts: number;
  };
}

export interface PendingToolApprovalSnapshot {
  toolName: string;
  prompt: string;
  rememberTarget?: PermissionMemoryTarget;
  subagentSessionId?: string;
  autoReviewBlockReason?: string;
}

export type DesktopApprovalDecision =
  | { kind: "allow"; remember?: "session" | "config" }
  | { kind: "deny"; resultText?: string }
  | { kind: "guidance"; userMessage: string; resultText?: string };

export interface PendingQuestionsSnapshot {
  toolCallId: string;
  toolName: string;
  request: AskQuestionsRequest;
}

export interface PendingAssistantAux {
  kind: "thinking" | "compressing";
  statusText: string;
  detailText?: string;
}

export interface PendingMcpResource {
  server: string;
  displayName: string;
  uri: string;
  mimeType?: string;
  readAtUnixMs: number;
  content: string;
}

export interface AskQuestionsRequest {
  title?: string;
  questions: AskQuestionsQuestionSpec[];
}

export interface AskQuestionsQuestionSpec {
  id: string;
  title: string;
  allowMultiple: boolean;
  options: AskQuestionsOptionSpec[];
}

export interface AskQuestionsOptionSpec {
  id: string;
  label: string;
  summary?: string;
}

export interface AskQuestionsAnswer {
  questionId: string;
  selectedOptionIds: string[];
  customText?: string;
}

export interface AskQuestionsResult {
  status: "answered" | "skipped";
  answers?: AskQuestionsAnswer[];
}

export interface DesktopWebHostSnapshot {
  config: DesktopWebHostConfigSnapshot;
  status: DesktopWebHostStatusSnapshot;
  policy: DesktopWebHostPolicySnapshot;
}

export interface DesktopWebHostConfigSnapshot {
  enabled: boolean;
  host: string;
  port: number;
  paired: boolean;
  authMode: "pairing";
}

export interface DesktopWebHostStatusSnapshot {
  state: "disabled" | "stopped" | "starting" | "running" | "error";
  host: string;
  port: number;
  url?: string;
  error?: string;
  pairingCode?: string;
}

export interface DesktopWebHostPolicySnapshot {
  healthRequiresAuth: true;
  cors: "same-origin";
  allowHttpLan: true;
  allowRemoteControl: true;
}
