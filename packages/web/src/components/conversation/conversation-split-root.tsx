import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  junctionResizeCursor,
  resizeCursor,
  useDragResizeCursor,
} from "@spiritagent/ui/resize-cursor";

import { ConversationPaneDropIndicator } from "@/components/conversation/conversation-pane-drop-indicator";
import { useConversationSplit } from "@/contexts/conversation-split-context";
import {
  clampSplitRatio,
  collectSplitJunctions,
  type SplitJunctionSpec,
  type SplitLayoutNode,
  type SplitLayoutSplitNode,
} from "@/lib/conversation-split-layout";
import {
  useConversationSplitShellDivider,
  syncAllConversationSplitShellDividers,
} from "@/lib/use-conversation-split-shell-divider";
import { cn } from "@/lib/utils";

type ConversationSplitRootProps = {
  useTranslucency: boolean;
  renderPane: (input: {
    paneId: string;
    sessionPath: string;
    isFocused: boolean;
    isAnchorPane: boolean;
    isSessionSidebarAnchorPane: boolean;
    useIsolatedPane: boolean;
    splitPaneCount: number;
    onFocusPane: () => void;
    onSideChat: () => void;
    onSplit: () => void;
    onSplitVertical: () => void;
    onClosePane: () => void;
    showClosePane: boolean;
    paneReorderEnabled: boolean;
    onPaneDragStart: (paneId: string) => void;
    onPaneDragLeave: () => void;
    onPaneDrop: (
      targetPaneId: string,
      zone: import("@/lib/conversation-split-layout").PaneDropZone,
    ) => void;
    onSidebarSessionDrop: (
      targetPaneId: string,
      zone: import("@/lib/conversation-split-layout").PaneRepositionZone,
    ) => void;
    paneDropOverlayActive: boolean;
    paneDragSourcePaneId: string | null;
    sidebarSessionDragActive: boolean;
  }) => ReactNode;
};

const MIN_RATIO = clampSplitRatio(0);
const MAX_RATIO = clampSplitRatio(1);

function splitIdsForJunction(junction: SplitJunctionSpec): string[] {
  return [...new Set([...junction.xSplitIds, ...junction.ySplitIds])];
}

function SplitDivider({
  splitId,
  direction,
  ratio,
  boundsRef,
  highlighted,
  onResizeBegin,
  onRatioPreview,
  onRatioCommit,
}: {
  splitId: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  boundsRef: RefObject<HTMLDivElement | null>;
  highlighted: boolean;
  onResizeBegin: () => void;
  onRatioPreview: (ratio: number) => void;
  onRatioCommit: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const separatorRef = useRef<HTMLDivElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const dragRef = useRef<{ start: number; startRatio: number } | null>(null);
  const dragCursor = useDragResizeCursor();
  const grow = direction === "horizontal" ? "right" : "down";
  const lineActive = highlighted || isResizing || isHovered;

  useConversationSplitShellDivider(
    separatorRef,
    {
      splitId,
      lineOrientation: direction === "horizontal" ? "vertical" : "horizontal",
      boundsRef,
      active: lineActive,
    },
    [lineActive, ratio],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current?.parentElement;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const startRatio =
        direction === "horizontal"
          ? (event.clientX - rect.left) / Math.max(rect.width, 1)
          : (event.clientY - rect.top) / Math.max(rect.height, 1);
      dragRef.current = {
        start: direction === "horizontal" ? event.clientX : event.clientY,
        startRatio,
      };
      setIsResizing(true);
      dragCursor.start(resizeCursor(clampSplitRatio(startRatio), MIN_RATIO, MAX_RATIO, grow));
      onResizeBegin();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [direction, dragCursor, grow, onResizeBegin],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const container = containerRef.current?.parentElement;
      if (!drag || !container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const nextRatio =
        direction === "horizontal"
          ? (event.clientX - rect.left) / Math.max(rect.width, 1)
          : (event.clientY - rect.top) / Math.max(rect.height, 1);
      const clamped = clampSplitRatio(nextRatio);
      dragCursor.update(resizeCursor(clamped, MIN_RATIO, MAX_RATIO, grow));
      onRatioPreview(clamped);
      requestAnimationFrame(() => {
        syncAllConversationSplitShellDividers();
      });
    },
    [direction, dragCursor, grow, onRatioPreview],
  );

  const endResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      dragCursor.end();
      setIsResizing(false);
      onRatioCommit();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
      requestAnimationFrame(() => {
        syncAllConversationSplitShellDividers();
      });
    },
    [dragCursor, onRatioCommit],
  );

  return (
    <div
      ref={containerRef}
      data-split-id={splitId}
      className={cn(
        "relative flex min-h-0 min-w-0",
        direction === "horizontal" ? "h-full w-0 shrink-0" : "h-0 w-full shrink-0",
      )}
    >
      <div
        ref={separatorRef}
        role="separator"
        aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
        className={cn(
          "group relative z-20 touch-none select-none",
          direction === "horizontal"
            ? "h-full w-1 shrink-0 before:absolute before:inset-y-0 before:-left-1 before:w-3 before:content-['']"
            : "h-1 w-full shrink-0 before:absolute before:inset-x-0 before:-top-1 before:h-3 before:content-['']",
          isResizing ? "transition-none" : undefined,
        )}
        style={{ cursor: resizeCursor(ratio, MIN_RATIO, MAX_RATIO, grow) }}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
    </div>
  );
}

