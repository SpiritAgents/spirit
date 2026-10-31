import { Globe } from "@spiritagent/icons/globe";
import { resizeCursor, useDragResizeCursor } from "@spiritagent/ui/resize-cursor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { FileText, GitBranch, Terminal } from "lucide-react";

import { WorkspaceBrowserPreviewTab } from "@/components/workspace-browser-preview-tab";
import { WorkspaceFilesTab } from "@/components/workspace-files-tab";
import { WorkspaceGitPreviewTab } from "@/components/workspace-git-preview-tab";
import { WorkspaceTerminalTab } from "@/components/workspace-terminal-tab";
import { protectBrandTokens } from "@/components/no-translate";
import { useI18n } from "@/i18n/provider";
import type { DesignModeDemoState } from "@/lib/design-mode-demo-state";
import {
  WORKSPACE_TOOLS_MIN_WIDTH_PX,
  computeWorkspaceToolsMaxWidthPx,
  writeWorkspaceToolsWidthPx,
} from "@/lib/layout-prefs";
import {
  desktopTranslucencyTintClass,
  desktopTranslucencyWorkspaceTabSelectedClass,
} from "@/lib/desktop-translucency-surface";
import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import {
  createInitialWorkspaceToolsState,
  DESIGN_MODE_BROWSER_URL,
  type WorkspaceToolTab,
  type WorkspaceToolTabKind,
} from "@/lib/workspace-tool-tabs";
import { cn } from "@/lib/utils";
import type { PlanSnapshot, WorkspaceExplorerListResult } from "@/types/spirit-desktop";

export type WorkspaceToolsTab = "files" | "terminal" | "git";

export type WorkspaceToolsDockProps = {
  workspaceRoot: string;
  branch?: string;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  widthPx: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  onWidthPxChange(next: number): void;
  open: boolean;
  className?: string;
  baseToneClassName?: string;
  useTranslucency?: boolean;
  plan?: PlanSnapshot;
  planPreviewContent?: string;
  planRevealNonce?: number;
  hideFileTree?: boolean;
  dockMode?: "legacy" | "designMode";
  designModeState?: DesignModeDemoState;
  onDesignModeStateChange?: (patch: Partial<DesignModeDemoState>) => void;
  onDesignModeUserInteract?: () => void;
};

const LEGACY_TAB_ITEMS: Array<{
  id: WorkspaceToolsTab;
  labelKey: "filesTab" | "terminalTab" | "gitTab";
  icon: typeof FileText;
}> = [
  { id: "files", labelKey: "filesTab", icon: FileText },
  { id: "terminal", labelKey: "terminalTab", icon: Terminal },
  { id: "git", labelKey: "gitTab", icon: GitBranch },
];

const DESIGN_TAB_META: Record<
  WorkspaceToolTabKind,
  { labelKey: "filesTab" | "terminalTab" | "gitTab" | "browserTab"; icon: typeof FileText }
> = {
  files: { labelKey: "filesTab", icon: FileText },
  terminal: { labelKey: "terminalTab", icon: Terminal },
  git: { labelKey: "gitTab", icon: GitBranch },
  browser: { labelKey: "browserTab", icon: Globe },
};

