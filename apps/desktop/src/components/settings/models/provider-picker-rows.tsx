import { ProviderIcon } from "@/components/provider-icon";
import { CUSTOM_PROVIDER_PRESET_ID } from "@spiritagent/agent-core/provider-presets";

import {
  providerLabelKey,
  providerLabelMetadata,
  type ProviderPickerPresetRow,
} from "@/lib/model-picker-groups";

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

/** Picker rows: the snapshot's preset rows (manifest order), with the custom connection last. */
export function localizedProviderRows(
  t: ProviderLabelTranslate,
  presets: readonly ProviderPickerPresetRow[],
): LocalizedProviderRow[] {
  return [
    ...presets.map((preset) => ({
      id: preset.id,
      label: providerPickerLabel(t, preset.id, presets),
    })),
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
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm hover:bg-overlay-hover focus-visible:bg-overlay-hover focus-visible:outline-none"
      onClick={() => onSelect(row.id)}
    >
      <ProviderIcon providerId={row.id} />
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
    </button>
  );
}