function SplitJunctionHandle({
  junction,
  onResize,
  onHighlight,
  onDragEnd,
}: {
  junction: SplitJunctionSpec;
  onResize: (junction: SplitJunctionSpec, clientX: number, clientY: number) => void;
  onHighlight: (splitIds: Iterable<string> | null) => void;
  onDragEnd: () => void;
}) {
  const draggingRef = useRef(false);
  const dragCursor = useDragResizeCursor();
  const cursorAt = useCallback((element: HTMLDivElement, clientX: number, clientY: number) => {
    const rect = element.parentElement?.getBoundingClientRect();
    if (!rect) return "move";
    return junctionResizeCursor(
      clampSplitRatio((clientX - rect.left) / Math.max(rect.width, 1)),
      clampSplitRatio((clientY - rect.top) / Math.max(rect.height, 1)),
      MIN_RATIO,
      MAX_RATIO,
    );
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      draggingRef.current = true;
      dragCursor.start(cursorAt(event.currentTarget, event.clientX, event.clientY));
      onHighlight(splitIdsForJunction(junction));
      event.currentTarget.setPointerCapture(event.pointerId);
      onResize(junction, event.clientX, event.clientY);
    },
    [cursorAt, dragCursor, junction, onHighlight, onResize],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return;
      }
      dragCursor.update(cursorAt(event.currentTarget, event.clientX, event.clientY));
      onResize(junction, event.clientX, event.clientY);
    },
    [cursorAt, dragCursor, junction, onResize],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      draggingRef.current = false;
      dragCursor.end();
      onHighlight(null);
      onDragEnd();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
    },
    [dragCursor, onDragEnd, onHighlight],
  );

  return (
    <div
      role="separator"
      aria-label="Resize split intersection"
      className={cn(
        "absolute z-30 touch-none select-none",
        "before:absolute before:-inset-2 before:content-['']",
      )}
      style={{
        cursor: junctionResizeCursor(junction.xRatio, junction.yRatio, MIN_RATIO, MAX_RATIO),
        left: `calc(${junction.xRatio * 100}% - 4px)`,
        top: `calc(${junction.yRatio * 100}% - 4px)`,
        width: 8,
        height: 8,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => onHighlight(splitIdsForJunction(junction))}
      onPointerLeave={() => {
        if (!draggingRef.current) {
          onHighlight(null);
        }
      }}
    />
  );
}

function SplitLayoutRenderer({
  node,
  useTranslucency,
  renderPane,
}: {
  node: SplitLayoutNode;
  useTranslucency: boolean;
  renderPane: ConversationSplitRootProps["renderPane"];
}) {
  const split = useConversationSplit();

  if (node.kind === "leaf") {
    const isFocused = split.focusedPaneId === node.paneId;
    const isAnchorPane = split.anchorPaneId === node.paneId;
    const isSessionSidebarAnchorPane = split.sessionSidebarAnchorPaneId === node.paneId;
    const paneReorderEnabled = split.paneCount > 1;
    return (
      <>
        {renderPane({
          paneId: node.paneId,
          sessionPath: node.sessionPath,
          isFocused,
          isAnchorPane,
          isSessionSidebarAnchorPane,
          useIsolatedPane: true,
          splitPaneCount: split.paneCount,
          onFocusPane: () => split.focusPane(node.paneId, node.sessionPath),
          onSideChat: () => {
            void split.beginSideChat(node.paneId);
          },
          onSplit: () => {
            void split.splitPane(node.paneId, "horizontal");
          },
          onSplitVertical: () => {
            void split.splitPane(node.paneId, "vertical");
          },
          onClosePane: () => {
            void split.closePaneById(node.paneId, node.sessionPath);
          },
          showClosePane: split.paneCount > 1,
          paneReorderEnabled,
          onPaneDragStart: split.startPaneDrag,
          onPaneDragLeave: split.clearPaneDrag,
          onPaneDrop: split.completePaneDrop,
          onSidebarSessionDrop: (targetPaneId, zone) => {
            void split.completeSidebarSessionDrop(targetPaneId, zone);
          },
          paneDropOverlayActive: split.paneDragActive || split.sidebarSessionDragActive,
          paneDragSourcePaneId: split.paneDragSourcePaneId,
          sidebarSessionDragActive: split.sidebarSessionDragActive,
        })}
      </>
    );
  }

  return (
    <SplitLayoutSplitRenderer
      node={node}
      useTranslucency={useTranslucency}
      renderPane={renderPane}
    />
  );
}

