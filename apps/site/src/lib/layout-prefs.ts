import { THREAD_SIDEBAR_MIN_WIDTH_PX } from "@/lib/desktop-chrome";

const DEMO_WINDOW_LAYOUT_STORAGE_KEYS = [
  "spirit-desktop-session-sidebar-width-px",
  "spirit-desktop-workspace-tools-width-px",
  "spirit-desktop-pr-changes-tree-width-px",
  "spirit-desktop-git-changes-pane-ratio",
  "spirit-desktop-pr-overview-pane-ratio",
  "spirit-desktop-workspace-sidebar-expanded-by-id",
  "spirit-desktop-sidebar-workspace-section-expanded",
  "spirit-desktop-sidebar-no-workspace-section-expanded",
] as const;

/** Remove legacy demo window layout keys from localStorage. */
export function clearDemoWindowLayoutPrefs(): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    for (const key of DEMO_WINDOW_LAYOUT_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function readThreadSidebarWidthPx(): number {
  return THREAD_SIDEBAR_MIN_WIDTH_PX;
}

export function writeThreadSidebarWidthPx(_widthPx: number): void {
  // Demo window layout is session-only; do not persist.
}

export const WORKSPACE_TOOLS_MIN_WIDTH_PX = 240;
export const WORKSPACE_TOOLS_DEFAULT_WIDTH_PX = WORKSPACE_TOOLS_MIN_WIDTH_PX;
const WORKSPACE_TOOLS_VIEWPORT_MAX_WIDTH_RATIO = 0.62;

/** Design mode: conversation 5, workspace tools (browser) 7. */
export const DESIGN_MODE_CONVERSATION_TOOLS_RATIO = {
  conversation: 5,
  tools: 7,
} as const;

export function computeDesignModeWorkspaceToolsWidthPx(contentRowWidthPx: number): number {
  const { conversation, tools } = DESIGN_MODE_CONVERSATION_TOOLS_RATIO;
  const total = conversation + tools;
  const preferred = Math.round(contentRowWidthPx * (tools / total));
  const maxForRow = Math.max(
    WORKSPACE_TOOLS_MIN_WIDTH_PX,
    contentRowWidthPx - WORKSPACE_TOOLS_MIN_WIDTH_PX,
  );
  return Math.min(maxForRow, Math.max(WORKSPACE_TOOLS_MIN_WIDTH_PX, preferred));
}

export function computeWorkspaceToolsMaxWidthPx(
  viewportWidthPx = typeof window !== "undefined" ? window.innerWidth : 1200,
): number {
  return Math.round(viewportWidthPx * WORKSPACE_TOOLS_VIEWPORT_MAX_WIDTH_RATIO);
}

export function readWorkspaceToolsWidthPx(
  _viewportWidthPx = typeof window !== "undefined" ? window.innerWidth : 1200,
): number {
  return WORKSPACE_TOOLS_DEFAULT_WIDTH_PX;
}

export function writeWorkspaceToolsWidthPx(_widthPx: number): void {
  // Demo window layout is session-only; do not persist.
}

export const PR_CHANGES_TREE_MIN_WIDTH_PX = 144;
export const PR_CHANGES_TREE_DEFAULT_WIDTH_PX = 208;
const PR_CHANGES_TREE_MAX_WIDTH_RATIO = 0.45;

export function computePrChangesTreeMaxWidthPx(containerWidthPx: number): number {
  return Math.round(containerWidthPx * PR_CHANGES_TREE_MAX_WIDTH_RATIO);
}

export function readPrChangesTreeWidthPx(_containerWidthPx?: number): number {
  return PR_CHANGES_TREE_DEFAULT_WIDTH_PX;
}

export function writePrChangesTreeWidthPx(_widthPx: number, _containerWidthPx?: number): void {
  // Demo window layout is session-only; do not persist.
}

export const GIT_CHANGES_DEFAULT_RATIO = 0.45;
const GIT_CHANGES_RATIO_LOOSE_MIN = 0.15;
const GIT_CHANGES_RATIO_LOOSE_MAX = 0.85;

export const GIT_CHANGES_MIN_PX = 88;
export const GIT_HISTORY_MIN_PX = 120;
export const GIT_HISTORY_HEADER_PX = 32;
export const GIT_SPLITTER_PX = 4;

function clampRatio(ratio: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, ratio));
}

