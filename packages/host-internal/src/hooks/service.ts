import {
  emptyHookRunResult,
  hookMatcherTarget,
  mergePreEventHookPermission,
  serializeHookInput,
  type HookCommandOutput,
  type HookEventName,
  type HookInput,
  type HookPermission,
  type HookRunResult,
  type HookRunner,
  type HookRunnerContext,
  type ResolvedHookDefinition,
  isPreHookEvent,
} from "@spiritagent/agent-core";

import { runCommandHook } from "./command-runner.js";
import { listHookDefinitionsForInput, loadHooksConfig, type LoadedHooksConfig } from "./loader.js";
import {
  applyWorkspaceCapabilityTrustDecision,
  computeWorkspaceHooksContentHash,
  evaluateWorkspaceHooksTrustGate,
  filterDefinitionsByWorkspaceTrust,
  type RequestWorkspaceCapabilityTrust,
} from "./trust.js";

function applyPreEventPermission(
  aggregate: HookRunResult,
  permission: HookPermission,
  output: HookCommandOutput,
): HookRunResult {
  const merged = aggregate.permission
    ? mergePreEventHookPermission(aggregate.permission, permission)
    : permission;

  if (merged === "deny") {
    return {
      ...aggregate,
      denied: true,
      permission: "deny",
      userMessage: output.userMessage ?? aggregate.userMessage,
      agentMessage: output.agentMessage ?? aggregate.agentMessage,
    };
  }

  return {
    ...aggregate,
    permission: merged,
    userMessage: output.userMessage ?? aggregate.userMessage,
    agentMessage: output.agentMessage ?? aggregate.agentMessage,
  };
}

function applyOutput(
  aggregate: HookRunResult,
  event: HookEventName,
  output: HookCommandOutput | null | undefined,
): HookRunResult {
  if (!output) {
    return aggregate;
  }

  if (isPreHookEvent(event) && output.permission) {
    aggregate = applyPreEventPermission(aggregate, output.permission, output);
    if (aggregate.denied) {
      return aggregate;
    }
  }

  if (output.updatedInput) {
    aggregate.updatedInput = output.updatedInput;
  }

  if (output.additionalContext?.trim()) {
    aggregate.additionalContexts.push(output.additionalContext.trim());
  }

  if (output.followupMessage?.trim()) {
    aggregate.followupMessage = output.followupMessage.trim();
  }

  return aggregate;
}

export interface CreateHookRunnerOptions extends HookRunnerContext {
  logger?: (message: string) => void;
  reloadConfig?: () => LoadedHooksConfig;
  /**
   * When workspace hooks need a trust decision, hosts prompt the user.
   * If omitted, workspace hooks are denied (safe default for non-interactive hosts).
   */
  requestWorkspaceCapabilityTrust?: RequestWorkspaceCapabilityTrust;
  /**
   * Extra hook definitions from enabled extensions. Not listed in settings and
   * not gated by workspace capability trust.
   */
  loadExtensionHooks?: (
    event: HookEventName,
    matcherTarget?: string,
  ) => Promise<readonly ResolvedHookDefinition[]> | readonly ResolvedHookDefinition[];
}

