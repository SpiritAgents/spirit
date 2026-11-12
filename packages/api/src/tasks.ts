export type TaskFileSourceKind = "workspace" | "user" | "vscode-compat";

export interface LoadedTaskFile {
  path: string;
  sourceKind: TaskFileSourceKind;
  json: unknown;
  /** The file bytes exactly as read (before any JSONC stripping), for trust hashing. */
  rawText: string;
}

export type TaskPlatform = "win32" | "darwin" | "linux";

export type TaskQuotingStyle = "escape" | "strong" | "weak";

export interface TaskQuotedValue {
  value: string;
  quoting: TaskQuotingStyle;
}

export type TaskCommandValue = string | string[] | TaskQuotedValue;

export type TaskArgValue = string | TaskQuotedValue;

export type TaskType = "shell" | "process";

export interface TaskShellConfiguration {
  executable?: string;
  args?: string[];
}

export interface TaskOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: TaskShellConfiguration;
}

export type TaskRevealKind = "always" | "silent" | "never";

export type TaskPanelKind = "shared" | "dedicated" | "new";

export interface TaskPresentation {
  echo?: boolean;
  reveal?: TaskRevealKind;
  focus?: boolean;
  panel?: TaskPanelKind;
  clear?: boolean;
  close?: boolean;
  preserveTerminalName?: boolean;
}

export type TaskDependsOrder = "parallel" | "sequence";

export type TaskRunOn = "default" | "folderOpen" | "worktreeCreated";

export type TaskInstancePolicy =
  | "prompt"
  | "terminateNewest"
  | "terminateOldest"
  | "warn"
  | "silent";

export interface TaskRunOptions {
  reevaluateOnRerun: boolean;
  /** "unknown" marks a string the schema does not know; the task is hidden by the runOn rule. */
  runOn: TaskRunOn | "unknown";
  instanceLimit: number;
  instancePolicy: TaskInstancePolicy;
}

export interface NormalizedTaskDependsOn {
  labels: string[];
  hasObjectForm: boolean;
}

export interface NormalizedTaskOsOverride {
  command?: TaskCommandValue;
  args?: TaskArgValue[];
  options?: TaskOptions;
}

export interface NormalizedTask {
  label: string;
  type?: TaskType;
  command?: TaskCommandValue;
  args?: TaskArgValue[];
  quoting: TaskQuotingStyle;
  options?: TaskOptions;
  os: Partial<Record<TaskPlatform, NormalizedTaskOsOverride>>;
  isBackground?: boolean;
  promptOnClose?: boolean;
  dependsOn: NormalizedTaskDependsOn;
  dependsOrder: TaskDependsOrder;
  runOptions: TaskRunOptions;
  presentation: TaskPresentation;
  iconId?: string;
  detail?: string;
  hide?: boolean;
}

export interface NormalizedTaskFileDefaults {
  type?: TaskType;
  command?: TaskCommandValue;
  args?: TaskArgValue[];
  options?: TaskOptions;
  isBackground?: boolean;
  promptOnClose?: boolean;
  presentation?: TaskPresentation;
}

export interface NormalizedTaskFile {
  defaults: NormalizedTaskFileDefaults;
  osDefaults: Partial<Record<TaskPlatform, NormalizedTaskOsOverride>>;
  tasks: NormalizedTask[];
}

export interface MergedTask {
  label: string;
  type: TaskType;
  command?: TaskCommandValue;
  args?: TaskArgValue[];
  quoting: TaskQuotingStyle;
  options?: TaskOptions;
  isBackground?: boolean;
  promptOnClose?: boolean;
  dependsOn: NormalizedTaskDependsOn;
  dependsOrder: TaskDependsOrder;
  runOptions: TaskRunOptions;
  presentation: TaskPresentation;
  iconId?: string;
  detail?: string;
  hide?: boolean;
}

export interface ResolvedTaskRunOptions {
  reevaluateOnRerun: boolean;
  instanceLimit: number;
  /** Only "default" and "folderOpen" survive resolution; everything else is hidden. */
  runOn: "default" | "folderOpen";
}

export interface ResolvedTaskPresentation {
  echo: boolean;
  reveal: TaskRevealKind;
  focus: boolean;
  panel: TaskPanelKind;
  clear: boolean;
  close: boolean;
  preserveTerminalName: boolean;
}

export interface ResolvedTask {
  key: string;
  sourceFile: string;
  label: string;
  detail?: string;
  iconId?: string;
  hide: boolean;
  type: TaskType;
  command: TaskCommandValue;
  args: TaskArgValue[];
  quoting: TaskQuotingStyle;
  options: TaskOptions;
  isBackground: boolean;
  promptOnClose: boolean;
  dependsOn: string[];
  dependsOrder: TaskDependsOrder;
  runOptions: ResolvedTaskRunOptions;
  presentation: ResolvedTaskPresentation;
}

export interface TaskMenuItem {
  key: string;
  label: string;
  detail?: string;
  iconId?: string;
}

export type TaskHiddenRule =
  | "invalidTask"
  | "unsupportedVariable"
  | "unresolvableWorkspaceVariable"
  | "runOn"
  | "dependsOnObjectForm"
  | "dependsOnBackground"
  | "instancePolicy"
  | "cyclicDependency"
  | "transitiveHiddenDependency";

export interface HiddenTaskReason {
  key: string;
  label: string;
  rule: TaskHiddenRule;
}

export interface ResolveWorkspaceTasksResult {
  tasks: ResolvedTask[];
  menuItems: TaskMenuItem[];
  hiddenReasons: HiddenTaskReason[];
}

export interface TaskShellDefinition {
  executable: string;
  args: string[];
}
