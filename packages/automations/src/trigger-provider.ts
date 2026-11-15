import type { JsonObject } from "@spiritagent/agent-core";

export type AutomationTriggerSettingValue = string | number | boolean | null;

export interface AutomationTriggerSettingsAccessor {
  get(key: string): Promise<AutomationTriggerSettingValue | undefined>;
  getAll(): Promise<Record<string, AutomationTriggerSettingValue>>;
  set(key: string, value: AutomationTriggerSettingValue): Promise<void>;
  setAll(
    values: Record<string, AutomationTriggerSettingValue>,
  ): Promise<Record<string, AutomationTriggerSettingValue>>;
}

export interface AutomationTriggerSecretsAccessor {
  get(key: string): Promise<string | undefined>;
  has(key: string): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type AutomationTriggerIcon =
  | { type: "spirit"; name: string }
  | { type: "file"; path: string }
  | { type: "image"; dataUrl: string };

export interface AutomationTriggerContributionDefinition {
  id: string;
  name: string;
  description: string;
  icon: AutomationTriggerIcon;
  configuration?: "menu";
  inputSchema: JsonObject;
  authorization?: string;
}

export interface AutomationTriggerValidation {
  config: JsonObject;
  label: string;
}

export interface AutomationTriggerContext<THostApi = unknown> {
  host: THostApi;
  contributionId: string;
  settings: AutomationTriggerSettingsAccessor;
  secrets: AutomationTriggerSecretsAccessor;
}

export interface AutomationTriggerValidateContext<
  THostApi = unknown,
> extends AutomationTriggerContext<THostApi> {
  config: JsonObject;
}

export type AutomationTriggerMenuItem =
  | {
      action: "submenu";
      id: string;
      label: string;
      description?: string;
      icon?: AutomationTriggerIcon;
      disabled?: boolean;
    }
  | {
      action: "select";
      id: string;
      label: string;
      description?: string;
      icon?: AutomationTriggerIcon;
      disabled?: boolean;
      config: JsonObject;
    };

export interface AutomationTriggerMenuPage {
  items: AutomationTriggerMenuItem[];
  searchPlaceholder?: string;
  hasMore?: boolean;
}

export interface AutomationTriggerMenuContext<
  THostApi = unknown,
> extends AutomationTriggerContext<THostApi> {
  path: string[];
  query?: string;
  page: number;
  signal: AbortSignal;
}

export interface AutomationTriggerPollTarget {
  automationId: string;
  config: JsonObject;
  state?: JsonObject;
}

export interface AutomationTriggerProviderEvent {
  id: string;
  summary: string;
  context?: JsonObject;
  checkpoint: JsonObject;
}

export interface AutomationTriggerPollResult {
  automationId: string;
  checkpoint?: JsonObject;
  events?: AutomationTriggerProviderEvent[];
  error?: string;
}

export interface AutomationTriggerPollContext<
  THostApi = unknown,
> extends AutomationTriggerContext<THostApi> {
  triggers: AutomationTriggerPollTarget[];
  signal: AbortSignal;
}

export interface AutomationTriggerPollOutput {
  results: AutomationTriggerPollResult[];
}

export interface AutomationTriggerProvider<THostApi = unknown> {
  validate(
    context: AutomationTriggerValidateContext<THostApi>,
  ): Promise<AutomationTriggerValidation> | AutomationTriggerValidation;
  menu?(
    context: AutomationTriggerMenuContext<THostApi>,
  ): Promise<AutomationTriggerMenuPage> | AutomationTriggerMenuPage;
  poll(
    context: AutomationTriggerPollContext<THostApi>,
  ): Promise<AutomationTriggerPollOutput> | AutomationTriggerPollOutput;
}

export interface RegisteredAutomationTriggerContribution extends AutomationTriggerContributionDefinition {
  kind: string;
  extensionId: string;
  contributionId: string;
}

export function extensionAutomationTriggerKind(
  sourceId: string,
  extensionName: string,
  contributionId: string,
): string {
  return `extension:${sourceId}/${extensionName}/${contributionId}`;
}

export function isAutomationTriggerKind(value: string): boolean {
  return value.startsWith("extension:");
}

export function assertAutomationTriggerJsonObject(
  value: unknown,
  fieldName: string,
): asserts value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
}
