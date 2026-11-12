import path from "node:path";

import { resolveDesktopAgentMode } from "@spiritagent/ui/composer";
import { clearCodeCompletionStateForWorkspace } from "@spiritagent/code-completion/commands";
import type { PlanSnapshot } from "@spiritagent/api/types";
import {
  discoverWorkspaceRoot,
  applyLlmClientVersionFromApp,
  loadConfig,
  loadHostMetadata,
  mergeRecentWorkspaceRoots,
  normalizeWorkspaceBinding,
  resolveDesktopHomeDirectory,
  saveConfig,
  type DesktopConfigFile,
  type DesktopWorkspaceBinding,
  type HostMetadataSummary,
} from "@spiritagent/sessions/host/storage";
import { applyGitRevision, readWorkspaceGitSnapshot } from "@spiritagent/sessions/host/git";
import type { SessionRegistry } from "@spiritagent/sessions/host/session-registry";
import type { DesktopToolExecutor } from "@spiritagent/sessions/host/tool-executor";
import type {
  DesktopGitSnapshot,
  DesktopExtensionCssLayer,
  DesktopExtensionListItem,
  DesktopMarketplaceCatalogEntry,
  DesktopMarketplaceSource,
} from "@spiritagent/api/types";
import type { EphemeralSessionRecord } from "@spiritagent/sessions/host/sessions";
import { ensureBuiltInSkills, ensurePersonalMarketplace } from "@spiritagent/extensions";
import type { HostExtensionInstructionContributions } from "@spiritagent/extensions";
import {
  resolveWorkspaceBindingForRequestedRoot,
  sameWorkspaceRoot,
} from "@spiritagent/sessions/host/service-utils";
import { spiritDataDir } from "@spiritagent/sessions/host/storage";
import type { ExtensionWarmupTrigger } from "@spiritagent/sessions/host/extension-warmup";

export interface InitializationState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  metadata: HostMetadataSummary;
  plan: PlanSnapshot;
  extensionsList: DesktopExtensionListItem[];
  marketplaceSources: DesktopMarketplaceSource[];
  marketplaceCatalogs: Record<string, DesktopMarketplaceCatalogEntry[]>;
  marketplaceCatalogAll: DesktopMarketplaceCatalogEntry[];
  marketplaceWarnings: string[];
  extensionCss: DesktopExtensionCssLayer[];
  extensionInstructionContributions: HostExtensionInstructionContributions;
  ephemeralSessions: EphemeralSessionRecord[];
}

export interface HostInitializationContext {
  initialized(): boolean;
  state(): InitializationState | undefined;
  setState(state: InitializationState): void;
  setInitialized(initialized: boolean): void;
  setLastRuntimeError(error: string): void;
  setToolExecutor(executor: DesktopToolExecutor | undefined): void;
  sessionRegistry(): SessionRegistry;
  resetStreamingPlacementState(full: boolean): void;
  seedBuiltInExtensions(): Promise<void>;
  refreshExtensionsList(options?: { metadataOnly?: boolean }): Promise<void>;
  refreshRuntime(): Promise<void>;
  refreshLspSnapshot(): Promise<void>;
  deactivateExtensions(): Promise<void>;
  invalidateExtensionWarmup(): void;
  scheduleExtensionWarmup(trigger: ExtensionWarmupTrigger): void;
  loadDesktopPlanSnapshot(planPath: string, existsHint?: boolean): Promise<PlanSnapshot>;
  /** Fires once per full (re)initialization, after the workspace root lands in state. */
  evaluateWorkspaceTasksTrust(reason: string): void;
}

