export type DesktopModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "custom"
  | "vercel-ai-gateway"
  | "openrouter";

export type DesktopTransportKind = "openai-compatible" | "anthropic" | "responses";

export type DesktopWorkspaceBinding = "project" | "none";

export interface DesktopAvailableWorkspace {
  label: string;
  path: string;
}

export type DesktopModelReasoningEffort = "low" | "medium" | "high";

export interface PreviewModelCatalogPricing {
  inputPerTokenUsd?: string;
  outputPerTokenUsd?: string;
  imagePerUnitUsd?: string;
  requestPerCallUsd?: string;
}

export type DesktopModelCapability =
  | "languageModel"
  | "image"
  | "video"
  | "imageGeneration"
  | "videoGeneration";

export interface PreviewModelCatalogEntry {
  id: string;
  displayName?: string;
  description?: string;
  pricing?: PreviewModelCatalogPricing;
  capabilities?: DesktopModelCapability[];
  supportedReasoningEfforts?: DesktopModelReasoningEffort[];
  contextLength?: number;
}

export interface ModelProfileSnapshot {
  name: string;
  apiBase: string;
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  keyConfigured?: boolean;
  reasoningEffort?: DesktopModelReasoningEffort;
  supportedReasoningEfforts?: DesktopModelReasoningEffort[];
  capabilities?: DesktopModelCapability[];
  contextLength?: number;
}

export interface DesktopModelCatalogHint {
  apiBase: string;
  modelIds: string[];
  fetchedAtUnixMs: number;
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  modelCatalog?: PreviewModelCatalogEntry[];
}

export type DesktopCommitMode = "commit" | "commit-and-push";

export interface SessionListItem {
  path: string;
  displayName: string;
  modifiedAtUnixMs: number;
  workspaceRoot: string;
  gitBranch?: string;
  kind?: "stored" | "ephemeral";
  readOnly?: boolean;
  isBusy?: boolean;
  isBlocked?: boolean;
}

export type WorkspaceExplorerEntryKind = "file" | "dir";

export interface WorkspaceExplorerEntry {
  name: string;
  kind: WorkspaceExplorerEntryKind;
}

export interface WorkspaceExplorerListResult {
  entries: WorkspaceExplorerEntry[];
}

export interface WorkspaceReadTextFileResult {
  text: string;
}

export interface WriteWorkspaceTextFileRequest {
  relativePath: string;
  text: string;
}

export interface ToolBlockSnapshot {
  toolCallId?: string;
  toolName: string;
  phase: "preview" | "pending-approval" | "running" | "succeeded" | "failed";
  headline: string;
  headlineDetail?: string;
  detailLines: string[];
  argsExcerpt?: string;
  outputExcerpt?: string;
  imagePaths?: string[];
}

export interface PlanSnapshot {
  path: string;
  exists: boolean;
  content: string;
}

export interface MessageAuxSnapshot {
  thinking?: string;
  compaction?: string;
}

export interface ConversationMessageSnapshot {
  id: number;
  role: "user" | "assistant";
  content: string;
  tool?: ToolBlockSnapshot;
  aux?: MessageAuxSnapshot;
  pending: boolean;
  canRewind?: boolean;
  browserElements?: Array<{
    id: string;
    tagName: string;
    url: string;
    pageUrl?: string;
  }>;
}
