import {
  buildActiveSkillPayload,
  buildActivateSkillUserTurn,
  createSkillFile,
  deleteSkillDir,
} from "./skills.js";
import { buildRuleDiscoveryContext, createRuleFile, deleteRuleFile } from "./rules.js";
import {
  addDesktopMcpServer,
  deleteDesktopMcpServer,
  inspectDesktopMcpServer,
} from "./service-mcp.js";
import { deleteDesktopHookEntry, saveDesktopHookEntry } from "./hooks.js";
import { invalidateSharedUserMcpToolingCache } from "@spiritagent/agent-core";
import i18n from "../lib/i18n-host.js";
import type {
  AddMcpServerRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteHookEntryRequest,
  DeleteRuleRequest,
  DeleteSkillRequest,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  ImportExtensionRequest,
  RunExtensionRequest,
  SaveHookEntryRequest,
  SubmitSkillSlashRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
} from "../types.js";
import type { HostExtensionEvent } from "@spiritagent/host-internal";
import type { LlmActiveSkill } from "@spiritagent/agent-core";
import type { DesktopExtensionHostAdapter } from "./extension-host-adapter.js";
import type { DesktopConfigFile, DesktopWorkspaceBinding, HostMetadataSummary } from "./storage.js";
import type { DesktopGitSnapshot } from "../types.js";

interface HostExtensionState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  metadata: HostMetadataSummary;
}

type HostExtensionManager = {
  importArchive(input: { archiveBase64: string; fileName?: string }): Promise<{
    id: string;
    manifest: { name: string; version: string };
  }>;
  remove(id: string): Promise<void>;
  run(input: { id: string; host: DesktopExtensionHostAdapter; logger: Console }): Promise<void>;
  setSettingsValues(input: {
    id: string;
    values: UpdateExtensionSettingsRequest["values"];
  }): Promise<unknown>;
  setSecretValue(input: { id: string; key: string; value?: string }): Promise<unknown>;
};

type McpRefreshable = {
  startBackgroundRefreshInBackground(force: boolean): void;
};

type McpInspectable = {
  inspectMcpServer(name: string): Promise<unknown>;
};

type McpBackgroundRefreshable = {
  startMcpBackgroundRefresh(): void;
};

export interface HostExtensionCommandContext {
  runSerialized<T>(work: () => Promise<T>, label?: string): Promise<T>;
  ensureInitialized(
    workspaceRootOverride?: string,
    options?: { fastPath?: boolean },
  ): Promise<void>;
  isInitialized(): boolean;
  requireState(): HostExtensionState;
  isRuntimeBusy(): boolean;
  requireRuntime(): { isBusy(): boolean };
  requireToolExecutor(): McpInspectable;
  toolExecutor(): McpBackgroundRefreshable | undefined;
  sharedMcpServiceForWorkspace(
    workspaceRoot: string,
    workspaceBinding: DesktopWorkspaceBinding,
  ): McpRefreshable;
  extensionManager(): HostExtensionManager;
  requireExtensionHostAdapter(): DesktopExtensionHostAdapter;
  refreshExtensionsList(): Promise<void>;
  refreshRuntime(): Promise<void>;
  refreshRuntimeAfterExtensionMutation(): Promise<void>;
  persistCurrentSessionIfNeeded(): Promise<void>;
  dispatchExtensionEvent(
    event: HostExtensionEvent,
    options?: { targetExtensionIds?: readonly string[] },
  ): Promise<void>;
  requireEnabledSkillEntry(skillName: string): HostMetadataSummary["skills"]["entries"][number];
  submitUserTurnAfterInitialized(
    text: string,
    options?: {
      displayText?: string;
      turnSkills?: LlmActiveSkill[];
    },
  ): Promise<DesktopSnapshot>;
  appendInlineAssistantReply(displayText: string, assistantText: string): Promise<DesktopSnapshot>;
  setLastRuntimeError(error: string): void;
  /** Invalidates the snapshot-side list cache after the MCP / hooks config is written to disk. */
  invalidateConfigListCaches(): void;
  buildSnapshot(): DesktopSnapshot;
}