function SplitLayoutSplitRenderer({
  node,
  useTranslucency,
  renderPane,
}: {
  node: SplitLayoutSplitNode;
  useTranslucency: boolean;
  renderPane: ConversationSplitRootProps["renderPane"];
}) {
  const split = useConversationSplit();
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const firstPaneRef = useRef<HTMLDivElement | null>(null);
  const secondPaneRef = useRef<HTMLDivElement | null>(null);
  const pendingRatioRef = useRef(node.ratio);

  const applyFlexRatio = useCallback((ratio: number) => {
    const clamped = clampSplitRatio(ratio);
    pendingRatioRef.current = clamped;
    const nextFirstFlex = clamped;
    const nextSecondFlex = 1 - clamped;
    if (firstPaneRef.current) {
      firstPaneRef.current.style.flex = `${nextFirstFlex} 1 0%`;
    }
    if (secondPaneRef.current) {
      secondPaneRef.current.style.flex = `${nextSecondFlex} 1 0%`;
    }
  }, []);

  const commitFlexRatio = useCallback(() => {
    const ratio = pendingRatioRef.current;
    split.updateRatio(node.splitId, ratio, { persist: false });
    split.persistLayoutBinding();
    split.endSplitLayoutResize();
  }, [node.splitId, split]);

  useLayoutEffect(() => {
    pendingRatioRef.current = node.ratio;
    applyFlexRatio(node.ratio);
  }, [applyFlexRatio, node.ratio]);

  const handleJunctionResize = useCallback(
    (junction: SplitJunctionSpec, clientX: number, clientY: number) => {
      const container = splitContainerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const xRatio = clampSplitRatio((clientX - rect.left) / Math.max(rect.width, 1));
      const yRatio = clampSplitRatio((clientY - rect.top) / Math.max(rect.height, 1));
      const updates: { splitId: string; ratio: number }[] = [];
      for (const splitId of junction.xSplitIds) {
        updates.push({ splitId, ratio: xRatio });
      }
      for (const splitId of junction.ySplitIds) {
        updates.push({ splitId, ratio: yRatio });
      }
      split.updateRatios(updates, { persist: false });
      requestAnimationFrame(() => {
        syncAllConversationSplitShellDividers();
      });
    },
    [split],
  );

  const isHorizontal = node.direction === "horizontal";
  const firstFlex = node.ratio;
  const secondFlex = 1 - node.ratio;
  const junctions = collectSplitJunctions(node);

  return (
    <div
      ref={splitContainerRef}
      data-spirit-surface="conversation-split"
      data-split-direction={node.direction}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
        isHorizontal ? "flex-row" : "flex-col",
      )}
    >
      <div
        ref={firstPaneRef}
        className="flex min-h-0 min-w-0 overflow-hidden"
        style={{ flex: `${firstFlex} 1 0%` }}
      >
        <SplitLayoutRenderer
          node={node.first}
          useTranslucency={useTranslucency}
          renderPane={renderPane}
        />
      </div>
      <SplitDivider
        splitId={node.splitId}
        direction={node.direction}
        ratio={node.ratio}
        boundsRef={splitContainerRef}
        highlighted={split.highlightedSplitIds.has(node.splitId)}
        onResizeBegin={() => split.beginSplitLayoutResize()}
        onRatioPreview={applyFlexRatio}
        onRatioCommit={commitFlexRatio}
      />
      <div
        ref={secondPaneRef}
        className="flex min-h-0 min-w-0 overflow-hidden"
        style={{ flex: `${secondFlex} 1 0%` }}
      >
        <SplitLayoutRenderer
          node={node.second}
          useTranslucency={useTranslucency}
          renderPane={renderPane}
        />
      </div>
      {junctions.map((junction) => (
        <SplitJunctionHandle
          key={junction.id}
          junction={junction}
          onResize={handleJunctionResize}
          onHighlight={split.setSplitResizeHighlight}
          onDragEnd={() => split.persistLayoutBinding()}
        />
      ))}
    </div>
  );
}

export function ConversationSplitRoot({ useTranslucency, renderPane }: ConversationSplitRootProps) {
  const { layout } = useConversationSplit();

  if (!layout) {
    return null;
  }

  return (
    <div
      data-conversation-split-shell
      data-spirit-surface="conversation-split-root"
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <ConversationPaneDropIndicator />
      <SplitLayoutRenderer
        node={layout}
        useTranslucency={useTranslucency}
        renderPane={renderPane}
      />
    </div>
  );
}
