import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useDarwinConversationSplitChrome } from "@/hooks/useDarwinConversationSplitChrome";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";

import {
  closePane,
  collectPaneSessionPaths,
  collectSplitLayoutLeaves,
  countPanes,
  createLeafNode,
  createPaneId,
  createSinglePaneLayout,
  findDuplicateSessionPathLeaves,
  findLeafByPaneId,
  findLeafBySessionPath,
  findWorkspaceToolsAnchorPaneId,
  findSessionSidebarAnchorPaneId,
  repositionPane,
  swapAdjacentPanes,
  splitPaneAt,
  splitPaneAtZone,
  updateLeafSessionPath,
  updateSplitRatio,
  updateSplitRatios,
  type PaneDropZone,
  type PaneRepositionZone,
  type SplitDirection,
  type SplitLayoutNode,
} from "@/lib/conversation-split-layout";

import { clearConversationSplitLayoutJson } from "@/lib/layout-prefs";

import { lookupPaneSessionSlice, resolvePaneDesktopSnapshot } from "@/lib/pane-desktop-snapshot";
import { canBeginSideChat } from "@/lib/fork-eligibility";
import { findLastForkableAssistantMessageId } from "@/lib/fork-session-utils";

import { remapComposerDraftQuoteSessionPaths } from "@/lib/composer-draft-store";
import { recordSessionPathAlias } from "@/lib/session-path-alias";
import {
  clearSessionSplitBindings,
  persistSessionSplitBinding,
  readSessionSplitBinding,
  remapSessionSplitBindingPath,
  sanitizeSessionSplitBindings,
} from "@/lib/session-split-binding";

import {
  isForegroundProvisionalSessionPath,
  isSideChatPaneProvisionalSessionPath,
  isSplitPaneProvisionalSessionPath,
  isStableChatSessionPath,
  normalizeSessionPathKey,
} from "@/lib/session-path-kind";

import type { FocusedPaneComposerControls } from "@/lib/focused-pane-composer-controls";
import type { FocusedPaneComposerInsertHandlers } from "@/lib/focused-pane-composer-insert";
import type { MessageQuoteAttachment } from "@/lib/message-quote-attachment";
import type { ConversationAbortShortcutTargetRef } from "@/lib/conversation-abort-shortcut";
import {
  registerSplitPaneShortcut,
  unregisterSplitPaneShortcut,
} from "@/lib/split-pane-shortcut-bridge";
import type { DesktopSnapshot } from "@/types";

import { sameWorkspacePath } from "@/lib/workspace-display-label";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type SidebarSessionDragPayload =
  | { kind: "stored"; sessionPath: string }
  | { kind: "new" }
  | { kind: "new-in-workspace"; workspaceRoot: string };

/** Optional payload carried when creating a Side Chat; messageQuote is inserted into the new pane's Composer once it registers its composer capability. */
export type BeginSideChatOptions = {
  messageQuote?: MessageQuoteAttachment;
};

export type ConversationQuoteScrollHandler = (request: {
  messageId: number;
  behavior: ScrollBehavior;
  nonce: number;
}) => void;

type ConversationSplitContextValue = {
  layout: SplitLayoutNode | null;

  focusedPaneId: string | null;

  anchorPaneId: string | null;

  sessionSidebarAnchorPaneId: string | null;

  paneCount: number;

  focusPane: (paneId: string, sessionPath: string) => void;

  splitPane: (paneId: string, direction?: SplitDirection) => Promise<void>;

  beginSideChat: (paneId: string, options?: BeginSideChatOptions) => Promise<void>;

  /** Insert a message quote into a Side Chat: prefer reusing the last navigated Side Chat pane that has been left; otherwise create a new one. */
  addMessageQuoteToSideChat: (paneId: string, attachment: MessageQuoteAttachment) => Promise<void>;

  isSideChatPane: (paneId: string) => boolean;

  closePaneById: (paneId: string, sessionPath: string) => Promise<void>;

  collapsePaneLayoutById: (paneId: string) => Promise<void>;

  updateRatio: (splitId: string, ratio: number, options?: { persist?: boolean }) => void;

  updateRatios: (
    updates: readonly { splitId: string; ratio: number }[],
    options?: { persist?: boolean },
  ) => void;

  /** Write the current layout into the session split binding (call on drag end to avoid persisting on pointermove). */
  persistLayoutBinding: () => void;

  beginSplitLayoutResize: () => void;

  endSplitLayoutResize: () => void;

  highlightedSplitIds: ReadonlySet<string>;

  setSplitResizeHighlight: (splitIds: Iterable<string> | null) => void;

  repositionPaneById: (
    sourcePaneId: string,

    targetPaneId: string,

    zone: PaneRepositionZone,
  ) => void;

  startPaneDrag: (paneId: string) => void;

  clearPaneDrag: () => void;

  completePaneDrop: (targetPaneId: string, zone: PaneDropZone) => void;

  paneDragActive: boolean;

  paneDragSourcePaneId: string | null;

  paneDropTarget: { paneId: string; zone: PaneDropZone } | null;

  setPaneDropTarget: (target: { paneId: string; zone: PaneDropZone } | null) => void;

  sidebarSessionDragActive: boolean;

  sidebarSessionDragPayload: SidebarSessionDragPayload | null;

  startSidebarSessionDrag: (payload: SidebarSessionDragPayload) => void;

  clearSidebarSessionDrag: () => void;

  completeSidebarSessionDrop: (targetPaneId: string, zone: PaneRepositionZone) => Promise<void>;

  openStoredSessionInSplitPane: (
    anchorPaneId: string,
    sessionPath: string,
    placement?: SplitDirection | PaneRepositionZone,
    options?: { asSideChat?: boolean },
  ) => Promise<string | null>;

  registerQuoteScrollHandler: (
    paneId: string,
    sessionPath: string,
    handler: ConversationQuoteScrollHandler | null,
  ) => void;

  requestQuoteScroll: (input: {
    sessionPath: string;
    messageId: number;
    behavior: ScrollBehavior;
  }) => void;

  layoutNavigationPending: boolean;

  registerPaneComposerInsert: (
    paneId: string,
    handlers: FocusedPaneComposerInsertHandlers | null,
  ) => void;

  registerPaneComposerControls: (
    paneId: string,
    controls: FocusedPaneComposerControls | null,
  ) => void;

  getFocusedPaneComposerInsert: () => FocusedPaneComposerInsertHandlers | null;

  getFocusedPaneComposerControls: () => FocusedPaneComposerControls | null;

  conversationAbortShortcutTargetRef: ConversationAbortShortcutTargetRef | null;
};

