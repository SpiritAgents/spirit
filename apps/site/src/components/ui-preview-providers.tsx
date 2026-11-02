import { useMemo, type ReactNode } from "react";

import { buildComposerLabels, ComposerLabelsProvider } from "@spiritagent/ui/composer";
import {
  buildModelPickerLabels,
  ModelPickerLabelsProvider,
  ModelPickerRuntimeProvider,
} from "@spiritagent/ui/model-picker";
import { useTranslation } from "@/lib/desktop-preview-i18n";
import { previewModelPickerRuntime } from "@/lib/ui-preview-runtime";

/** The ui package's composer/picker providers wired to the site preview's i18n + stub runtime. */
export function UiPreviewProviders({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const composerLabels = useMemo(() => buildComposerLabels(t), [t]);
  const pickerLabels = useMemo(() => buildModelPickerLabels(t), [t]);
  return (
    <ModelPickerRuntimeProvider value={previewModelPickerRuntime}>
      <ModelPickerLabelsProvider value={pickerLabels}>
        <ComposerLabelsProvider value={composerLabels}>{children}</ComposerLabelsProvider>
      </ModelPickerLabelsProvider>
    </ModelPickerRuntimeProvider>
  );
}
