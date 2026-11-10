import path from "node:path";

import { normalizeWorkLocationKind } from "@spiritagent/host-internal";

import i18n from "../lib/i18n-host.js";
import type {
  DesktopGitSnapshot,
  DesktopSnapshot,
  SetPanePendingGitBranchRequest,
  SetPaneWorkLocationRequest,
  CheckoutPaneGitBranchRequest,
  SwitchPaneWorkspaceRequest,
} from "../types.js";
import { applyGitRevision, checkoutWorkspaceGitBranch, readWorkspaceGitSnapshot } from "./git.js";
import type { SessionBundle } from "./session-bundle.js";
import type { SessionSplitHostContext } from "./session-split.js";
import { isNoWorkspaceSessionRoot, sameWorkspaceRoot } from "./service-utils.js";
import { normalizeWorkspaceBinding, resolveDesktopHomeDirectory } from "./storage.js";

export interface PaneWorkspaceHostContext extends SessionSplitHostContext {
  adoptProjectWorkspaceForForeground(
    workspaceRoot: string,
    options?: { deferHeavyWork?: boolean },
  ): Promise<void>;
  adoptNoWorkspaceForForeground(options?: { deferHeavyWork?: boolean }): Promise<void>;
  refreshRuntimeForBundle(bundle: SessionBundle): Promise<void>;
  invalidatePaneSessionSliceCache(sessionPath: string): void;
  invalidateAllPaneSessionSliceCache(): void;
}

/** Keep per-pane git snapshots when visible panes use different workspace roots than host state. */
export async function ensureVisiblePaneScopedGitSnapshots(
  ctx: Pick<
    PaneWorkspaceHostContext,
    "sessionRegistry" | "requireState" | "visiblePaneSessionPaths"
  >,
): Promise<{ syncedSessionPaths: string[]; clearedSessionPaths: string[] }> {
  const state = ctx.requireState();
  const registry = ctx.sessionRegistry();
  const activeBundle = registry.getActive();
  const syncedSessionPaths: string[] = [];
  const clearedSessionPaths: string[] = [];

  for (const sessionPath of ctx.visiblePaneSessionPaths()) {
    const resolved = path.resolve(sessionPath);
    const bundle = registry.findBySessionPath(resolved);
    if (!bundle) {
      continue;
    }

    const workspaceRoot = resolveEffectivePaneWorkspaceRoot(bundle, state);
    const workspaceBinding =
      bundle.workspaceBinding ?? (isNoWorkspaceSessionRoot(workspaceRoot) ? "none" : "project");
    const usesGlobalGit =
      bundle === activeBundle ||
      (sameWorkspaceRoot(workspaceRoot, state.workspaceRoot) &&
        workspaceBinding === normalizeWorkspaceBinding(state.workspaceBinding));

    if (usesGlobalGit) {
      if (bundle.scopedGit) {
        bundle.scopedGit = undefined;
        clearedSessionPaths.push(resolved);
      }
      continue;
    }

    const git = applyGitRevision(
      await readWorkspaceGitSnapshot(workspaceRoot),
      bundle.scopedGit?.revision ?? 0,
      { reset: !bundle.scopedGit },
    );
    git.workLocation = bundle.workLocation;
    if (bundle.pendingGitBranch) {
      git.selectedBranch = bundle.pendingGitBranch;
    }
    bundle.scopedGit = git;
    syncedSessionPaths.push(resolved);
  }

  return { syncedSessionPaths, clearedSessionPaths };
}

/** Cache pane git before mutating global workspace/git so mid-switch snapshots stay correct. */
export async function prefetchScopedGitBeforeGlobalWorkspaceChange(
  ctx: Pick<
    PaneWorkspaceHostContext,
    "sessionRegistry" | "requireState" | "visiblePaneSessionPaths"
  >,
  nextWorkspaceRoot: string,
  nextWorkspaceBinding: import("../types.js").DesktopWorkspaceBinding,
): Promise<void> {
  const state = ctx.requireState();
  const registry = ctx.sessionRegistry();
  const activeBundle = registry.getActive();
  const nextRoot = path.resolve(nextWorkspaceRoot);
  const nextBinding = normalizeWorkspaceBinding(nextWorkspaceBinding);
  const prefetched: string[] = [];

  for (const sessionPath of ctx.visiblePaneSessionPaths()) {
    const resolved = path.resolve(sessionPath);
    const bundle = registry.findBySessionPath(resolved);
    if (!bundle || bundle === activeBundle) {
      continue;
    }

    const workspaceRoot = resolveEffectivePaneWorkspaceRoot(bundle, state);
    const workspaceBinding =
      bundle.workspaceBinding ?? (isNoWorkspaceSessionRoot(workspaceRoot) ? "none" : "project");
    const willShareGlobal =
      sameWorkspaceRoot(workspaceRoot, nextRoot) && workspaceBinding === nextBinding;

    if (willShareGlobal) {
      if (bundle.scopedGit) {
        bundle.scopedGit = undefined;
      }
      continue;
    }

    const git = applyGitRevision(await readWorkspaceGitSnapshot(workspaceRoot), 0, { reset: true });
    git.workLocation = bundle.workLocation;
    if (bundle.pendingGitBranch) {
      git.selectedBranch = bundle.pendingGitBranch;
    }
    bundle.scopedGit = git;
    prefetched.push(resolved);
  }
}