const ConversationSplitContext = createContext<ConversationSplitContextValue | null>(null);

function layoutIncludesSessionPath(layout: SplitLayoutNode, sessionPath: string): boolean {
  const target = normalizeSessionPathKey(sessionPath);

  return collectPaneSessionPaths(layout).some((path) => normalizeSessionPathKey(path) === target);
}

function splitLayoutHasPromotedSuccessor(
  layout: SplitLayoutNode,

  activeSessionPath: string,

  snapshot: DesktopSnapshot | null,
): boolean {
  if (!snapshot?.paneSessions || !lookupPaneSessionSlice(snapshot, activeSessionPath)) {
    return false;
  }

  const activeSlice = lookupPaneSessionSlice(snapshot, activeSessionPath)!;

  if (activeSlice.conversation.messages.length === 0) {
    return false;
  }

  const layoutPathKeys = new Set(collectPaneSessionPaths(layout).map(normalizeSessionPathKey));

  if (layoutPathKeys.has(normalizeSessionPathKey(activeSessionPath))) {
    return false;
  }

  return collectSplitLayoutLeaves(layout).some((leaf) => {
    if (!isSplitPaneProvisionalSessionPath(leaf.sessionPath)) {
      return false;
    }

    return !lookupPaneSessionSlice(snapshot, leaf.sessionPath);
  });
}

function normalizeBindingLayoutForSnapshot(
  binding: SplitLayoutNode,

  snapshot: DesktopSnapshot | null,
): SplitLayoutNode {
  if (!snapshot?.paneSessions || countPanes(binding) <= 1) {
    return binding;
  }

  const layoutPathKeys = new Set(collectPaneSessionPaths(binding).map(normalizeSessionPathKey));

  let next = binding;

  for (const leaf of collectSplitLayoutLeaves(binding)) {
    if (lookupPaneSessionSlice(snapshot, leaf.sessionPath)) {
      continue;
    }

    if (!isSplitPaneProvisionalSessionPath(leaf.sessionPath)) {
      continue;
    }

    const unmappedPaths = Object.keys(snapshot.paneSessions).filter(
      (sessionPath) => !layoutPathKeys.has(normalizeSessionPathKey(sessionPath)),
    );

    const withMessages = unmappedPaths.filter(
      (sessionPath) => snapshot.paneSessions![sessionPath].conversation.messages.length > 0,
    );

    const candidate =
      withMessages.find((sessionPath) => isStableChatSessionPath(sessionPath)) ?? withMessages[0];

    if (!candidate) {
      continue;
    }

    next = updateLeafSessionPath(next, leaf.paneId, candidate);

    layoutPathKeys.delete(normalizeSessionPathKey(leaf.sessionPath));

    layoutPathKeys.add(normalizeSessionPathKey(candidate));
  }

  return next;
}

function resolveLayoutForActiveSession(
  activeSessionPath: string,

  current: SplitLayoutNode | null,

  rootPaneId: string,

  snapshot: DesktopSnapshot | null,
): SplitLayoutNode {
  if (current && countPanes(current) > 1) {
    // Must first check whether the path is already in the current layout; otherwise clicking the empty-session anchor pane would wrongly collapse it to a single pane due to the foreground provisional path
    if (layoutIncludesSessionPath(current, activeSessionPath)) {
      return current;
    }

    if (isForegroundProvisionalSessionPath(activeSessionPath)) {
      return createSinglePaneLayout(rootPaneId, activeSessionPath);
    }

    if (splitLayoutHasPromotedSuccessor(current, activeSessionPath, snapshot)) {
      return normalizeBindingLayoutForSnapshot(current, snapshot);
    }
  }

  const binding = readSessionSplitBinding(activeSessionPath);

  if (binding && countPanes(binding) > 1) {
    const normalized = normalizeBindingLayoutForSnapshot(binding, snapshot);

    if (
      collectPaneSessionPaths(normalized).join("\0") !== collectPaneSessionPaths(binding).join("\0")
    ) {
      persistSessionSplitBinding(normalized);
    }

    return normalized;
  }

  if (!current) {
    return createSinglePaneLayout(rootPaneId, activeSessionPath);
  }

  if (countPanes(current) === 1) {
    const anchorPaneId = findWorkspaceToolsAnchorPaneId(current);

    return updateLeafSessionPath(current, anchorPaneId, activeSessionPath);
  }

  return createSinglePaneLayout(rootPaneId, activeSessionPath);
}

function computeLayoutDecision(
  current: SplitLayoutNode | null,

  activeSessionPath: string,

  snapshot: DesktopSnapshot | null,
): string {
  if (!current) {
    return readSessionSplitBinding(activeSessionPath) ? "restore-binding" : "init-single";
  }

  if (countPanes(current) > 1 && layoutIncludesSessionPath(current, activeSessionPath)) {
    return "keep-split-in-group";
  }

  if (
    countPanes(current) > 1 &&
    splitLayoutHasPromotedSuccessor(current, activeSessionPath, snapshot)
  ) {
    return "keep-split-in-group";
  }

  if (countPanes(current) > 1) {
    if (readSessionSplitBinding(activeSessionPath)) {
      return "restore-binding";
    }

    return "collapse-external-nav";
  }

  if (readSessionSplitBinding(activeSessionPath)) {
    return "restore-binding";
  }

  if (countPanes(current) === 1) {
    return "sync-single-pane";
  }

  return "collapse-single";
}

