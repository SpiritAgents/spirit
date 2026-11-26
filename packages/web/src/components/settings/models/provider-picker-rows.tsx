import { Sparkles } from "lucide-react";
import { CUSTOM_PROVIDER_PRESET_ID } from "@spiritagent/agent-core/provider-presets";

import {
  providerLabelKey,
  providerLabelMetadata,
  type ProviderPickerPresetRow,
} from "@spiritagent/ui/model-picker";
import { RovingFocusItem } from "@/components/ui/roving-focus-group";

/** Minimal signature compatible with react-i18next `t`, avoiding a direct dependency on the TFunction generic. */
export type ProviderLabelTranslate = (key: string, options?: { defaultValue?: string }) => string;

export type LocalizedProviderRow = {
  id: string;
  label: string;
};

export function providerPickerLabel(
  t: ProviderLabelTranslate,
  providerId: string,
  presets: readonly ProviderPickerPresetRow[],
): string {
  const { labelKey, fallbackLabel } = providerLabelMetadata(providerId, presets);
  return String(t(labelKey, { defaultValue: fallbackLabel }));
}

/** Picker rows sorted by localized display name, independently of manifest order; custom stays last. */
export function localizedProviderRows(
  t: ProviderLabelTranslate,
  presets: readonly ProviderPickerPresetRow[],
): LocalizedProviderRow[] {
  return [
    ...presets
      .map((preset) => ({
        id: preset.id,
        label: providerPickerLabel(t, preset.id, presets),
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    {
      id: CUSTOM_PROVIDER_PRESET_ID,
      label: String(t(providerLabelKey(CUSTOM_PROVIDER_PRESET_ID), { defaultValue: "Custom" })),
    },
  ];
}

/** Live-filters by localized display name (case-insensitive); an empty query returns everything. */
export function filterProviderRows(
  rows: LocalizedProviderRow[],
  query: string,
): LocalizedProviderRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return rows;
  }
  return rows.filter((row) => row.label.toLowerCase().includes(normalized));
}

/** Provider row button shared by the settings-page picker and the OOBE list. */
export function ProviderPickerRowButton({
  row,
  onSelect,
}: {
  row: LocalizedProviderRow;
  onSelect: (id: string) => void;
}) {
  return (
    <RovingFocusItem asChild tabStopId={row.id}>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm outline-none hover:bg-overlay-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        onClick={() => onSelect(row.id)}
      >
        <Sparkles
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
        />
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
      </button>
    </RovingFocusItem>
  );
}