export async function switchPaneWorkspaceCommand(
  ctx: PaneWorkspaceHostContext,
  request: SwitchPaneWorkspaceRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });

    const sessionPath = path.resolve(request.sessionPath.trim());
    if (!sessionPath) {
      throw new Error("Split pane session path is required.");
    }

    const registry = ctx.sessionRegistry();
    const bundle = registry.findBySessionPath(sessionPath);
    if (!bundle) {
      throw new Error("Session not found.");
    }

    const state = ctx.requireState();
    const isForeground = registry.getActive() === bundle;
    const visiblePaneCount = ctx.visiblePaneSessionPaths().length;

    let workspaceRoot: string;
    if (request.workspaceBinding === "none") {
      workspaceRoot = resolveDesktopHomeDirectory();
    } else {
      const trimmed = request.workspaceRoot?.trim();
      if (!trimmed) {
        throw new Error("Project workspace path is required.");
      }
      workspaceRoot = path.resolve(trimmed);
    }

    const workspaceBinding = request.workspaceBinding ?? "project";
    const previousRoot = resolveEffectivePaneWorkspaceRoot(bundle, state);
    const workspaceChanged =
      !sameWorkspaceRoot(previousRoot, workspaceRoot) ||
      normalizeWorkspaceBinding(bundle.workspaceBinding ?? state.workspaceBinding) !==
        workspaceBinding;

    bundle.workspaceRoot = workspaceRoot;
    bundle.workspaceBinding = workspaceBinding;
    bundle.pendingGitBranch = undefined;
    bundle.workLocation = "local";

    if (isForeground) {
      bundle.scopedGit = undefined;
      const deferHeavyWork = visiblePaneCount > 1;
      if (workspaceBinding === "none") {
        await ctx.adoptNoWorkspaceForForeground({ deferHeavyWork });
      } else {
        await ctx.adoptProjectWorkspaceForForeground(workspaceRoot, { deferHeavyWork });
      }
    } else {
      const git = applyGitRevision(await readWorkspaceGitSnapshot(workspaceRoot), 0, {
        reset: true,
      });
      git.workLocation = bundle.workLocation;
      bundle.scopedGit = git;
      if (workspaceChanged && bundle.runtime && !bundle.runtime.isBusy()) {
        await ctx.refreshRuntimeForBundle(bundle);
      }
    }

    ctx.invalidatePaneSessionSliceCache(sessionPath);
    if (!isForeground) {
      await ensureVisiblePaneScopedGitSnapshots(ctx);
      ctx.invalidateAllPaneSessionSliceCache();
    }

    const snapshot = ctx.buildSnapshot();

    return snapshot;
  });
}

export function resolveEffectivePaneWorkspaceRoot(
  bundle: Pick<SessionBundle, "workspaceRoot">,
  state: { workspaceRoot: string },
): string {
  const fromBundle = bundle.workspaceRoot?.trim();
  if (fromBundle) {
    return fromBundle;
  }
  return state.workspaceRoot;
}

export function resolvePaneWorkspaceProjection(input: {
  bundle: SessionBundle;
  state: {
    workspaceRoot: string;
    workspaceBinding: import("../types.js").DesktopWorkspaceBinding;
    git: import("../types.js").DesktopGitSnapshot;
  };
  isForegroundActive: boolean;
}):
  | {
      workspaceRoot: string;
      workspaceBinding: import("../types.js").DesktopWorkspaceBinding;
      git: import("../types.js").DesktopGitSnapshot;
    }
  | undefined {
  if (input.isForegroundActive) {
    return undefined;
  }

  const workspaceRoot = resolveEffectivePaneWorkspaceRoot(input.bundle, input.state);
  const workspaceBinding =
    input.bundle.workspaceBinding ?? (isNoWorkspaceSessionRoot(workspaceRoot) ? "none" : "project");

  const baseGit =
    input.bundle.scopedGit ??
    (sameWorkspaceRoot(workspaceRoot, input.state.workspaceRoot) &&
    workspaceBinding === normalizeWorkspaceBinding(input.state.workspaceBinding)
      ? input.state.git
      : undefined);

  const git: import("../types.js").DesktopGitSnapshot = baseGit
    ? {
        ...baseGit,
        workLocation: input.bundle.workLocation,
        ...(input.bundle.pendingGitBranch ? { selectedBranch: input.bundle.pendingGitBranch } : {}),
      }
    : {
        revision: 0,
        isRepository: false,
        hasChanges: false,
        branches: [],
        aheadCount: 0,
        behindCount: 0,
        needsPush: false,
        workLocation: input.bundle.workLocation,
      };

  return {
    workspaceRoot,
    workspaceBinding,
    git,
  };
}

