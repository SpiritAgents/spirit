import { createJsonSchemaTransport } from "@spiritagent/agent-core";
import { applyCodeCompletionTransportProfile } from "@spiritagent/agent-core";
import { tryResolveTransportConfig } from "@spiritagent/config/resolve-transport";
import { CodeCompletionService } from "./service.js";
import type { CodeCompletionResult } from "./core/types.js";
import type { ModelRef } from "@spiritagent/config";

import type {
  RecordCodeCompletionFileStateRequest,
  RequestCodeCompletionRequest,
} from "@spiritagent/api/types";

const servicesByWorkspaceRoot = new Map<string, CodeCompletionService>();
const abortControllersByWorkspaceRoot = new Map<string, AbortController>();

export interface CodeCompletionCommandContext {
  workspaceRoot: string;
  spiritDataDir: string;
  config: {
    activeModel: ModelRef;
    secondaryLanguageModel?: ModelRef;
    providers: import("@spiritagent/config").ProviderEntry[];
    agents: { codeCompletion: { enabled: boolean } };
  };
  resolveSecondaryLanguageModelProfile: (config: CodeCompletionCommandContext["config"]) => {
    name: string;
    profile: { ref: ModelRef; providerId: string };
  } | null;
}

function codeCompletionEnabled(config: CodeCompletionCommandContext["config"]): boolean {
  return config.agents.codeCompletion.enabled;
}

function getService(workspaceRoot: string): CodeCompletionService {
  const existing = servicesByWorkspaceRoot.get(workspaceRoot);
  if (existing) {
    return existing;
  }
  const created = new CodeCompletionService();
  servicesByWorkspaceRoot.set(workspaceRoot, created);
  return created;
}

export function clearCodeCompletionStateForWorkspace(workspaceRoot: string): void {
  servicesByWorkspaceRoot.delete(workspaceRoot);
  abortControllersByWorkspaceRoot.get(workspaceRoot)?.abort();
  abortControllersByWorkspaceRoot.delete(workspaceRoot);
}

function beginCompletionRequest(workspaceRoot: string): AbortSignal {
  abortControllersByWorkspaceRoot.get(workspaceRoot)?.abort();
  const controller = new AbortController();
  abortControllersByWorkspaceRoot.set(workspaceRoot, controller);
  return controller.signal;
}

function endCompletionRequest(workspaceRoot: string, signal: AbortSignal): void {
  const active = abortControllersByWorkspaceRoot.get(workspaceRoot);
  if (active?.signal === signal) {
    abortControllersByWorkspaceRoot.delete(workspaceRoot);
  }
}

export function abortCodeCompletionCommand(workspaceRoot: string): void {
  abortControllersByWorkspaceRoot.get(workspaceRoot)?.abort();
  abortControllersByWorkspaceRoot.delete(workspaceRoot);
}

/**
 * The code-completion transport for the configured secondary model: config resolves the
 * declared profile + credentials from config.json, then the agent-core code-completion profile
 * strips reasoning/thinking. Returns undefined when setup is incomplete.
 */
export function resolveCodeCompletionTransportConfig(
  context: CodeCompletionCommandContext,
): ReturnType<typeof applyCodeCompletionTransportProfile> | undefined {
  const resolved = context.resolveSecondaryLanguageModelProfile(context.config);
  if (!resolved) {
    return undefined;
  }
  const resolvedTransport = tryResolveTransportConfig({
    workspaceRoot: context.workspaceRoot,
    spiritDataDir: context.spiritDataDir,
    modelRef: resolved.profile.ref,
  });
  if (!resolvedTransport.ok) {
    return undefined;
  }
  return applyCodeCompletionTransportProfile(resolvedTransport.config);
}

export async function requestCodeCompletionCommand(
  context: CodeCompletionCommandContext,
  request: RequestCodeCompletionRequest,
): Promise<CodeCompletionResult> {
  if (!codeCompletionEnabled(context.config)) {
    return { operations: [] };
  }

  const signal = beginCompletionRequest(context.workspaceRoot);
  try {
    const resolved = context.resolveSecondaryLanguageModelProfile(context.config);
    if (!resolved) {
      return { operations: [] };
    }

    const transportConfig = resolveCodeCompletionTransportConfig(context);
    if (!transportConfig) {
      return { operations: [] };
    }
    const transport = createJsonSchemaTransport(transportConfig);
    const service = getService(context.workspaceRoot);

    const result = await service.request(
      {
        workspaceRoot: context.workspaceRoot,
        relativePath: request.relativePath,
        languageId: request.languageId,
        documentText: request.documentText,
        cursorLine: request.cursorLine,
        cursorColumn: request.cursorColumn,
        signal,
      },
      {
        transport,
        transportConfig,
        modelName: resolved.name,
        providerId: resolved.profile.providerId,
      },
    );

    return result ?? { operations: [] };
  } catch (error) {
    if (signal.aborted) {
      return { operations: [] };
    }
    console.warn("[code-completion] request failed:", error);
    return { operations: [] };
  } finally {
    endCompletionRequest(context.workspaceRoot, signal);
  }
}

export function recordCodeCompletionFileStateCommand(
  context: CodeCompletionCommandContext,
  request: RecordCodeCompletionFileStateRequest,
): void {
  if (!codeCompletionEnabled(context.config)) {
    return;
  }
  getService(context.workspaceRoot).recordFileState({
    relativePath: request.relativePath,
    baselineText: request.baselineText,
    currentText: request.currentText,
  });
}

export function resetCodeCompletionJournalCommand(context: CodeCompletionCommandContext): void {
  getService(context.workspaceRoot).clearJournal();
}
