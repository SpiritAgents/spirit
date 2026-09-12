import path from "node:path";

import type { ActiveSessionSnapshot, ConversationMessageSnapshot } from "../types.js";
import type { DesktopTimelineTurnSnapshot, DesktopMessageTimeline } from "./message-timeline.js";
import {
  createEmptySessionBundle,
  resetSessionBundleInPlace,
  sessionBundleFromRestored,
  type SessionBundle,
} from "./session-bundle.js";
import { rehydrateFinishTaskNoticesForRestoredSession } from "./finish-task-notice-rehydrate.js";
import type { RestoredSessionState } from "./sessions.js";
import { normalizeSessionPathKey } from "./session-path.js";
import {
  defaultNewSessionPath,
  provisionalNewSessionPath,
  sideChatPaneSessionPath,
  splitPaneSessionPath,
} from "./storage.js";

const MAX_LOADED_BUNDLES = 8;

export function buildProvisionalActiveSession(filePath: string): ActiveSessionSnapshot {
  return {
    filePath: path.resolve(filePath),
    displayName: "New conversation",
    kind: "stored",
  };
}

export function assignProvisionalActiveSession(bundle: SessionBundle, filePath?: string): string {
  const resolved = path.resolve(
    filePath ?? bundle.activeSession?.filePath ?? defaultNewSessionPath(),
  );
  bundle.activeSession = buildProvisionalActiveSession(resolved);
  return resolved;
}

export class SessionRegistry {
  private readonly bundles = new Map<string, SessionBundle>();
  private activeId: string | undefined;
  /** Split-view pane paths that must stay loaded even when over MAX_LOADED_BUNDLES. */
  private protectedSessionPaths = new Set<string>();

  constructor(private readonly onEvict?: (bundle: SessionBundle) => void) {}

  hasActive(): boolean {
    return this.activeId !== undefined && this.bundles.has(this.activeId);
  }

  getActive(): SessionBundle | undefined {
    if (!this.activeId) {
      return undefined;
    }
    return this.bundles.get(this.activeId);
  }

  requireActive(): SessionBundle {
    const bundle = this.getActive();
    if (!bundle) {
      throw new Error("No active session.");
    }
    return bundle;
  }

  get(id: string): SessionBundle | undefined {
    return this.bundles.get(id);
  }

  /** Resolve a bundle by map key, `bundle.id`, or `activeSession.filePath` (handles draft map keys). */
  findBySessionPath(filePath: string): SessionBundle | undefined {
    const resolved = path.resolve(filePath);
    const direct = this.bundles.get(resolved);
    if (direct) {
      return direct;
    }
    const normalized = normalizeSessionPathKey(filePath);
    for (const bundle of this.bundles.values()) {
      if (normalizeSessionPathKey(bundle.id) === normalized) {
        return bundle;
      }
      if (
        bundle.activeSession &&
        normalizeSessionPathKey(bundle.activeSession.filePath) === normalized
      ) {
        return bundle;
      }
    }
    return undefined;
  }

  /** Keep map key in sync when a session file path is assigned after first persist. */
  rekeyBundle(bundle: SessionBundle, newId: string): void {
    const resolvedNew = path.resolve(newId);
    const currentKey = this.mapKeyFor(bundle);
    if (currentKey !== undefined && currentKey !== resolvedNew) {
      this.bundles.delete(currentKey);
    }
    bundle.id = resolvedNew;
    this.bundles.set(resolvedNew, bundle);
    if (this.getActive() === bundle || this.activeId === currentKey) {
      this.activeId = resolvedNew;
    }
  }

  private mapKeyFor(bundle: SessionBundle): string | undefined {
    for (const [key, candidate] of this.bundles) {
      if (candidate === bundle) {
        return key;
      }
    }
    return undefined;
  }

  activeSessionId(): string | undefined {
    return this.activeId;
  }

  setProtectedSessionPaths(paths: Iterable<string>): void {
    this.protectedSessionPaths = new Set([...paths].map((entry) => normalizeSessionPathKey(entry)));
  }

  private isProtectedBundle(bundle: SessionBundle, mapKey?: string): boolean {
    const candidates = [mapKey, bundle.id, bundle.activeSession?.filePath].filter(
      (entry): entry is string => Boolean(entry?.trim()),
    );
    return candidates.some((entry) =>
      this.protectedSessionPaths.has(normalizeSessionPathKey(entry)),
    );
  }

  all(): Iterable<SessionBundle> {
    return this.bundles.values();
  }

  allBusy(isBusy: (bundle: SessionBundle) => boolean): SessionBundle[] {
    return [...this.bundles.values()].filter((bundle) => isBusy(bundle));
  }

  ensureDraft(workspaceRoot: string, provisionalFilePath?: string): SessionBundle {
    const existing = this.getActive();
    if (existing) {
      existing.workspaceRoot = workspaceRoot;
      const resolved = assignProvisionalActiveSession(existing, provisionalFilePath);
      this.rekeyBundle(existing, resolved);
      return existing;
    }
    return this.activateProvisional(
      workspaceRoot,
      provisionalFilePath ?? provisionalNewSessionPath(workspaceRoot),
    );
  }