export async function createRuleCommand(
  ctx: HostExtensionCommandContext,
  request: CreateRuleRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t("error.runtimeBusyRule"));
    }
    const state = ctx.requireState();
    const rootKind = request.rootKind ?? "workspaceSpirit";
    if (
      state.workspaceBinding === "none" &&
      (rootKind === "workspaceSpirit" || rootKind === "workspaceAgents")
    ) {
      throw new Error(i18n.t("error.workspaceRulesUnavailable"));
    }
    await createRuleFile(state.workspaceRoot, request);

    await ctx.refreshRuntime();
    ctx.setLastRuntimeError("");
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function deleteRuleCommand(
  ctx: HostExtensionCommandContext,
  request: DeleteRuleRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t("error.runtimeBusyDeleteRule"));
    }
    const state = ctx.requireState();
    await deleteRuleFile(
      state.workspaceRoot,
      request,
      buildRuleDiscoveryContext(state.workspaceRoot, state.workspaceBinding),
    );

    await ctx.refreshRuntime();
    ctx.setLastRuntimeError("");
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function createSkillCommand(
  ctx: HostExtensionCommandContext,
  request: CreateSkillRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t("error.runtimeBusySkill"));
    }
    const state = ctx.requireState();
    const rootKind = request.rootKind ?? "workspaceSpirit";
    if (
      state.workspaceBinding === "none" &&
      (rootKind === "workspaceSpirit" || rootKind === "workspaceAgents")
    ) {
      throw new Error(
        "Workspace-scoped skills are unavailable when workspace binding is disabled.",
      );
    }
    await createSkillFile(state.workspaceRoot, request);

    await ctx.refreshRuntime();
    ctx.setLastRuntimeError("");
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function addMcpServerCommand(
  ctx: HostExtensionCommandContext,
  request: AddMcpServerRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    const { scope } = await addDesktopMcpServer({
      request,
      workspaceRoot: state.workspaceRoot,
      workspaceBinding: state.workspaceBinding,
    });
    ctx.invalidateConfigListCaches();
    if (scope === "user") {
      invalidateSharedUserMcpToolingCache();
    }
    ctx
      .sharedMcpServiceForWorkspace(state.workspaceRoot, state.workspaceBinding)
      .startBackgroundRefreshInBackground(true);
    ctx.toolExecutor()?.startMcpBackgroundRefresh();
    return ctx.buildSnapshot();
  });
}

export async function deleteMcpServerCommand(
  ctx: HostExtensionCommandContext,
  request: DeleteMcpServerRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    const { scope } = await deleteDesktopMcpServer({
      request,
      workspaceRoot: state.workspaceRoot,
    });
    ctx.invalidateConfigListCaches();
    if (scope === "user") {
      invalidateSharedUserMcpToolingCache();
    }
    ctx
      .sharedMcpServiceForWorkspace(state.workspaceRoot, state.workspaceBinding)
      .startBackgroundRefreshInBackground(true);
    ctx.toolExecutor()?.startMcpBackgroundRefresh();
    return ctx.buildSnapshot();
  });
}

export async function inspectMcpServerCommand(
  ctx: HostExtensionCommandContext,
  name: string,
): Promise<DesktopMcpServerInspection> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    return inspectDesktopMcpServer({
      name,
      inspect: (serverName) => ctx.requireToolExecutor().inspectMcpServer(serverName),
    });
  });
}

export async function importExtensionCommand(
  ctx: HostExtensionCommandContext,
  request: ImportExtensionRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const archiveBase64 = request.archiveBase64.trim();
    if (!archiveBase64) {
      throw new Error(i18n.t("error.extensionZipRequired"));
    }

    const installed = await ctx.extensionManager().importArchive({
      archiveBase64,
      ...(request.fileName?.trim() ? { fileName: request.fileName.trim() } : {}),
    });
    await ctx.refreshExtensionsList();
    await ctx.refreshRuntimeAfterExtensionMutation();
    await ctx.dispatchExtensionEvent(
      {
        type: "onExtensionInstalled",
        detail: {
          extensionId: installed.id,
          name: installed.manifest.name,
          version: installed.manifest.version,
        },
      },
      { targetExtensionIds: [installed.id] },
    );
    return ctx.buildSnapshot();
  });
}

