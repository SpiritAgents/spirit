import { createContext, useContext, type ReactNode } from "react";

import { ChipShell, type ChipShellProps } from "./chips/chip-shell.js";
import type { QuoteChipOrigin } from "./message-quote-attachment.js";

/** Where a chip click navigates; the host decides resolvability and performs the navigation. */
export type ComposerChipNavigateTarget =
  | { kind: "skill"; alias: string }
  | { kind: "workspaceFile"; path: string; sourceTabId?: string; isPlan?: boolean }
  | {
      kind: "fileSnippet";
      filePath: string;
      lineStart: number;
      lineEnd: number;
      sourceTabId?: string;
    }
  | { kind: "sessionReference"; transcriptPath: string }
  | { kind: "element"; pageUrl: string; sourceTabId?: string }
  | { kind: "gitCommit"; sourceTabId?: string }
  | { kind: "terminalSnippet"; sourceTabId?: string }
  | { kind: "prDiff"; prUrl: string; sourceTabId?: string }
  | {
      kind: "messageQuote";
      quoteSessionPath?: string;
      quoteMessageId?: number;
      quoteOrigin?: QuoteChipOrigin;
    };

export type ComposerChipNavigateContextValue = {
  isNavigable: (target: ComposerChipNavigateTarget) => boolean;
  navigate: (target: ComposerChipNavigateTarget) => void;
};

/** Default: nothing navigates (previews, tests). The host app provides real resolution. */
export const ComposerChipNavigateContext = createContext<ComposerChipNavigateContextValue>({
  isNavigable: () => false,
  navigate: () => {},
});

export function useComposerChipNavigate(): ComposerChipNavigateContextValue {
  return useContext(ComposerChipNavigateContext);
}

/** Pointer travel budget for a chip click to still count as a navigation (not a drag). */
export const COMPOSER_CHIP_NAVIGATE_POINTER_THRESHOLD_PX = 4;

export function pointerMovedBeyondChipNavigateThreshold(
  start: { x: number; y: number },
  end: { x: number; y: number },
  thresholdPx = COMPOSER_CHIP_NAVIGATE_POINTER_THRESHOLD_PX,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy >= thresholdPx * thresholdPx;
}

export function NavigableChipShell({
  target,
  children,
  ...shellProps
}: {
  target: ComposerChipNavigateTarget;
  children: ReactNode;
} & Omit<ChipShellProps, "navigable" | "onNavigate" | "children">) {
  const { isNavigable, navigate } = useComposerChipNavigate();
  const navigable = isNavigable(target);
  return (
    <ChipShell
      {...shellProps}
      navigable={navigable}
      onNavigate={navigable ? () => navigate(target) : undefined}
    >
      {children}
    </ChipShell>
  );
}