export function createHookRunner(options: CreateHookRunnerOptions): HookRunner {
  const getLoaded = (): LoadedHooksConfig =>
    options.reloadConfig?.() ??
    loadHooksConfig({
      spiritDataDir: options.spiritDataDir,
      workspaceRoot: options.workspaceRoot,
    });

  let inFlightTrust: Promise<boolean> | undefined;

  async function ensureWorkspaceHooksAllowed(loaded: LoadedHooksConfig): Promise<boolean> {
    if (inFlightTrust) {
      return inFlightTrust;
    }

    inFlightTrust = (async () => {
      const gate = await evaluateWorkspaceHooksTrustGate({
        spiritDataDir: options.spiritDataDir,
        workspaceRoot: options.workspaceRoot,
        loaded,
      });

      if (gate.status === "noWorkspaceHooks") {
        return false;
      }
      if (gate.status === "allow") {
        return true;
      }

      if (!options.requestWorkspaceCapabilityTrust) {
        options.logger?.(
          "Skipping workspace hooks: no trust prompt available (non-interactive default deny).",
        );
        return false;
      }

      const decision = await options.requestWorkspaceCapabilityTrust(gate.request);
      if (decision === "deny") {
        options.logger?.("Skipping workspace hooks: user denied workspace capability trust.");
        return false;
      }

      // Re-hash after the interactive prompt: scripts may have changed while the user decided.
      const freshLoaded = getLoaded();
      const currentHash = computeWorkspaceHooksContentHash(freshLoaded);
      if (!currentHash || currentHash !== gate.request.contentHash) {
        options.logger?.(
          "Skipping workspace hooks: content hash changed while awaiting trust decision.",
        );
        return false;
      }

      await applyWorkspaceCapabilityTrustDecision({
        spiritDataDir: options.spiritDataDir,
        workspaceRoot: gate.request.workspaceRoot,
        contentHash: currentHash,
        decision,
      });
      return true;
    })().finally(() => {
      inFlightTrust = undefined;
    });

    return inFlightTrust;
  }

  async function runEvent(input: HookInput): Promise<HookRunResult> {
    const loaded = getLoaded();
    const matcherTarget = hookMatcherTarget(input);
    const extensionHooks = options.loadExtensionHooks
      ? await options.loadExtensionHooks(input.hookEventName, matcherTarget)
      : [];
    const definitions = [
      ...listHookDefinitionsForInput(loaded, input),
      ...filterExtensionHooksByMatcher(extensionHooks, matcherTarget),
    ];
    if (definitions.length === 0) {
      return emptyHookRunResult();
    }

    const hasWorkspace = definitions.some((definition) => definition.scope === "workspace");
    const workspaceAllowed = hasWorkspace ? await ensureWorkspaceHooksAllowed(loaded) : false;
    const runnable = filterDefinitionsByWorkspaceTrust(definitions, workspaceAllowed);
    if (runnable.length === 0) {
      return emptyHookRunResult();
    }

    const inputJson = JSON.stringify(serializeHookInput(input));
    let aggregate = emptyHookRunResult();

    for (const definition of runnable) {
      const hookOptions: Parameters<typeof runCommandHook>[0] = {
        definition,
        inputJson,
      };
      if (options.logger) {
        hookOptions.logger = options.logger;
      }
      const result = await runCommandHook(hookOptions);
      aggregate.records.push(result.record);

      if (result.denied) {
        aggregate.denied = true;
        aggregate.permission = "deny";
        aggregate.userMessage = result.effectiveOutput?.userMessage ?? aggregate.userMessage;
        aggregate.agentMessage = result.effectiveOutput?.agentMessage ?? aggregate.agentMessage;
        break;
      }

      aggregate = applyOutput(aggregate, input.hookEventName, result.effectiveOutput);
    }

    return aggregate;
  }

  return {
    runSessionStart: (input) =>
      runEvent({ ...input, hookEventName: "sessionStart", timestamp: new Date().toISOString() }),
    runSessionEnd: (input) =>
      runEvent({ ...input, hookEventName: "sessionEnd", timestamp: new Date().toISOString() }),
    runSubmitPrompt: (input) =>
      runEvent({ ...input, hookEventName: "submitPrompt", timestamp: new Date().toISOString() }),
    runPreToolUse: (input) =>
      runEvent({ ...input, hookEventName: "preToolUse", timestamp: new Date().toISOString() }),
    runPostToolUse: (input) =>
      runEvent({ ...input, hookEventName: "postToolUse", timestamp: new Date().toISOString() }),
    runSubagentStart: (input) =>
      runEvent({ ...input, hookEventName: "subagentStart", timestamp: new Date().toISOString() }),
    runSubagentEnd: (input) =>
      runEvent({ ...input, hookEventName: "subagentEnd", timestamp: new Date().toISOString() }),
  };
}

function filterExtensionHooksByMatcher(
  definitions: readonly ResolvedHookDefinition[],
  matcherTarget: string | undefined,
): ResolvedHookDefinition[] {
  return definitions.filter((definition) => {
    if (!definition.matcher || matcherTarget === undefined) {
      return true;
    }
    try {
      return new RegExp(definition.matcher).test(matcherTarget);
    } catch {
      return false;
    }
  });
}

export { loadHooksConfig, summarizeHooksConfig } from "./loader.js";