  activateProvisional(workspaceRoot: string, filePath: string): SessionBundle {
    const resolved = path.resolve(filePath);
    const existing = this.findBySessionPath(resolved);
    if (existing) {
      existing.workspaceRoot = workspaceRoot;
      if (!existing.activeSession) {
        assignProvisionalActiveSession(existing, resolved);
      }
      this.rekeyBundle(existing, path.resolve(existing.activeSession!.filePath));
      this.activeId = path.resolve(existing.activeSession!.filePath);
      return existing;
    }

    this.evictIfNeeded();
    const bundle = createEmptySessionBundle(workspaceRoot, resolved);
    bundle.activeSession = buildProvisionalActiveSession(resolved);
    this.bundles.set(resolved, bundle);
    this.activeId = resolved;
    return bundle;
  }

  setActive(id: string): SessionBundle {
    const bundle = this.findBySessionPath(id) ?? this.bundles.get(id);
    if (!bundle) {
      throw new Error("Session does not exist or has been unloaded.");
    }
    return this.activateExisting(bundle);
  }

  /** Switch foreground to an already-loaded bundle without reloading from disk. */
  activateExisting(bundle: SessionBundle): SessionBundle {
    const resolved = path.resolve(bundle.activeSession?.filePath ?? bundle.id);
    this.rekeyBundle(bundle, resolved);
    this.activeId = resolved;
    return bundle;
  }

  upsertFromRestored(
    workspaceRoot: string,
    restored: RestoredSessionState,
    createTimeline: (
      messages: ConversationMessageSnapshot[],
      timelineSnapshot?: DesktopTimelineTurnSnapshot[],
    ) => DesktopMessageTimeline,
  ): SessionBundle {
    const id = restored.activeSession.filePath;
    const existing = this.findBySessionPath(id);
    if (existing) {
      this.rekeyBundle(existing, id);
      // Never clobber in-memory timeline while a runtime is still attached (incl. busy background runs).
      if (!existing.runtime) {
        this.applyRestoredToBundle(existing, workspaceRoot, restored, createTimeline);
      } else {
        existing.workspaceRoot = workspaceRoot;
        existing.activeSession = restored.activeSession;
      }
      this.activeId = path.resolve(id);
      return existing;
    }
    this.evictIfNeeded();
    const bundle = sessionBundleFromRestored(workspaceRoot, restored, createTimeline);
    this.bundles.set(id, bundle);
    this.activeId = id;
    return bundle;
  }

  resetActive(workspaceRoot: string): SessionBundle {
    const bundle = this.ensureDraft(workspaceRoot);
    resetSessionBundleInPlace(bundle);
    bundle.workspaceRoot = workspaceRoot;
    return bundle;
  }

  /** New empty foreground session; prior bundles (including busy runs) stay loaded. */
  beginNewActive(workspaceRoot: string): SessionBundle {
    const provisionalPath = provisionalNewSessionPath(workspaceRoot);
    const bundle = this.activateProvisional(workspaceRoot, provisionalPath);
    resetSessionBundleInPlace(bundle);
    bundle.workspaceRoot = workspaceRoot;
    assignProvisionalActiveSession(bundle, provisionalPath);
    this.rekeyBundle(bundle, path.resolve(provisionalPath));
    this.activeId = path.resolve(provisionalPath);
    return bundle;
  }

  /** New empty session without changing the foreground active bundle (remote web new chat). */
  beginNewBackground(workspaceRoot: string): SessionBundle {
    const provisionalPath = provisionalNewSessionPath(workspaceRoot);
    const bundle = this.activateProvisionalBackground(workspaceRoot, provisionalPath);
    resetSessionBundleInPlace(bundle);
    bundle.workspaceRoot = workspaceRoot;
    assignProvisionalActiveSession(bundle, provisionalPath);
    this.rekeyBundle(bundle, path.resolve(provisionalPath));
    return bundle;
  }

  /** Load or create a split-pane empty session without changing the foreground active bundle. */
  beginSplitPaneSession(workspaceRoot: string, paneId: string): SessionBundle {
    const splitPath = splitPaneSessionPath(paneId);
    const bundle = this.activateProvisionalBackground(workspaceRoot, splitPath);
    resetSessionBundleInPlace(bundle);
    bundle.workspaceRoot = workspaceRoot;
    assignProvisionalActiveSession(bundle, splitPath);
    this.rekeyBundle(bundle, path.resolve(splitPath));
    return bundle;
  }

