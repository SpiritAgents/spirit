/** @vitest-environment jsdom — shared UI providers wrapper for component tests. */
import type { ReactNode } from "react";

import {
  ModelPickerLabelsProvider,
  ModelPickerRuntimeProvider,
} from "@spiritagent/ui/model-picker";
import { ComposerLabelsProvider } from "@spiritagent/ui/composer";
import { desktopModelPickerRuntime } from "@/lib/model-picker-runtime";
import i18n from "@/lib/i18n";
import { desktopComposerLabels, desktopModelPickerLabels } from "@/lib/ui-labels";

/** Wraps components under test with the ui package's label/runtime providers. */
export function UiTestProviders({ children }: { children: ReactNode }) {
  return (
    <ModelPickerRuntimeProvider value={desktopModelPickerRuntime}>
      <ModelPickerLabelsProvider value={desktopModelPickerLabels(i18n.t)}>
        <ComposerLabelsProvider value={desktopComposerLabels(i18n.t)}>
          {children}
        </ComposerLabelsProvider>
      </ModelPickerLabelsProvider>
    </ModelPickerRuntimeProvider>
  );
}