export async function ensureInitializedCommand(
  ctx: HostInitializationContext,
  workspaceRootOverride?: string,
  options: {
    fastPath?: boolean;
    preserveRecentWorkspaces?: boolean;
    /** Skip global runtime rebuild after workspace switch; caller will activate a session bundle. */
    deferRuntimeRefresh?: boolean;
    /** Skip extension warmup scheduling; caller will schedule after serialized work completes. */
    deferExtensionWarmup?: boolean;
    workspaceBinding?: DesktopWorkspaceBinding;
  } = {},
): Promise<void> {
  const requestedWorkspaceRoot = workspaceRootOverride?.trim()
    ? path.resolve(workspaceRootOverride.trim())
    : undefined;

  const loadedConfig = await loadConfig();
  applyLlmClientVersionFromApp();
  await ensureBuiltInSkills(spiritDataDir());
  await ensurePersonalMarketplace(spiritDataDir());
  const previousState = ctx.state();
  const previousBinding = normalizeWorkspaceBinding(
    previousState?.workspaceBinding ?? loadedConfig.workspaceBinding,
  );
  const workspaceBinding = resolveWorkspaceBindingForRequestedRoot({
    requestedWorkspaceRoot,
    explicitBinding: options.workspaceBinding,
    previousBinding,
    persistedBinding: normalizeWorkspaceBinding(loadedConfig.workspaceBinding),
  });

  const workspaceRoot =
    workspaceBinding === "none"
      ? resolveDesktopHomeDirectory()
      : (requestedWorkspaceRoot ??
        (previousState?.workspaceBinding === "project" ? previousState.workspaceRoot : undefined) ??
        loadedConfig.lastProjectWorkspaceRoot ??
        loadedConfig.recentWorkspaces?.[0] ??
        discoverWorkspaceRoot());

  if (
    options.fastPath === true &&
    ctx.initialized() &&
    previousState?.workspaceRoot &&
    sameWorkspaceRoot(previousState.workspaceRoot, workspaceRoot) &&
    previousBinding === workspaceBinding
  ) {
    return;
  }

  const git = await readWorkspaceGitSnapshot(workspaceRoot);
  let lastProjectWorkspaceRoot = loadedConfig.lastProjectWorkspaceRoot;
  if (
    workspaceBinding === "none" &&
    previousBinding === "project" &&
    previousState?.workspaceRoot &&
    !sameWorkspaceRoot(previousState.workspaceRoot, resolveDesktopHomeDirectory())
  ) {
    lastProjectWorkspaceRoot = previousState.workspaceRoot;
  }

  const preserveRecent = workspaceBinding === "none" || options.preserveRecentWorkspaces === true;
  const config = {
    ...loadedConfig,
    workspaceBinding,
    ...(lastProjectWorkspaceRoot ? { lastProjectWorkspaceRoot } : {}),
    recentWorkspaces: preserveRecent
      ? (loadedConfig.recentWorkspaces ?? [])
      : mergeRecentWorkspaceRoots(
          loadedConfig.recentWorkspaces,
          git.primaryRepoRoot ?? workspaceRoot,
        ),
  } satisfies DesktopConfigFile;

  const recentWorkspacesChanged =
    !loadedConfig.recentWorkspaces ||
    config.recentWorkspaces.length !== loadedConfig.recentWorkspaces.length ||
    config.recentWorkspaces.some(
      (entry, index) => entry !== loadedConfig.recentWorkspaces?.[index],
    );
  const bindingChanged =
    normalizeWorkspaceBinding(loadedConfig.workspaceBinding) !== workspaceBinding;
  const lastProjectChanged =
    loadedConfig.lastProjectWorkspaceRoot !== config.lastProjectWorkspaceRoot;
  if (recentWorkspacesChanged || bindingChanged || lastProjectChanged) {
    await saveConfig(config);
  }

  if (
    ctx.initialized() &&
    previousState?.workspaceRoot &&
    sameWorkspaceRoot(previousState.workspaceRoot, workspaceRoot) &&
    previousBinding === workspaceBinding
  ) {
    const currentState = ctx.state();
    if (!currentState) {
      return;
    }
    currentState.config = config;
    currentState.git = applyGitRevision(git, currentState.git.revision ?? 0);
    currentState.workspaceBinding = workspaceBinding;
    currentState.plan = await ctx.loadDesktopPlanSnapshot(
      currentState.metadata.planMetadata.path,
      currentState.metadata.planMetadata.exists,
    );
    await ctx.refreshLspSnapshot();
    return;
  }

  // Seed built-ins only on a full (re)initialization — first launch or a
  // workspace/binding switch. Production built-in updates ship with app
  // updates (which restart the host), so recopying on every ensure only
  // churned the install tree (pump ticks ensure every 25ms while busy).
  await ctx.seedBuiltInExtensions();

  const metadata = await loadHostMetadata(workspaceRoot, resolveDesktopAgentMode(config), {
    workspaceBinding,
  });
  const plan = await ctx.loadDesktopPlanSnapshot(
    metadata.planMetadata.path,
    metadata.planMetadata.exists,
  );
  const state = ctx.state();
  const previousWorkspaceRoot = state?.workspaceRoot;
  const switchingWorkspace = Boolean(
    previousWorkspaceRoot && !sameWorkspaceRoot(previousWorkspaceRoot, workspaceRoot),
  );
  if (switchingWorkspace) {
    await ctx.deactivateExtensions();
    ctx.invalidateExtensionWarmup();
  }

  if (switchingWorkspace) {
    ctx.setLastRuntimeError("");
    ctx.setToolExecutor(undefined);
    if (previousWorkspaceRoot) {
      clearCodeCompletionStateForWorkspace(previousWorkspaceRoot);
    }
    ctx.sessionRegistry().clearForWorkspaceSwitch(workspaceRoot);
    ctx.resetStreamingPlacementState(true);
  } else if (!ctx.sessionRegistry().hasActive()) {
    ctx.sessionRegistry().ensureDraft(workspaceRoot);
  } else {
    ctx.sessionRegistry().requireActive().workspaceRoot = workspaceRoot;
  }

  ctx.setState({
    workspaceRoot,
    workspaceBinding,
    config,
    git: applyGitRevision(git, 0, { reset: true }),
    metadata,
    plan,
    extensionsList: state?.extensionsList ?? [],
    marketplaceSources: state?.marketplaceSources ?? [],
    marketplaceCatalogs: state?.marketplaceCatalogs ?? {},
    marketplaceCatalogAll: state?.marketplaceCatalogAll ?? [],
    marketplaceWarnings: state?.marketplaceWarnings ?? [],
    extensionCss: state?.extensionCss ?? [],
    extensionInstructionContributions: state?.extensionInstructionContributions ?? {
      mcp: { servers: {} },
      mcpOwnership: {},
      hooks: [],
      skills: [],
      rules: [],
    },
    ephemeralSessions: state?.ephemeralSessions ?? [],
  });
  ctx.setInitialized(true);
  ctx.evaluateWorkspaceTasksTrust("startup");
  await ctx.refreshExtensionsList({ metadataOnly: true });
  await ctx.refreshLspSnapshot();
  const skipRuntimeRefresh = switchingWorkspace && options.deferRuntimeRefresh === true;
  if (!skipRuntimeRefresh) {
    await ctx.refreshRuntime();
  }
  if (options.deferExtensionWarmup !== true) {
    ctx.scheduleExtensionWarmup({ type: "startup", workspaceRoot });
  }
}