  /** Load or create a side-chat pane session without changing the foreground active bundle. */
  beginSideChatPaneSession(workspaceRoot: string, paneId: string): SessionBundle {
    const sideChatPath = sideChatPaneSessionPath(paneId);
    const bundle = this.activateProvisionalBackground(workspaceRoot, sideChatPath);
    resetSessionBundleInPlace(bundle);
    bundle.workspaceRoot = workspaceRoot;
    assignProvisionalActiveSession(bundle, sideChatPath);
    this.rekeyBundle(bundle, path.resolve(sideChatPath));
    return bundle;
  }

  private activateProvisionalBackground(workspaceRoot: string, filePath: string): SessionBundle {
    const resolved = path.resolve(filePath);
    const existing = this.findBySessionPath(resolved);
    if (existing) {
      existing.workspaceRoot = workspaceRoot;
      if (!existing.activeSession) {
        assignProvisionalActiveSession(existing, resolved);
      }
      this.rekeyBundle(existing, path.resolve(existing.activeSession!.filePath));
      return existing;
    }

    this.evictIfNeeded();
    const bundle = createEmptySessionBundle(workspaceRoot, resolved);
    bundle.activeSession = buildProvisionalActiveSession(resolved);
    this.bundles.set(resolved, bundle);
    return bundle;
  }

  removeBySessionPath(filePath: string): SessionBundle | undefined {
    const bundle = this.findBySessionPath(filePath);
    if (!bundle) {
      return undefined;
    }
    const mapKey = this.mapKeyFor(bundle);
    const normalizedPath = normalizeSessionPathKey(filePath);
    if (mapKey) {
      this.bundles.delete(mapKey);
    }
    if (
      this.activeId !== undefined &&
      (this.activeId === mapKey || normalizeSessionPathKey(this.activeId) === normalizedPath)
    ) {
      this.activeId = undefined;
    }
    return bundle;
  }

  isBundleBusy(bundle: SessionBundle): boolean {
    return bundle.runtime?.isBusy() === true;
  }

  reloadWarmBundleFromRestoredIfIdle(
    filePath: string,
    workspaceRoot: string,
    restored: RestoredSessionState,
    createTimeline: (
      messages: ConversationMessageSnapshot[],
      timelineSnapshot?: DesktopTimelineTurnSnapshot[],
    ) => DesktopMessageTimeline,
  ): boolean {
    const existing = this.findBySessionPath(filePath);
    if (!existing || existing.runtime?.isBusy()) {
      return false;
    }
    this.applyRestoredToBundle(existing, workspaceRoot, restored, createTimeline);
    return true;
  }

  clear(): void {
    for (const bundle of this.bundles.values()) {
      this.onEvict?.(bundle);
    }
    this.bundles.clear();
    this.activeId = undefined;
  }

  clearForWorkspaceSwitch(workspaceRoot: string): SessionBundle {
    this.clear();
    return this.ensureDraft(workspaceRoot);
  }

  private applyRestoredToBundle(
    bundle: SessionBundle,
    workspaceRoot: string,
    restored: RestoredSessionState,
    createTimeline: (
      messages: ConversationMessageSnapshot[],
      timelineSnapshot?: DesktopTimelineTurnSnapshot[],
    ) => DesktopMessageTimeline,
  ): void {
    this.rekeyBundle(bundle, restored.activeSession.filePath);
    bundle.workspaceRoot = workspaceRoot;
    bundle.activeSession = restored.activeSession;
    bundle.messages = restored.messages;
    bundle.messageTimeline = createTimeline(restored.messages, restored.desktopMessageTimeline);
    bundle.messages = rehydrateFinishTaskNoticesForRestoredSession({
      messages: bundle.messages,
      messageTimeline: bundle.messageTimeline,
      archiveHistory: restored.archiveHistory,
    });
    bundle.archiveHistory = restored.archiveHistory;
    bundle.archiveSubagentSessions = restored.archiveSubagentSessions;
    bundle.loopEnabled = restored.loopEnabled;
    bundle.approvalLevel = restored.approvalLevel;
    bundle.activeModel = restored.activeModel;
    bundle.sessionTitleSource = restored.sessionTitleSource;
    bundle.rewind = restored.rewind;
    bundle.rewindWarnings = [];
    bundle.messageIdCounter =
      restored.messages.length > 0
        ? Math.max(0, ...restored.messages.map((message) => message.id)) + 1
        : 1;
    bundle.currentTurnSkills = [];
    bundle.pendingUnboundFileChangeIds = [];
    bundle.nextTimelineAssistantSegmentKind = "initial";
    bundle.deferredRuntimeRefreshWhileBusy = false;
  }

  private evictIfNeeded(): void {
    while (this.bundles.size >= MAX_LOADED_BUNDLES) {
      let evicted = false;
      for (const [id, bundle] of this.bundles) {
        if (id === this.activeId) {
          continue;
        }
        if (bundle.runtime?.isBusy()) {
          continue;
        }
        if (this.isProtectedBundle(bundle, id)) {
          continue;
        }
        this.bundles.delete(id);
        this.onEvict?.(bundle);
        evicted = true;
        break;
      }
      if (!evicted) {
        return;
      }
    }
  }
}
