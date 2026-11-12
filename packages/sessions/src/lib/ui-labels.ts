import type { TFunction } from "i18next";

import { buildComposerLabels } from "@spiritagent/ui/composer";
import { buildModelPickerLabels } from "@spiritagent/ui/model-picker";

/** Desktop adapters of the shared ui label builders (i18next's TFunction satisfies LabelTranslator). */
export function desktopComposerLabels(t: TFunction) {
  return buildComposerLabels(t);
}

export function desktopModelPickerLabels(t: TFunction) {
  return buildModelPickerLabels(t);
}