export async function deleteExtensionCommand(
  ctx: HostExtensionCommandContext,
  request: DeleteExtensionRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const id = request.id.trim();
    if (!id) {
      throw new Error(i18n.t("error.extensionIdRequired"));
    }

    await ctx.extensionManager().remove(id);
    await ctx.refreshExtensionsList();
    await ctx.refreshRuntimeAfterExtensionMutation();
    return ctx.buildSnapshot();
  });
}

export async function runExtensionCommand(
  ctx: HostExtensionCommandContext,
  request: RunExtensionRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const id = request.id.trim();
    if (!id) {
      throw new Error(i18n.t("error.extensionIdRequired"));
    }

    await ctx.extensionManager().run({
      id,
      host: ctx.requireExtensionHostAdapter(),
      logger: console,
    });
    return ctx.buildSnapshot();
  });
}

export async function updateExtensionSettingsCommand(
  ctx: HostExtensionCommandContext,
  request: UpdateExtensionSettingsRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const id = request.id.trim();
    if (!id) {
      throw new Error(i18n.t("error.extensionIdRequired"));
    }

    await ctx.extensionManager().setSettingsValues({
      id,
      values: request.values,
    });
    await ctx.refreshExtensionsList();
    await ctx.refreshRuntimeAfterExtensionMutation();
    return ctx.buildSnapshot();
  });
}

export async function updateExtensionSecretCommand(
  ctx: HostExtensionCommandContext,
  request: UpdateExtensionSecretRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const id = request.id.trim();
    const key = request.key.trim();
    if (!id) {
      throw new Error(i18n.t("error.extensionIdRequired"));
    }
    if (!key) {
      throw new Error(i18n.t("error.secretKeyRequired"));
    }

    await ctx.extensionManager().setSecretValue({
      id,
      key,
      ...(request.value !== undefined ? { value: request.value } : {}),
    });
    await ctx.refreshExtensionsList();
    await ctx.refreshRuntimeAfterExtensionMutation();
    return ctx.buildSnapshot();
  });
}

export async function deleteSkillCommand(
  ctx: HostExtensionCommandContext,
  request: DeleteSkillRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t("error.runtimeBusyDeleteSkill"));
    }
    const state = ctx.requireState();
    await deleteSkillDir(state.workspaceRoot, request);

    await ctx.refreshRuntime();
    ctx.setLastRuntimeError("");
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function submitSkillSlashCommand(
  ctx: HostExtensionCommandContext,
  request: SubmitSkillSlashRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    if (runtime.isBusy()) {
      throw new Error(i18n.t("error.runtimeBusy"));
    }

    const skillName = request.skillName.trim();
    if (!skillName) {
      throw new Error(i18n.t("error.skillNameRequired"));
    }

    const skill = ctx.requireEnabledSkillEntry(skillName);
    const payload = await buildActiveSkillPayload(skill);

    return ctx.submitUserTurnAfterInitialized(
      buildActivateSkillUserTurn(skillName, request.extraNote ?? ""),
      {
        displayText: request.rawText,
        turnSkills: [payload],
      },
    );
  });
}

export async function saveHookEntryCommand(
  ctx: HostExtensionCommandContext,
  request: SaveHookEntryRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    await saveDesktopHookEntry({
      request,
      workspaceRoot: state.workspaceRoot,
      workspaceBinding: state.workspaceBinding,
    });
    ctx.invalidateConfigListCaches();
    return ctx.buildSnapshot();
  });
}

export async function deleteHookEntryCommand(
  ctx: HostExtensionCommandContext,
  request: DeleteHookEntryRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    await deleteDesktopHookEntry({
      request,
      workspaceRoot: state.workspaceRoot,
      workspaceBinding: state.workspaceBinding,
    });
    ctx.invalidateConfigListCaches();
    return ctx.buildSnapshot();
  });
}
