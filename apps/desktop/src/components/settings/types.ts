import type { SettingsSidebarTab } from "@/components/session-sidebar";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { FontPreference } from "@/lib/font";
import type { TranslucencyPreference } from "@/lib/translucency";
import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteHookEntryRequest,
  DeleteMcpServerRequest,
  DeleteRuleRequest,
  DeleteSkillRequest,
  DesktopDreamOverviewItem,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  GitHubAuthStatus,
  GitHubDeviceAuthChallenge,
  ModelRef,
  PreviewModelsRequest,
  PreviewModelsResponse,
  SaveHookEntryRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
} from "@/types";

export type SettingsFormState = {
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  lightweightChatModel?: ModelRef;
  apiBase: string;
  uiLocale: string;
  apiKey: string;
  translucency: TranslucencyPreference;
  systemNotifications: boolean;
  trayIcon: boolean;
  /** Whether first-run onboarding (OOBE) has completed. */
  onboardingCompleted: boolean;
  agentMode: DesktopAgentMode;
  webHostEnabled: boolean;
  webHostHost: string;
  webHostPort: number;
  dreamEnabled: boolean;
  dreamDebugMode: boolean;
  lspEnabled: boolean;
  codeCompletionEnabled: boolean;
  commitAttributionEnabled: boolean;
  prAttributionEnabled: boolean;
  llmHttpVersion: "http1.1" | "http2";
};

export type SettingsViewProps = {
  tab: SettingsSidebarTab;
  extensionSettingsId?: string | null;
  font: FontPreference;
  onFontChange: (value: FontPreference) => void;
  clickablePointerCursor: boolean;
  onClickablePointerCursorChange: (enabled: boolean) => void;
  fontSmoothing: boolean;
  onFontSmoothingChange: (enabled: boolean) => void;
  settings: SettingsFormState;
  snapshot: DesktopSnapshot | null;
  apiReady: boolean;
  busyAction: string;
  modelsBusy: boolean;
  modelsPreviewBusy: boolean;
  mcpsBusy: boolean;
  hooksBusy: boolean;
  skillsBusy: boolean;
  rulesBusy: boolean;
  extensionsBusy: boolean;
  lspInstallBusy: boolean;
  isElectronShell: boolean;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  onInstallLspProvider: (providerId: string) => Promise<void>;
  onResetWebHostPairing?: () => Promise<void>;
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onAddProviderModels: (request: AddProviderModelsRequest) => Promise<void>;
  onPreviewModels: (request: PreviewModelsRequest) => Promise<PreviewModelsResponse>;
  onRemoveModel: (name: string) => Promise<void>;
  onRemoveProviderModels: (groupId: string) => Promise<void>;
  onAddMcpServer: (request: AddMcpServerRequest) => Promise<void>;
  onUpdateExtensionSettings: (request: UpdateExtensionSettingsRequest) => Promise<void>;
  onUpdateExtensionSecret: (request: UpdateExtensionSecretRequest) => Promise<void>;
  onDeleteMcpServer: (request: DeleteMcpServerRequest) => Promise<void>;
  onSaveHookEntry: (request: SaveHookEntryRequest) => Promise<void>;
  onDeleteHookEntry: (request: DeleteHookEntryRequest) => Promise<void>;
  onInspectMcpServer: (name: string) => Promise<DesktopMcpServerInspection>;
  onCreateSkill: (request: CreateSkillRequest) => Promise<void>;
  onDeleteSkill: (request: DeleteSkillRequest) => Promise<void>;
  onCreateRule: (request: CreateRuleRequest) => Promise<void>;
  onDeleteRule: (request: DeleteRuleRequest) => Promise<void>;
  onListDreamsOverview: () => Promise<DesktopDreamOverviewItem[]>;
  /** Skills page "Generate Skill": returns to the main conversation area and inserts a create-skill Chip; natural language follows directly. */
  onGenerateSkillNavigate?: () => void;
  /** Rules page "Generate Rule": returns to the main conversation area and inserts a create-rule Chip. */
  onGenerateRuleNavigate?: () => void;
  /** Hooks page "Generate Hooks": returns to the main conversation area and inserts a create-hook Chip. */
  onGenerateHookNavigate?: () => void;
  /** Developer page: plays the context-compaction UI demo in the conversation area (no model call). */
  onStartCompactionUiDemo?: () => void;
  /** Developer page: loads an extremely long message list performance demo in the conversation area (no model call). */
  onStartLongConversationListDemo?: () => void;
  /** Windows Mica / macOS Vibrancy: the inner layer is transparent to avoid double-tint darkening with settings-shell. */
  useTranslucency?: boolean;
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>;
  beginGitHubDeviceLogin: () => Promise<GitHubDeviceAuthChallenge>;
  completeGitHubDeviceLogin: () => Promise<GitHubAuthStatus>;
  cancelGitHubDeviceLogin: () => Promise<void>;
  disconnectGitHub: () => Promise<GitHubAuthStatus>;
};