export function ConversationSplitProvider({
  runtime,

  snapshot,

  conversationAbortShortcutTargetRef = null,

  onEnsureConversationSurface,

  registerBeginSideChat,

  children,
}: {
  runtime: DesktopRuntime;

  snapshot: DesktopSnapshot | null;

  conversationAbortShortcutTargetRef?: ConversationAbortShortcutTargetRef | null;

  onEnsureConversationSurface?: () => void;

  registerBeginSideChat?: (handler: (() => void) | null) => void;

  children: ReactNode;
}) {
  const rootPaneIdRef = useRef(createPaneId());

  const activeSessionPath = snapshot?.activeSession?.filePath ?? "";

  const [layout, setLayout] = useState<SplitLayoutNode | null>(null);

  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);

  const [paneDragActive, setPaneDragActive] = useState(false);
  const [paneDragSourcePaneId, setPaneDragSourcePaneId] = useState<string | null>(null);
  const [paneDropTarget, setPaneDropTargetState] = useState<{
    paneId: string;
    zone: PaneDropZone;
  } | null>(null);

  const [sidebarSessionDragPayload, setSidebarSessionDragPayload] =
    useState<SidebarSessionDragPayload | null>(null);

  const sidebarSessionDragActive = sidebarSessionDragPayload !== null;

  // Each pane unconditionally registers its own composer capability; readers pick by focusedPaneId.
  // No shared single slot, so sibling panes' effect execution order cannot overwrite each other
  // (existing bug where the left pane got cleared to null)
  const paneComposerInsertRegistryRef = useRef(
    new Map<string, FocusedPaneComposerInsertHandlers>(),
  );

  const paneComposerControlsRegistryRef = useRef(new Map<string, FocusedPaneComposerControls>());

  // The messageQuote carried by beginSideChat is stashed here until the new pane registers its composer capability,
  // then flushed into that pane's Composer on registration (the new pane's mount effect is the earliest known ready point)
  const pendingPaneMessageQuotesRef = useRef(new Map<string, MessageQuoteAttachment>());

  // Side Chat pane tracking: register the paneId on creation (still recognizable after the first message promotes it to a stable path);
  // when focus enters a side chat pane, record it as the most recent navigation target
  const sideChatPaneIdsRef = useRef(new Set<string>());

  const lastNavigatedSideChatPaneIdRef = useRef<string | null>(null);

  const quoteScrollHandlersRef = useRef(
    new Map<string, { sessionPath: string; handler: ConversationQuoteScrollHandler }>(),
  );
  const pendingQuoteScrollRef = useRef<{
    sessionPath: string;
    messageId: number;
    behavior: ScrollBehavior;
    nonce: number;
  } | null>(null);
  const quoteScrollNonceRef = useRef(0);

  const registerPaneComposerInsert = useCallback(
    (paneId: string, handlers: FocusedPaneComposerInsertHandlers | null) => {
      if (handlers) {
        paneComposerInsertRegistryRef.current.set(paneId, handlers);
        const pendingQuote = pendingPaneMessageQuotesRef.current.get(paneId);
        if (pendingQuote) {
          pendingPaneMessageQuotesRef.current.delete(paneId);
          handlers.handleMessageQuoteAddToChat(pendingQuote);
        }
      } else {
        paneComposerInsertRegistryRef.current.delete(paneId);
        pendingPaneMessageQuotesRef.current.delete(paneId);
      }
    },
    [],
  );

  const registerPaneComposerControls = useCallback(
    (paneId: string, controls: FocusedPaneComposerControls | null) => {
      if (controls) {
        paneComposerControlsRegistryRef.current.set(paneId, controls);
      } else {
        paneComposerControlsRegistryRef.current.delete(paneId);
      }
    },
    [],
  );

  const setPaneDropTarget = useCallback((target: { paneId: string; zone: PaneDropZone } | null) => {
    setPaneDropTargetState((current) => {
      if (current?.paneId === target?.paneId && current?.zone === target?.zone) {
        return current;
      }
      return target;
    });
  }, []);

  // Clear the target synchronously when the pointer is not over a valid drop zone (dragLeave may misfire when quickly sweeping across the source panel)
  useEffect(() => {
    if (!paneDragActive && !sidebarSessionDragActive) {
      return;
    }
    const sourcePaneId = paneDragSourcePaneId;
    const handleDocumentDragOver = (event: DragEvent) => {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (!(hit instanceof Element)) {
        setPaneDropTarget(null);
        return;
      }
      const zoneEl = hit.closest("[data-pane-drop-zone]");
      if (zoneEl instanceof HTMLElement) {
        const hostEl = zoneEl.closest("[data-pane-drop-host]");
        const hostPaneId = hostEl?.getAttribute("data-pane-drop-host");
        if (hostPaneId && (sidebarSessionDragActive || hostPaneId !== sourcePaneId)) {
          return;
        }
      }
      setPaneDropTarget(null);
    };
    document.addEventListener("dragover", handleDocumentDragOver);
    return () => document.removeEventListener("dragover", handleDocumentDragOver);
  }, [paneDragActive, paneDragSourcePaneId, setPaneDropTarget, sidebarSessionDragActive]);

  const [layoutNavigationPending, setLayoutNavigationPending] = useState(false);

  const visiblePathsSyncedRef = useRef<string>("");

  const layoutRef = useRef<SplitLayoutNode | null>(null);

  layoutRef.current = layout;

  const focusedPaneIdRef = useRef<string | null>(null);

  focusedPaneIdRef.current = focusedPaneId;

  const getFocusedPaneComposerInsert = useCallback((): FocusedPaneComposerInsertHandlers | null => {
    const focused = focusedPaneIdRef.current;
    return focused ? (paneComposerInsertRegistryRef.current.get(focused) ?? null) : null;
  }, []);

  const getFocusedPaneComposerControls = useCallback((): FocusedPaneComposerControls | null => {
    const focused = focusedPaneIdRef.current;
    return focused ? (paneComposerControlsRegistryRef.current.get(focused) ?? null) : null;
  }, []);

  const layoutResolveGenerationRef = useRef(0);

  const layoutNavigationLockRef = useRef(false);

  const runtimeRef = useRef(runtime);

  runtimeRef.current = runtime;

  const dragSourcePaneIdRef = useRef<string | null>(null);

  const duplicatePathsReconcilingRef = useRef(false);

  const legacyLayoutClearedRef = useRef(false);

  const splitRatioResizeActiveRef = useRef(false);

  useEffect(() => {
    if (legacyLayoutClearedRef.current) {
      return;
    }

    legacyLayoutClearedRef.current = true;

    clearConversationSplitLayoutJson();

    sanitizeSessionSplitBindings();
  }, []);

  const syncVisiblePaths = useCallback(
    async (nextLayout: SplitLayoutNode | null) => {
      if (!nextLayout || !runtime.apiReady) {
        return;
      }

      const paths = collectPaneSessionPaths(nextLayout);

      visiblePathsSyncedRef.current = paths.join("\0");

      await runtime.setVisiblePaneSessions(paths);
    },

    [runtime],
  );

  useLayoutEffect(() => {
    if (!activeSessionPath) {
      return;
    }

    if (layoutNavigationLockRef.current) {
      return;
    }

    const generation = ++layoutResolveGenerationRef.current;

    const current = layoutRef.current;

    const next = resolveLayoutForActiveSession(
      activeSessionPath,

      current,

      rootPaneIdRef.current,

      snapshot,
    );

    const decision = computeLayoutDecision(current, activeSessionPath, snapshot);

    const nextPaths = collectPaneSessionPaths(next);

    const nextPaneCount = countPanes(next);

    const currentPaneCount = current ? countPanes(current) : 0;

    if (decision !== "restore-binding") {
      runtimeRef.current.releaseSessionNavigationBusy();
    }

    if (decision === "keep-split-in-group") {
      if (current !== next) {
        setLayout(next);
      }

      return;
    }

    if (
      (decision === "collapse-external-nav" && nextPaneCount === 1) ||
      (currentPaneCount > 1 && nextPaneCount === 1)
    ) {
      layoutNavigationLockRef.current = true;

      setLayoutNavigationPending(true);

      visiblePathsSyncedRef.current = nextPaths.join("\0");

      setLayout(next);

      void (async () => {
        try {
          await syncVisiblePaths(next);
        } finally {
          if (generation === layoutResolveGenerationRef.current) {
            layoutNavigationLockRef.current = false;

            setLayoutNavigationPending(false);
          }
        }
      })();

      return;
    }

    if (decision === "restore-binding") {
      layoutNavigationLockRef.current = true;

      setLayoutNavigationPending(true);

      const pathsToSync = collectPaneSessionPaths(next);

      visiblePathsSyncedRef.current = pathsToSync.join("\0");

      void (async () => {
        try {
          if (runtimeRef.current.apiReady) {
            await runtimeRef.current.setVisiblePaneSessions(pathsToSync);
          }

          if (generation !== layoutResolveGenerationRef.current) {
            return;
          }

          setLayout(next);
        } finally {
          if (generation === layoutResolveGenerationRef.current) {
            layoutNavigationLockRef.current = false;

            setLayoutNavigationPending(false);

            runtimeRef.current.releaseSessionNavigationBusy();
          }
        }
      })();

      return;
    }

    setLayout(next);
  }, [activeSessionPath]);

  useEffect(() => {
    runtime.setLayoutNavigationPending(layoutNavigationPending);
  }, [layoutNavigationPending, runtime]);

  useEffect(() => {
    if (!layout || !activeSessionPath) {
      return;
    }

    const leaf = collectSplitLayoutLeaves(layout).find(
      (entry) =>
        normalizeSessionPathKey(entry.sessionPath) === normalizeSessionPathKey(activeSessionPath),
    );

    if (leaf) {
      setFocusedPaneId(leaf.paneId);
    }
  }, [activeSessionPath, layout]);

  useEffect(() => {
    if (!layout) {
      return;
    }

    setFocusedPaneId((current) => {
      if (current && findLeafByPaneId(layout, current)) {
        return current;
      }

      const anchorPaneId = findWorkspaceToolsAnchorPaneId(layout);

      return anchorPaneId;
    });
  }, [layout]);

  useEffect(() => {
    if (!layout || !runtime.apiReady || layoutNavigationLockRef.current) {
      return;
    }

    const paths = collectPaneSessionPaths(layout);

    const signature = paths.join("\0");

    if (signature === visiblePathsSyncedRef.current) {
      return;
    }

    visiblePathsSyncedRef.current = signature;

    void runtime.setVisiblePaneSessions(paths);
  }, [layout, runtime, runtime.apiReady]);

  useEffect(() => {
    if (!layout || layoutNavigationLockRef.current || layoutNavigationPending) {
      return;
    }

    if (splitRatioResizeActiveRef.current) {
      return;
    }

    if (countPanes(layout) > 1) {
      persistSessionSplitBinding(layout);

      return;
    }

    const paths = collectPaneSessionPaths(layout);

    clearSessionSplitBindings(paths);
  }, [layout, layoutNavigationPending]);

  useEffect(() => {
    if (!layout || !runtime.apiReady || duplicatePathsReconcilingRef.current) {
      return;
    }

    const duplicates = findDuplicateSessionPathLeaves(layout);

    if (duplicates.length === 0) {
      return;
    }

    duplicatePathsReconcilingRef.current = true;

    void (async () => {
      try {
        let nextLayout = layout;

        for (const leaf of duplicates) {
          const response = await runtime.beginSplitPaneSession(leaf.paneId);

          nextLayout = updateLeafSessionPath(nextLayout, leaf.paneId, response.sessionPath);
        }

        setLayout(nextLayout);

        await syncVisiblePaths(nextLayout);
      } finally {
        duplicatePathsReconcilingRef.current = false;
      }
    })();
  }, [layout, runtime, runtime.apiReady, syncVisiblePaths]);

  useEffect(() => {
    if (!layout || !snapshot?.paneSessions || countPanes(layout) <= 1) {
      return;
    }

    const layoutPathKeys = new Set(collectPaneSessionPaths(layout).map(normalizeSessionPathKey));

    const orphans = collectSplitLayoutLeaves(layout).filter(
      (leaf) => !lookupPaneSessionSlice(snapshot, leaf.sessionPath),
    );

    if (orphans.length === 0) {
      return;
    }

    let unmappedPaths = Object.keys(snapshot.paneSessions).filter(
      (sessionPath) => !layoutPathKeys.has(normalizeSessionPathKey(sessionPath)),
    );

    if (unmappedPaths.length === 0) {
      return;
    }

    let nextLayout = layout;

    const repoints: Array<{ paneId: string; fromPath: string; toPath: string }> = [];

    for (const leaf of orphans) {
      if (isStableChatSessionPath(leaf.sessionPath)) {
        continue;
      }

      const withMessages = unmappedPaths.filter(
        (sessionPath) => snapshot.paneSessions![sessionPath].conversation.messages.length > 0,
      );

      const provisionalCandidates = unmappedPaths.filter((sessionPath) =>
        isSplitPaneProvisionalSessionPath(sessionPath),
      );

      const candidates =
        withMessages.length > 0
          ? withMessages
          : provisionalCandidates.length > 0
            ? provisionalCandidates
            : [];

      if (candidates.length === 0) {
        continue;
      }

      const promotedPath = candidates[0]!;

      nextLayout = updateLeafSessionPath(nextLayout, leaf.paneId, promotedPath);

      unmappedPaths = unmappedPaths.filter((path) => path !== promotedPath);

      repoints.push({
        paneId: leaf.paneId,

        fromPath: leaf.sessionPath,

        toPath: promotedPath,
      });
    }

    if (repoints.length === 0) {
      return;
    }

    for (const repoint of repoints) {
      remapSessionSplitBindingPath(repoint.fromPath, repoint.toPath);
      recordSessionPathAlias(repoint.fromPath, repoint.toPath);
      remapComposerDraftQuoteSessionPaths(repoint.fromPath, repoint.toPath);
    }

    runtime.reapplySessionPathAliases();

    setLayout(nextLayout);

    persistSessionSplitBinding(nextLayout);

    void syncVisiblePaths(nextLayout);
  }, [focusedPaneId, layout, runtime, snapshot, syncVisiblePaths]);

  const focusPane = useCallback(
    (paneId: string, sessionPath: string) => {
      setFocusedPaneId(paneId);

      if (snapshot?.activeSession?.filePath === sessionPath) {
        return;
      }

      const paneCount = layout ? countPanes(layout) : 0;

      if (paneCount > 1 && layout && layoutIncludesSessionPath(layout, sessionPath)) {
        void runtime.focusPaneSession(sessionPath);

        return;
      }

      void runtime.openSession(sessionPath);
    },

    [layout, runtime, snapshot?.activeSession?.filePath],
  );

  // Record the Side Chat pane the user most recently navigated to (including provisional side-chat paths restored from layout)
  useEffect(() => {
    if (!focusedPaneId || !layout) {
      return;
    }
    const leaf = findLeafByPaneId(layout, focusedPaneId);
    if (!leaf) {
      return;
    }
    if (
      sideChatPaneIdsRef.current.has(focusedPaneId) ||
      isSideChatPaneProvisionalSessionPath(leaf.sessionPath)
    ) {
      sideChatPaneIdsRef.current.add(focusedPaneId);
      lastNavigatedSideChatPaneIdRef.current = focusedPaneId;
    }
  }, [focusedPaneId, layout]);

  const splitPane = useCallback(
    async (paneId: string, direction: SplitDirection = "horizontal") => {
      if (!layout || !runtime.apiReady) {
        return;
      }

      const newPaneId = createPaneId();

      const response = await runtime.beginSplitPaneSession(newPaneId, { deferSnapshot: true });

      const newLeaf = createLeafNode(newPaneId, response.sessionPath);

      const nextLayout = splitPaneAt(layout, paneId, direction, newLeaf);

      setLayout(nextLayout);

      setFocusedPaneId(newPaneId);

      persistSessionSplitBinding(nextLayout);

      const paths = collectPaneSessionPaths(nextLayout);

      visiblePathsSyncedRef.current = paths.join("\0");

      await runtime.syncSplitPaneSessions(paths, response.sessionPath);
    },

    [layout, runtime],
  );

  const beginSideChat = useCallback(
    async (paneId: string, options?: BeginSideChatOptions) => {
      if (!layout || !runtime.apiReady) {
        return;
      }

      const sourceLeaf = findLeafByPaneId(layout, paneId);
      if (!sourceLeaf) {
        return;
      }

      const paneSnapshot = resolvePaneDesktopSnapshot(snapshot, sourceLeaf.sessionPath);
      const messages = paneSnapshot?.conversation.messages ?? [];
      const messageId = findLastForkableAssistantMessageId(messages);
      const conversationBusy = paneSnapshot?.conversation.isBusy === true;
      const activeSessionReadOnly = paneSnapshot?.activeSession?.readOnly === true;
      const sideChatBusy = runtime.busyAction === "side-chat";
      const forkBusy = runtime.busyAction === "fork";
      if (
        !messageId ||
        !canBeginSideChat({
          conversationBusy,
          activeSessionReadOnly,
          forkBusy,
          sideChatBusy,
          hasForkableAssistantMessage: true,
        })
      ) {
        return;
      }

      const newPaneId = createPaneId();
      const response = await runtime.beginSideChatPaneSession(newPaneId);
      const forked = await runtime.forkSessionIntoSideChat({
        sourceSessionPath: sourceLeaf.sessionPath,
        targetPaneId: newPaneId,
        messageId,
      });
      if (!forked) {
        await runtime.deleteSession(response.sessionPath);
        return;
      }

      if (options?.messageQuote) {
        pendingPaneMessageQuotesRef.current.set(newPaneId, options.messageQuote);
      }

      sideChatPaneIdsRef.current.add(newPaneId);

      const newLeaf = createLeafNode(newPaneId, response.sessionPath);
      const nextLayout = splitPaneAt(layout, paneId, "horizontal", newLeaf);
      const paths = collectPaneSessionPaths(nextLayout);
      visiblePathsSyncedRef.current = paths.join("\0");
      await runtime.syncSplitPaneSessions(paths, response.sessionPath);
      setLayout(nextLayout);
      setFocusedPaneId(newPaneId);
      persistSessionSplitBinding(nextLayout);
    },
    [layout, runtime, snapshot],
  );

  const addMessageQuoteToSideChat = useCallback(
    async (paneId: string, attachment: MessageQuoteAttachment) => {
      // Reuse the last navigated Side Chat pane that has been left; when already on that pane, create a new one per the original logic
      const candidateId = lastNavigatedSideChatPaneIdRef.current;
      const candidateLeaf = candidateId && layout ? findLeafByPaneId(layout, candidateId) : null;
      const candidateHandlers = candidateId
        ? paneComposerInsertRegistryRef.current.get(candidateId)
        : undefined;
      if (candidateId && candidateId !== paneId && candidateLeaf && candidateHandlers) {
        candidateHandlers.handleMessageQuoteAddToChat(attachment);
        focusPane(candidateId, candidateLeaf.sessionPath);
        return;
      }
      await beginSideChat(paneId, { messageQuote: attachment });
    },
    [beginSideChat, focusPane, layout],
  );

  useEffect(() => {
    if (!registerBeginSideChat) {
      return;
    }
    registerBeginSideChat(() => {
      const currentLayout = layoutRef.current;
      if (!currentLayout) {
        return;
      }
      const focused = focusedPaneIdRef.current;
      const paneId =
        focused && findLeafByPaneId(currentLayout, focused)
          ? focused
          : findWorkspaceToolsAnchorPaneId(currentLayout);
      void beginSideChat(paneId);
    });
    return () => {
      registerBeginSideChat(null);
    };
  }, [beginSideChat, registerBeginSideChat]);

  useEffect(() => {
    registerSplitPaneShortcut({
      splitFocusedPane(direction) {
        const currentLayout = layoutRef.current;
        if (!currentLayout) {
          return;
        }
        const focused = focusedPaneIdRef.current;
        const paneId =
          focused && findLeafByPaneId(currentLayout, focused)
            ? focused
            : findWorkspaceToolsAnchorPaneId(currentLayout);
        void splitPane(paneId, direction);
      },
    });
    return () => unregisterSplitPaneShortcut();
  }, [splitPane]);

  const closePaneById = useCallback(
    async (paneId: string, sessionPath: string) => {
      if (!layout) {
        return;
      }

      const pathsBeforeClose = collectPaneSessionPaths(layout);

      const nextLayout = closePane(layout, paneId);

      if (!nextLayout) {
        return;
      }

      clearSessionSplitBindings(pathsBeforeClose);

      setLayout(nextLayout);

      if (runtime.apiReady) {
        await runtime.closeSplitPaneSession(sessionPath);
      }

      await syncVisiblePaths(nextLayout);

      if (countPanes(nextLayout) > 1) {
        persistSessionSplitBinding(nextLayout);
      }

      if (focusedPaneId === paneId) {
        const anchorPaneId = findWorkspaceToolsAnchorPaneId(nextLayout);

        const anchorLeaf = findLeafByPaneId(nextLayout, anchorPaneId);

        if (anchorLeaf) {
          focusPane(anchorLeaf.paneId, anchorLeaf.sessionPath);
        }
      }
    },

    [focusPane, focusedPaneId, layout, runtime, syncVisiblePaths],
  );

  const collapsePaneLayoutById = useCallback(
    async (paneId: string) => {
      if (!layout) {
        return;
      }

      if (countPanes(layout) <= 1) {
        return;
      }

      const pathsBeforeClose = collectPaneSessionPaths(layout);

      const nextLayout = closePane(layout, paneId);

      if (!nextLayout) {
        return;
      }

      clearSessionSplitBindings(pathsBeforeClose);

      setLayout(nextLayout);

      await syncVisiblePaths(nextLayout);

      if (countPanes(nextLayout) > 1) {
        persistSessionSplitBinding(nextLayout);
      }

      if (focusedPaneId === paneId) {
        const anchorPaneId = findWorkspaceToolsAnchorPaneId(nextLayout);

        const anchorLeaf = findLeafByPaneId(nextLayout, anchorPaneId);

        if (anchorLeaf) {
          focusPane(anchorLeaf.paneId, anchorLeaf.sessionPath);
        }
      }
    },

    [focusPane, focusedPaneId, layout, syncVisiblePaths],
  );

  const endSplitLayoutResize = useCallback(() => {
    splitRatioResizeActiveRef.current = false;
  }, []);

  const beginSplitLayoutResize = useCallback(() => {
    splitRatioResizeActiveRef.current = true;
  }, []);

  const persistLayoutBinding = useCallback(() => {
    const current = layoutRef.current;

    if (current && countPanes(current) > 1) {
      persistSessionSplitBinding(current);
    }
  }, []);

  const updateRatio = useCallback(
    (splitId: string, ratio: number, options?: { persist?: boolean }) => {
      const shouldPersist = options?.persist !== false;

      setLayout((current) => {
        if (!current) {
          return current;
        }

        const next = updateSplitRatio(current, splitId, ratio);

        if (shouldPersist && countPanes(next) > 1) {
          persistSessionSplitBinding(next);
        }

        return next;
      });
    },
    [],
  );

  const updateRatios = useCallback(
    (updates: readonly { splitId: string; ratio: number }[], options?: { persist?: boolean }) => {
      if (updates.length === 0) {
        return;
      }

      const shouldPersist = options?.persist !== false;

      setLayout((current) => {
        if (!current) {
          return current;
        }

        const next = updateSplitRatios(current, updates);

        if (shouldPersist && countPanes(next) > 1) {
          persistSessionSplitBinding(next);
        }

        return next;
      });
    },
    [],
  );

  const [highlightedSplitIds, setHighlightedSplitIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const setSplitResizeHighlight = useCallback((splitIds: Iterable<string> | null) => {
    if (!splitIds) {
      setHighlightedSplitIds(new Set());

      return;
    }

    setHighlightedSplitIds(new Set(splitIds));
  }, []);

  const repositionPaneById = useCallback(
    (sourcePaneId: string, targetPaneId: string, zone: PaneRepositionZone) => {
      setLayout((current) => {
        if (!current) {
          return current;
        }

        const next = repositionPane(current, sourcePaneId, targetPaneId, zone) ?? current;

        if (countPanes(next) > 1) {
          persistSessionSplitBinding(next);
        }

        return next;
      });
    },

    [],
  );

  const startPaneDrag = useCallback((paneId: string) => {
    const current = layoutRef.current;

    if (!current || countPanes(current) <= 1) {
      return;
    }

    dragSourcePaneIdRef.current = paneId;

    setPaneDragSourcePaneId(paneId);

    setPaneDragActive(true);
  }, []);

  const clearPaneDrag = useCallback(() => {
    dragSourcePaneIdRef.current = null;

    setPaneDragSourcePaneId(null);

    setPaneDropTarget(null);

    setPaneDragActive(false);
  }, []);

  const completePaneDrop = useCallback(
    (targetPaneId: string, zone: PaneDropZone) => {
      const sourcePaneId = dragSourcePaneIdRef.current;

      dragSourcePaneIdRef.current = null;

      setPaneDragSourcePaneId(null);

      setPaneDropTarget(null);

      setPaneDragActive(false);

      if (!sourcePaneId) {
        return;
      }

      if (zone === "swap") {
        setLayout((current) => {
          if (!current) {
            return current;
          }

          const next = swapAdjacentPanes(current, sourcePaneId, targetPaneId);

          if (countPanes(next) > 1) {
            persistSessionSplitBinding(next);
          }

          return next;
        });

        return;
      }

      repositionPaneById(sourcePaneId, targetPaneId, zone);
    },

    [repositionPaneById],
  );

  const startSidebarSessionDrag = useCallback((payload: SidebarSessionDragPayload) => {
    setSidebarSessionDragPayload(payload);
  }, []);

  const clearSidebarSessionDrag = useCallback(() => {
    setSidebarSessionDragPayload(null);
    setPaneDropTarget(null);
  }, [setPaneDropTarget]);

  const flushPendingQuoteScroll = useCallback((paneId: string, sessionPath: string) => {
    const pending = pendingQuoteScrollRef.current;
    if (!pending) {
      return;
    }
    if (normalizeSessionPathKey(pending.sessionPath) !== normalizeSessionPathKey(sessionPath)) {
      return;
    }
    const registered = quoteScrollHandlersRef.current.get(paneId);
    if (!registered) {
      return;
    }
    pendingQuoteScrollRef.current = null;
    registered.handler({
      messageId: pending.messageId,
      behavior: pending.behavior,
      nonce: pending.nonce,
    });
  }, []);

  const registerQuoteScrollHandler = useCallback(
    (paneId: string, sessionPath: string, handler: ConversationQuoteScrollHandler | null) => {
      if (!handler) {
        quoteScrollHandlersRef.current.delete(paneId);
        return;
      }
      quoteScrollHandlersRef.current.set(paneId, { sessionPath, handler });
      flushPendingQuoteScroll(paneId, sessionPath);
    },
    [flushPendingQuoteScroll],
  );

  const requestQuoteScroll = useCallback(
    (input: { sessionPath: string; messageId: number; behavior: ScrollBehavior }) => {
      const nonce = quoteScrollNonceRef.current + 1;
      quoteScrollNonceRef.current = nonce;
      pendingQuoteScrollRef.current = { ...input, nonce };
      const leaf = layoutRef.current
        ? findLeafBySessionPath(layoutRef.current, input.sessionPath)
        : undefined;
      if (!leaf) {
        return;
      }
      flushPendingQuoteScroll(leaf.paneId, leaf.sessionPath);
    },
    [flushPendingQuoteScroll],
  );

  const openStoredSessionInSplitPane = useCallback(
    async (
      anchorPaneId: string,
      sessionPath: string,
      placement: SplitDirection | PaneRepositionZone = "horizontal",
      options?: { asSideChat?: boolean },
    ): Promise<string | null> => {
      const layoutBefore = layoutRef.current;
      if (!layoutBefore || !runtime.apiReady) {
        return null;
      }
      if (!findLeafByPaneId(layoutBefore, anchorPaneId)) {
        return null;
      }

      const existingLeaf = findLeafBySessionPath(layoutBefore, sessionPath);
      if (existingLeaf) {
        focusPane(existingLeaf.paneId, existingLeaf.sessionPath);
        return existingLeaf.paneId;
      }

      onEnsureConversationSurface?.();
      layoutNavigationLockRef.current = true;
      setLayoutNavigationPending(true);
      try {
        const newPaneId = createPaneId();
        const layoutForSplit = layoutRef.current;
        if (!layoutForSplit || !findLeafByPaneId(layoutForSplit, anchorPaneId)) {
          return null;
        }
        const newLeaf = createLeafNode(newPaneId, sessionPath);
        const nextLayout =
          placement === "horizontal" || placement === "vertical"
            ? splitPaneAt(layoutForSplit, anchorPaneId, placement, newLeaf)
            : splitPaneAtZone(layoutForSplit, anchorPaneId, placement, newLeaf);
        const paths = collectPaneSessionPaths(nextLayout);
        visiblePathsSyncedRef.current = paths.join("\0");
        await runtime.syncSplitPaneSessions(paths, sessionPath);
        if (options?.asSideChat) {
          sideChatPaneIdsRef.current.add(newPaneId);
        }
        setLayout(nextLayout);
        setFocusedPaneId(newPaneId);
        persistSessionSplitBinding(nextLayout);
        return newPaneId;
      } finally {
        layoutNavigationLockRef.current = false;
        setLayoutNavigationPending(false);
      }
    },
    [focusPane, onEnsureConversationSurface, runtime],
  );

  const completeSidebarSessionDrop = useCallback(
    async (targetPaneId: string, zone: PaneRepositionZone) => {
      const payload = sidebarSessionDragPayload;
      clearSidebarSessionDrag();
      const layoutBeforeDrop = layoutRef.current;
      if (!payload || !layoutBeforeDrop || !runtime.apiReady) {
        return;
      }

      if (!findLeafByPaneId(layoutBeforeDrop, targetPaneId)) {
        return;
      }

      onEnsureConversationSurface?.();

      if (payload.kind === "stored") {
        await openStoredSessionInSplitPane(targetPaneId, payload.sessionPath, zone);
        return;
      }

      layoutNavigationLockRef.current = true;
      setLayoutNavigationPending(true);

      try {
        const newPaneId = createPaneId();
        if (payload.kind === "new-in-workspace") {
          const trimmed = payload.workspaceRoot.trim();
          if (trimmed) {
            const currentRoot = snapshot?.workspaceRoot?.trim() ?? "";
            const needsSwitch =
              snapshot?.workspaceBinding !== "project" ||
              !currentRoot ||
              !sameWorkspacePath(currentRoot, trimmed);
            if (needsSwitch) {
              const switched = await runtime.switchWorkspaceRoot(trimmed);
              if (!switched) {
                return;
              }
            }
          }
        }
        const response = await runtime.beginSplitPaneSession(newPaneId, { deferSnapshot: true });
        const newSessionPath = response.sessionPath;

        const layoutForSplit = layoutRef.current;
        if (!layoutForSplit || !findLeafByPaneId(layoutForSplit, targetPaneId)) {
          return;
        }

        const newLeaf = createLeafNode(newPaneId, newSessionPath);
        const nextLayout = splitPaneAtZone(layoutForSplit, targetPaneId, zone, newLeaf);
        const paths = collectPaneSessionPaths(nextLayout);
        visiblePathsSyncedRef.current = paths.join("\0");

        await runtime.syncSplitPaneSessions(paths, newSessionPath);
        setLayout(nextLayout);
        setFocusedPaneId(newPaneId);
        persistSessionSplitBinding(nextLayout);
      } finally {
        layoutNavigationLockRef.current = false;
        setLayoutNavigationPending(false);
      }
    },
    [
      clearSidebarSessionDrag,
      onEnsureConversationSurface,
      openStoredSessionInSplitPane,
      runtime,
      sidebarSessionDragPayload,
      snapshot?.workspaceBinding,
      snapshot?.workspaceRoot,
    ],
  );

  const paneCount = layout ? countPanes(layout) : 0;
  useDarwinConversationSplitChrome(paneCount);

  const isSideChatPane = useCallback((paneId: string) => {
    return sideChatPaneIdsRef.current.has(paneId);
  }, []);

  const value = useMemo<ConversationSplitContextValue>(
    () => ({
      layout,

      focusedPaneId,

      anchorPaneId: layout ? findWorkspaceToolsAnchorPaneId(layout) : null,

      sessionSidebarAnchorPaneId: layout ? findSessionSidebarAnchorPaneId(layout) : null,

      paneCount,

      focusPane,

      splitPane,

      beginSideChat,

      addMessageQuoteToSideChat,

      isSideChatPane,

      closePaneById,

      collapsePaneLayoutById,

      updateRatio,

      updateRatios,

      persistLayoutBinding,

      beginSplitLayoutResize,

      endSplitLayoutResize,

      highlightedSplitIds,

      setSplitResizeHighlight,

      repositionPaneById,

      startPaneDrag,

      clearPaneDrag,

      completePaneDrop,

      paneDragActive,

      paneDragSourcePaneId,

      paneDropTarget,

      setPaneDropTarget,

      sidebarSessionDragActive,

      sidebarSessionDragPayload,

      startSidebarSessionDrag,

      clearSidebarSessionDrag,

      completeSidebarSessionDrop,

      openStoredSessionInSplitPane,

      registerQuoteScrollHandler,

      requestQuoteScroll,

      layoutNavigationPending,

      registerPaneComposerInsert,

      registerPaneComposerControls,

      getFocusedPaneComposerInsert,

      getFocusedPaneComposerControls,

      conversationAbortShortcutTargetRef,
    }),

    [
      clearPaneDrag,

      clearSidebarSessionDrag,

      closePaneById,

      collapsePaneLayoutById,

      completePaneDrop,

      completeSidebarSessionDrop,

      openStoredSessionInSplitPane,

      registerQuoteScrollHandler,

      requestQuoteScroll,

      focusPane,

      focusedPaneId,

      layout,

      layoutNavigationPending,

      paneDragActive,

      paneDragSourcePaneId,

      paneDropTarget,

      sidebarSessionDragActive,

      sidebarSessionDragPayload,

      repositionPaneById,

      setPaneDropTarget,

      splitPane,

      beginSideChat,

      addMessageQuoteToSideChat,

      isSideChatPane,

      startPaneDrag,

      startSidebarSessionDrag,

      updateRatio,

      updateRatios,

      persistLayoutBinding,

      beginSplitLayoutResize,

      endSplitLayoutResize,

      highlightedSplitIds,

      setSplitResizeHighlight,
    ],
  );

  return (
    <ConversationSplitContext.Provider value={value}>{children}</ConversationSplitContext.Provider>
  );
}

export function useConversationSplit(): ConversationSplitContextValue {
  const context = useContext(ConversationSplitContext);

  if (!context) {
    throw new Error("useConversationSplit must be used within ConversationSplitProvider");
  }

  return context;
}

export function useOptionalConversationSplit(): ConversationSplitContextValue | null {
  return useContext(ConversationSplitContext);
}
