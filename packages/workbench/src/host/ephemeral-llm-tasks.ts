import {
  buildDreamReadHostToolDefinitions,
  type LlmExtensionSystemPrompt,
  type LlmToolAgentBasicInfo,
} from "@spiritagent/agent-core";
import { generateWorktreeNamesFromTask } from "@spiritagent/workspace";
import { resolveTransportConfig } from "@spiritagent/config/resolve-transport";

import i18n from "@spiritagent/i18n/host";
import type { ModelRef } from "@spiritagent/api/types";
import { spiritDataDir, type HostMetadataSummary } from "@spiritagent/sessions/host/storage";
import { buildDreamContextText } from "./dreams.js";
import type { DesktopToolExecutor } from "@spiritagent/sessions/host/tool-executor";
import type { GeneratedWorktreeNames } from "@spiritagent/workspace/worktree-naming";

interface BackgroundLlmTaskContext {
  workspaceRoot: string;
  gitBranch?: string;
  /** The task model; transport resolution uses the shared configuration domain. */
  taskModelRef: ModelRef;
  metadata: HostMetadataSummary;
  extensionSystemPrompts: LlmExtensionSystemPrompt[];
  toolExecutor: DesktopToolExecutor;
  runtimeBasicInfo: LlmToolAgentBasicInfo;
}

export async function generateWorktreeNamesFromModelTask(
  context: BackgroundLlmTaskContext & {
    userPrompt: string;
    baseBranch: string;
    repoRoot: string;
  },
): Promise<GeneratedWorktreeNames> {
  const transportConfig = buildTaskTransportConfig(context);
  const dreamContextText = await buildDreamContextText({
    workspaceRoot: context.workspaceRoot,
    gitBranch: context.gitBranch,
  });
  return generateWorktreeNamesFromTask({
    transport: transportConfig,
    task: context.userPrompt,
    baseBranch: context.baseBranch,
    repoRoot: context.repoRoot,
    workspaceRoot: context.workspaceRoot,
    toolExecutor: context.toolExecutor,
    enabledRules: context.metadata.rules.enabledRules,
    enabledSkillCatalog: context.metadata.skills.enabledSkillCatalog,
    extensionSystemPrompts: context.extensionSystemPrompts,
    planMetadata: context.metadata.planMetadata,
    runtimeBasicInfo: context.runtimeBasicInfo,
    ...(dreamContextText ? { dreamContextText } : {}),
    extraToolDefinitions: context.gitBranch ? buildDreamReadHostToolDefinitions() : [],
    errorMessages: {
      failurePrefix: (error) => i18n.t("error.autoWorktreeNameFailed", { error }),
      noBody: i18n.t("error.autoWorktreeNameFailedNoBody"),
      interactiveTool: (name) => i18n.t("error.autoWorktreeNameFailedInteractiveTool", { name }),
      incomplete: i18n.t("error.autoWorktreeNameFailedIncomplete"),
    },
  });
}

function buildTaskTransportConfig(context: BackgroundLlmTaskContext) {
  return resolveTransportConfig({
    workspaceRoot: context.workspaceRoot,
    spiritDataDir: spiritDataDir(),
    modelRef: context.taskModelRef,
  });
}
