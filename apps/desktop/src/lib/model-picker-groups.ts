import { listProviderPresets } from "@spiritagent/agent-core/provider-presets";

import type {
  DesktopModelCatalogHint,
  DesktopProviderConfigEntry,
  ModelProfileSnapshot,
} from "@/types";

/** Picker group ordering: the preset manifest array order; unknown (custom) ids sort last. */
const PROVIDER_ORDER: readonly string[] = listProviderPresets().map((preset) => preset.id);

/** The i18n key for a preset id (`providers.<camelCaseId>`), e.g. `kimi-code` → `providers.kimiCode`. */
export function providerLabelKey(providerId: string): string {
  return `providers.${providerId.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase())}`;
}

export function providerLabelMetadata(providerId: string): {
  labelKey: string;
  fallbackLabel: string;
} {
  const preset = listProviderPresets().find((item) => item.id === providerId);
  return { labelKey: providerLabelKey(providerId), fallbackLabel: preset?.label ?? providerId };
}

export type ModelPickerGroup = {
  providerId: string;
  labelKey: string;
  fallbackLabel: string;
  customLabel?: string;
  items: ModelProfileSnapshot[];
};

/**
 * Main UI model dropdown: group by provider entry (`providers[].id`); within a group, the order
 * preferentially follows the upstream list order from `modelCatalogHints`.
 */
export function groupModelsForPicker(
  models: ModelProfileSnapshot[],
  catalogHints: DesktopModelCatalogHint[] | undefined,
  providers?: readonly DesktopProviderConfigEntry[],
): ModelPickerGroup[] {
  const providerMeta = new Map((providers ?? []).map((entry) => [entry.id, entry] as const));
  const buckets = new Map<string, ModelProfileSnapshot[]>();
  for (const model of models) {
    const providerId = model.providerId || model.ref.providerId;
    const list = buckets.get(providerId) ?? [];
    list.push(model);
    buckets.set(providerId, list);
  }

  const keys = [...buckets.keys()].sort((leftId, rightId) => {
    const leftIndex = PROVIDER_ORDER.indexOf(leftId);
    const rightIndex = PROVIDER_ORDER.indexOf(rightId);
    if (leftIndex !== rightIndex) {
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    }
    const leftLabel = providerMeta.get(leftId)?.label?.trim() ?? leftId;
    const rightLabel = providerMeta.get(rightId)?.label?.trim() ?? rightId;
    return leftLabel.localeCompare(rightLabel);
  });

  return keys.map((providerId) => {
    const meta = providerMeta.get(providerId);
    const items = (buckets.get(providerId) ?? []).slice().sort((a, b) => {
      const orderA = catalogOrderIndex(a.name, providerId, catalogHints);
      const orderB = catalogOrderIndex(b.name, providerId, catalogHints);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.name.localeCompare(b.name);
    });
    return {
      providerId,
      customLabel: meta?.label?.trim() || undefined,
      ...providerLabelMetadata(providerId),
      items,
    };
  });
}

function catalogOrderIndex(
  name: string,
  providerId: string,
  hints: DesktopModelCatalogHint[] | undefined,
): number {
  const hint = hints?.find((entry) => entry.providerId === providerId);
  if (!hint) {
    return 10_000;
  }
  const idx = hint.modelIds.indexOf(name);
  return idx === -1 ? 10_000 + 1 : idx;
}