export function computeGitChangesPaneRatioBounds(containerHeightPx: number): {
  min: number;
  max: number;
} {
  const min = GIT_CHANGES_MIN_PX / containerHeightPx;
  const max =
    (containerHeightPx - GIT_HISTORY_MIN_PX - GIT_HISTORY_HEADER_PX - GIT_SPLITTER_PX) /
    containerHeightPx;
  return { min, max };
}

export function clampGitChangesPaneRatio(ratio: number, containerHeightPx?: number): number {
  if (containerHeightPx && containerHeightPx > 0) {
    const { min, max } = computeGitChangesPaneRatioBounds(containerHeightPx);
    if (min <= max) {
      return clampRatio(ratio, min, max);
    }
  }
  return clampRatio(ratio, GIT_CHANGES_RATIO_LOOSE_MIN, GIT_CHANGES_RATIO_LOOSE_MAX);
}

export function readGitChangesPaneRatio(containerHeightPx?: number): number {
  return clampGitChangesPaneRatio(GIT_CHANGES_DEFAULT_RATIO, containerHeightPx);
}

export function writeGitChangesPaneRatio(_ratio: number, _containerHeightPx?: number): void {
  // Demo window layout is session-only; do not persist.
}

export const PR_OVERVIEW_DEFAULT_RATIO = 0.38;
const PR_OVERVIEW_RATIO_LOOSE_MIN = 0.15;
const PR_OVERVIEW_RATIO_LOOSE_MAX = 0.75;

export const PR_OVERVIEW_MIN_PX = 96;
export const PR_TABS_SECTION_MIN_PX = 180;
export const PR_OVERVIEW_SPLITTER_PX = 4;

export function computePrOverviewPaneRatioBounds(containerHeightPx: number): {
  min: number;
  max: number;
} {
  const min = PR_OVERVIEW_MIN_PX / containerHeightPx;
  const max =
    (containerHeightPx - PR_TABS_SECTION_MIN_PX - PR_OVERVIEW_SPLITTER_PX) / containerHeightPx;
  return { min, max };
}

export function clampPrOverviewPaneRatio(ratio: number, containerHeightPx?: number): number {
  if (containerHeightPx && containerHeightPx > 0) {
    const { min, max } = computePrOverviewPaneRatioBounds(containerHeightPx);
    if (min <= max) {
      return clampRatio(ratio, min, max);
    }
  }
  return clampRatio(ratio, PR_OVERVIEW_RATIO_LOOSE_MIN, PR_OVERVIEW_RATIO_LOOSE_MAX);
}

export function readPrOverviewPaneRatio(containerHeightPx?: number): number {
  return clampPrOverviewPaneRatio(PR_OVERVIEW_DEFAULT_RATIO, containerHeightPx);
}

export function writePrOverviewPaneRatio(_ratio: number, _containerHeightPx?: number): void {
  // Demo window layout is session-only; do not persist.
}

/** `false` = collapsed; missing or `true` = expanded (aligned with the ThreadSidebar AnimatedCollapse). */
export type WorkspaceSidebarExpandedById = Record<string, boolean>;

export function readWorkspaceSidebarExpandedById(): WorkspaceSidebarExpandedById {
  return {};
}

export function writeWorkspaceSidebarExpandedById(_value: WorkspaceSidebarExpandedById): void {
  // Demo window layout is session-only; do not persist.
}

export function readSidebarWorkspaceSectionExpanded(): boolean {
  return true;
}

export function writeSidebarWorkspaceSectionExpanded(_expanded: boolean): void {
  // Demo window layout is session-only; do not persist.
}

export function readSidebarNoWorkspaceSectionExpanded(): boolean {
  return true;
}

export function writeSidebarNoWorkspaceSectionExpanded(_expanded: boolean): void {
  // Demo window layout is session-only; do not persist.
}