async function resolvePaneGitSnapshotForMutation(
  ctx: Pick<PaneWorkspaceHostContext, "sessionRegistry" | "requireState">,
  bundle: SessionBundle,
): Promise<DesktopGitSnapshot> {
  const state = ctx.requireState();
  const registry = ctx.sessionRegistry();
  if (registry.getActive() === bundle) {
    return state.git;
  }
  if (bundle.scopedGit) {
    return bundle.scopedGit;
  }
  const workspaceRoot = resolveEffectivePaneWorkspaceRoot(bundle, state);
  return applyGitRevision(await readWorkspaceGitSnapshot(workspaceRoot), 0, { reset: true });
}

export async function setPanePendingGitBranchCommand(
  ctx: PaneWorkspaceHostContext,
  request: SetPanePendingGitBranchRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });

    const sessionPath = path.resolve(request.sessionPath.trim());
    if (!sessionPath) {
      throw new Error("Split pane session path is required.");
    }

    const normalized = request.branch.trim();
    if (!normalized) {
      throw new Error(i18n.t("error.branchNameRequired"));
    }

    const registry = ctx.sessionRegistry();
    const bundle = registry.findBySessionPath(sessionPath);
    if (!bundle) {
      throw new Error("Session not found.");
    }

    const git = await resolvePaneGitSnapshotForMutation(ctx, bundle);
    if (!git.isRepository) {
      throw new Error(i18n.t("error.notGitRepo"));
    }
    if (!git.branches.includes(normalized)) {
      throw new Error(i18n.t("error.branchNotFound", { branch: normalized }));
    }

    const isForeground = registry.getActive() === bundle;
    bundle.pendingGitBranch = normalized;
    if (bundle.scopedGit) {
      bundle.scopedGit = { ...bundle.scopedGit, selectedBranch: normalized };
    }

    ctx.invalidatePaneSessionSliceCache(sessionPath);
    if (!isForeground) {
      await ensureVisiblePaneScopedGitSnapshots(ctx);
      ctx.invalidateAllPaneSessionSliceCache();
    }

    return ctx.buildSnapshot();
  });
}

export async function setPaneWorkLocationCommand(
  ctx: PaneWorkspaceHostContext,
  request: SetPaneWorkLocationRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });

    const sessionPath = path.resolve(request.sessionPath.trim());
    if (!sessionPath) {
      throw new Error("Split pane session path is required.");
    }

    const registry = ctx.sessionRegistry();
    const bundle = registry.findBySessionPath(sessionPath);
    if (!bundle) {
      throw new Error("Session not found.");
    }

    const isForeground = registry.getActive() === bundle;
    const workLocation = normalizeWorkLocationKind(request.workLocation);
    bundle.workLocation = workLocation;
    if (bundle.scopedGit) {
      bundle.scopedGit = { ...bundle.scopedGit, workLocation };
    }

    ctx.invalidatePaneSessionSliceCache(sessionPath);
    if (!isForeground) {
      await ensureVisiblePaneScopedGitSnapshots(ctx);
      ctx.invalidateAllPaneSessionSliceCache();
    }

    return ctx.buildSnapshot();
  });
}

export async function checkoutPaneGitBranchCommand(
  ctx: PaneWorkspaceHostContext,
  request: CheckoutPaneGitBranchRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });

    const sessionPath = path.resolve(request.sessionPath.trim());
    if (!sessionPath) {
      throw new Error("Split pane session path is required.");
    }

    const normalized = request.branch.trim();
    if (!normalized) {
      throw new Error(i18n.t("error.branchNameRequired"));
    }

    const state = ctx.requireState();
    const registry = ctx.sessionRegistry();
    const bundle = registry.findBySessionPath(sessionPath);
    if (!bundle) {
      throw new Error("Session not found.");
    }
    if (bundle.runtime?.isBusy()) {
      throw new Error(i18n.t("error.runtimeBusy"));
    }

    const git = await resolvePaneGitSnapshotForMutation(ctx, bundle);
    if (!git.isRepository) {
      throw new Error(i18n.t("error.notGitRepo"));
    }
    if (!git.branches.includes(normalized)) {
      throw new Error(i18n.t("error.branchNotFound", { branch: normalized }));
    }

    const workspaceRoot = resolveEffectivePaneWorkspaceRoot(bundle, state);
    const checkedOut = await checkoutWorkspaceGitBranch(workspaceRoot, normalized, {
      discardLocalChanges: request.discardLocalChanges === true,
    });
    bundle.pendingGitBranch = undefined;

    const isForeground = registry.getActive() === bundle;
    if (isForeground) {
      bundle.scopedGit = undefined;
      state.git = applyGitRevision(checkedOut, state.git.revision ?? 0);
      await ctx.refreshRuntimeForBundle(bundle);
      ctx.syncActiveRuntimePointer();
    } else {
      bundle.scopedGit = applyGitRevision(checkedOut, bundle.scopedGit?.revision ?? 0, {
        reset: true,
      });
      await ctx.refreshRuntimeForBundle(bundle);
    }

    ctx.invalidatePaneSessionSliceCache(sessionPath);
    if (!isForeground) {
      await ensureVisiblePaneScopedGitSnapshots(ctx);
      ctx.invalidateAllPaneSessionSliceCache();
    }

    return ctx.buildSnapshot();
  });
}
