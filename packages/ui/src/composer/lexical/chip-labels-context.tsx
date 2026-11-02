import { createContext, useContext, type ReactNode } from "react";

export type ComposerChipLabels = {
  planLabel: string;
  askLabel: string;
  debugLabel: string;
  loopLabel: string;
};

const DEFAULT_LABELS: ComposerChipLabels = {
  planLabel: "Plan",
  askLabel: "Ask",
  debugLabel: "Debug",
  loopLabel: "Loop",
};

const ComposerChipLabelsContext = createContext<ComposerChipLabels>(DEFAULT_LABELS);

export function ComposerChipLabelsProvider({
  labels,
  children,
}: {
  labels: Partial<ComposerChipLabels>;
  children: ReactNode;
}) {
  const value = { ...DEFAULT_LABELS, ...labels };
  return (
    <ComposerChipLabelsContext.Provider value={value}>
      {children}
    </ComposerChipLabelsContext.Provider>
  );
}

export function useComposerChipLabels(): ComposerChipLabels {
  return useContext(ComposerChipLabelsContext);
}