export function WorkspaceToolsDock({
  workspaceRoot,
  branch,
  listExplorerChildren,
  widthPx,
  minWidthPx = WORKSPACE_TOOLS_MIN_WIDTH_PX,
  maxWidthPx: maxWidthPxProp,
  onWidthPxChange,
  open,
  className,
  baseToneClassName,
  useTranslucency = false,
  plan,
  planPreviewContent = "",
  planRevealNonce = 0,
  hideFileTree = false,
  dockMode = "legacy",
  designModeState,
  onDesignModeStateChange,
  onDesignModeUserInteract,
}: WorkspaceToolsDockProps) {
  const { messages } = useI18n();
  const toolsCopy = messages.desktop.tools;
  const [legacyTab, setLegacyTab] = useState<WorkspaceToolsTab>("files");
  const [designTabsState] = useState(() => {
    const initial = createInitialWorkspaceToolsState(true);
    const browserTab = initial.tabs.find((tab) => tab.kind === "browser");
    const tabs = initial.tabs.map((tab) =>
      tab.kind === "browser"
        ? { ...tab, tabTitle: messages.common.brand, browserUrl: DESIGN_MODE_BROWSER_URL }
        : tab,
    );
    return {
      tabs,
      activeTabId: browserTab?.id ?? initial.activeTabId,
    };
  });
  const [activeDesignTabId, setActiveDesignTabId] = useState(designTabsState.activeTabId);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const dragCursor = useDragResizeCursor();
  const latestWidthPxRef = useRef(widthPx);
  latestWidthPxRef.current = widthPx;
  const [viewportMaxWidthPx, setViewportMaxWidthPx] = useState(computeWorkspaceToolsMaxWidthPx);
  const maxWidthPx = maxWidthPxProp ?? viewportMaxWidthPx;
  const dockWidthPx = open ? widthPx + 4 : 0;

  const activeDesignTab = useMemo(
    () => designTabsState.tabs.find((tab) => tab.id === activeDesignTabId),
    [activeDesignTabId, designTabsState.tabs],
  );

  useEffect(() => {
    if (maxWidthPxProp !== undefined) {
      return;
    }
    const onWindowResize = () => {
      setViewportMaxWidthPx(computeWorkspaceToolsMaxWidthPx());
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [maxWidthPxProp]);

  useEffect(() => {
    if (!open) {
      setIsResizing(false);
    }
  }, [open]);

  const clampWidth = useCallback(
    (value: number) => Math.min(maxWidthPx, Math.max(minWidthPx, value)),
    [maxWidthPx, minWidthPx],
  );

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizing(true);
      dragRef.current = { startX: event.clientX, startWidth: widthPx };
      dragCursor.start(resizeCursor(widthPx, WORKSPACE_TOOLS_MIN_WIDTH_PX, maxWidthPx, "left"));
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [dragCursor, maxWidthPx, widthPx],
  );

  const onResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const delta = drag.startX - event.clientX;
      const next = clampWidth(drag.startWidth + delta);
      dragCursor.update(resizeCursor(next, WORKSPACE_TOOLS_MIN_WIDTH_PX, maxWidthPx, "left"));
      onWidthPxChange(next);
    },
    [clampWidth, dragCursor, maxWidthPx, onWidthPxChange],
  );

  const endResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragCursor.end();
      setIsResizing(false);
      if (dragRef.current) {
        writeWorkspaceToolsWidthPx(latestWidthPxRef.current);
      }
      dragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released.
      }
    },
    [dragCursor],
  );

  const renderLegacyTabPanel = () => {
    if (legacyTab === "files") {
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
          <WorkspaceFilesTab
            workspaceRoot={workspaceRoot}
            listExplorerChildren={listExplorerChildren}
            plan={plan}
            planPreviewContent={planPreviewContent}
            autoRevealPlanNonce={planRevealNonce}
            hideFileTree={hideFileTree}
          />
        </div>
      );
    }
    if (legacyTab === "terminal") {
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
          <WorkspaceTerminalTab workspaceRoot={workspaceRoot} />
        </div>
      );
    }
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
        <WorkspaceGitPreviewTab branch={branch} />
      </div>
    );
  };

  const renderDesignTabPanel = (tab: WorkspaceToolTab) => {
    if (tab.kind === "browser" && designModeState) {
      return (
        <WorkspaceBrowserPreviewTab
          designModeState={designModeState}
          onDesignModeStateChange={onDesignModeStateChange}
          onDesignModeUserInteract={onDesignModeUserInteract}
          useTranslucency={useTranslucency}
        />
      );
    }
    if (tab.kind === "files") {
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
          <WorkspaceFilesTab
            workspaceRoot={workspaceRoot}
            listExplorerChildren={listExplorerChildren}
            hideFileTree={hideFileTree}
          />
        </div>
      );
    }
    if (tab.kind === "terminal") {
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
          <WorkspaceTerminalTab workspaceRoot={workspaceRoot} />
        </div>
      );
    }
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
        <WorkspaceGitPreviewTab branch={branch} />
      </div>
    );
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-row self-stretch overflow-hidden",
        isResizing
          ? "transition-none"
          : "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0",
        !open && "pointer-events-none select-none",
        className,
      )}
      style={{ width: dockWidthPx }}
      aria-hidden={!open}
      inert={!open}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={toolsCopy.resizeAria}
        className={cn(
          "group relative z-10 w-1 shrink-0 touch-none select-none",
          "before:absolute before:inset-y-0 before:-left-1 before:w-3 before:content-['']",
        )}
        style={{ cursor: resizeCursor(widthPx, WORKSPACE_TOOLS_MIN_WIDTH_PX, maxWidthPx, "left") }}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-px transition-colors",
            useTranslucency
              ? "bg-black/5 group-hover:bg-black/10 dark:bg-white/10 dark:group-hover:bg-white/14"
              : "bg-border/40 group-hover:bg-border/55",
          )}
          aria-hidden
        />
      </div>

      <aside
        id="workspace-tools-panel"
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-foreground",
          useTranslucency
            ? desktopTranslucencyTintClass(useTranslucency)
            : (baseToneClassName ?? "bg-background"),
        )}
        aria-label={toolsCopy.panelAria}
      >
        {dockMode === "designMode" ? (
          <div className="flex shrink-0 items-end gap-0 border-b border-border/40 pt-1.5 pb-0 pl-1 pr-1">
            <div
              role="tablist"
              aria-label={toolsCopy.tabListAria}
              className="flex min-w-0 flex-1 items-end gap-0 overflow-x-auto"
            >
              {designTabsState.tabs.map((item) => {
                const meta = DESIGN_TAB_META[item.kind];
                const Icon = meta.icon;
                const selected = item.id === activeDesignTabId;
                const displayTitle = item.tabTitle;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "group/tab relative flex shrink-0 items-stretch rounded-t-md border border-transparent",
                      displayTitle ? "max-w-[9rem]" : "max-w-[3rem]",
                      selected
                        ? cn(
                            "border-border/40 text-foreground shadow-sm",
                            desktopTranslucencyWorkspaceTabSelectedClass(useTranslucency),
                          )
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      title={displayTitle ?? toolsCopy[meta.labelKey]}
                      className={`flex min-w-0 flex-1 items-center gap-1 rounded-t-md bg-transparent py-2 pl-2 pr-2 text-xs ${FONT_WEIGHT_NORMAL} outline-none`}
                      onClick={() => setActiveDesignTabId(item.id)}
                    >
                      <Icon
                        className="size-3.5 shrink-0 opacity-80"
                        aria-hidden
                        strokeWidth={1.75}
                      />
                      {displayTitle ? (
                        <span className="truncate">{protectBrandTokens(displayTitle)}</span>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div
            role="tablist"
            aria-label={toolsCopy.tabListAria}
            className="flex shrink-0 gap-0 border-b border-border/40 px-1 pt-1.5 pb-0"
          >
            {LEGACY_TAB_ITEMS.map((item) => {
              const Icon = item.icon;
              const selected = legacyTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className={cn(
                    `flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-t-md border border-transparent px-2 py-2 text-xs ${FONT_WEIGHT_NORMAL} transition-colors`,
                    instantHoverMotionClass,
                    selected
                      ? cn(
                          "border-border/40 text-foreground shadow-sm",
                          desktopTranslucencyWorkspaceTabSelectedClass(useTranslucency),
                        )
                      : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-foreground/10",
                  )}
                  onClick={() => setLegacyTab(item.id)}
                >
                  <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden strokeWidth={1.75} />
                  <span className="truncate">{toolsCopy[item.labelKey]}</span>
                </button>
              );
            })}
          </div>
        )}

        <div
          role="tabpanel"
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden text-xs",
            dockMode === "legacy" &&
              (legacyTab === "files" || legacyTab === "terminal"
                ? "p-0"
                : "p-3 text-muted-foreground"),
          )}
          aria-live="polite"
        >
          {dockMode === "designMode" && activeDesignTab
            ? renderDesignTabPanel(activeDesignTab)
            : renderLegacyTabPanel()}
        </div>
      </aside>
    </div>
  );
}
