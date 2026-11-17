import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
export const PR_CHANGES_TREE_MIN_WIDTH_PX = 144;
export const PR_CHANGES_TREE_DEFAULT_WIDTH_PX = 208;
export const PR_OVERVIEW_DEFAULT_RATIO = 0.38;
export const PR_OVERVIEW_MIN_PX = 96;
export const PR_TABS_SECTION_MIN_PX = 180;
export const PR_OVERVIEW_SPLITTER_PX = 4;
export function computePrChangesTreeMaxWidthPx(width: number) {
  return Math.round(width * 0.45);
}
export function clampPrOverviewPaneRatio(ratio: number, height?: number) {
  const min = height && height > 0 ? PR_OVERVIEW_MIN_PX / height : 0.15;
  const max =
    height && height > 0
      ? (height - PR_TABS_SECTION_MIN_PX - PR_OVERVIEW_SPLITTER_PX) / height
      : 0.75;
  return Math.min(max >= min ? max : 0.75, Math.max(max >= min ? min : 0.15, ratio));
}
export function computePrOverviewPaneRatioBounds(height: number) {
  return {
    min: PR_OVERVIEW_MIN_PX / height,
    max: (height - PR_TABS_SECTION_MIN_PX - PR_OVERVIEW_SPLITTER_PX) / height,
  };
}
const clampWidth = (width: number, container = 1200) =>
  Math.min(
    computePrChangesTreeMaxWidthPx(container),
    Math.max(PR_CHANGES_TREE_MIN_WIDTH_PX, Math.round(width)),
  );
type Layout = Record<string, unknown>;
type Preferences = {
  readPrOverviewPaneRatio(height?: number): number;
  writePrOverviewPaneRatio(ratio: number, height?: number): void;
  readPrChangesTreeWidthPx(container?: number): number;
  writePrChangesTreeWidthPx(width: number, container?: number): void;
};
const LayoutContext = createContext<Preferences | null>(null);
export function GitHubLayoutProvider({
  initial,
  save,
  onError,
  children,
}: {
  initial: Layout;
  save(patch: Record<string, number>): Promise<unknown>;
  onError(error: unknown): void;
  children: ReactNode;
}) {
  const [layout, setLayout] = useState(initial);
  const update = useCallback(
    (patch: Record<string, number>) => {
      setLayout((previous) => ({ ...previous, ...patch }));
      void save(patch).catch(onError);
    },
    [save, onError],
  );
  const value = useMemo<Preferences>(
    () => ({
      readPrOverviewPaneRatio: (height) =>
        clampPrOverviewPaneRatio(
          typeof layout["pr-overview-ratio"] === "number"
            ? layout["pr-overview-ratio"]
            : PR_OVERVIEW_DEFAULT_RATIO,
          height,
        ),
      writePrOverviewPaneRatio: (ratio, height) =>
        update({ "pr-overview-ratio": clampPrOverviewPaneRatio(ratio, height) }),
      readPrChangesTreeWidthPx: (container) =>
        clampWidth(
          typeof layout["pr-files-width"] === "number"
            ? layout["pr-files-width"]
            : PR_CHANGES_TREE_DEFAULT_WIDTH_PX,
          container,
        ),
      writePrChangesTreeWidthPx: (width, container) =>
        update({ "pr-files-width": clampWidth(width, container) }),
    }),
    [layout, update],
  );
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}
export function useGitHubLayoutPreferences() {
  const value = useContext(LayoutContext);
  if (!value) throw new Error("GitHub layout preferences are unavailable.");
  return value;
}
