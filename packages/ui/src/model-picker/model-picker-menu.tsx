import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  ModelPickerInspectorPanel,
  modelPickerInspectorNeedsWideLayout,
} from "./model-picker-inspector-panel.js";
import { FilteredOverlayMenu, FilteredOverlayMenuTrigger } from "../filtered-overlay-menu.js";
import { DropdownMenuItem } from "../dropdown-menu.js";
import { Kbd, KbdGroup } from "../kbd.js";
import {
  Tooltip,
  TooltipContent,
  TooltipItem,
  TooltipTrigger,
  useOptionalTooltipStableActions,
} from "../tooltip.js";
import {
  DESKTOP_GHOST_MENU_TRIGGER,
  DESKTOP_OVERLAY_LIST_GROUP_LABEL,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
} from "../chrome.js";
import { isMacNavigatorPlatform, modSlashShortcutKbdKeys } from "../platform.js";
import {
  buildModelCatalogDetailMap,
  buildModelCatalogDisplayTitleMap,
  modelCatalogScopeEntryKey,
  modelDisplayTitleFromMap,
} from "./model-catalog-detail.js";
import { ModelPickerLabelsProvider, useModelPickerLabels } from "./labels.js";
import { ModelPickerRuntimeProvider, useModelPickerRuntime } from "./runtime.js";
import {
  effectiveDeclaredServiceTier,
  modelEffortTriggerLabel,
  selectedModelEffort,
  serviceTierTriggerSuffixTier,
  showsReasoningModeControl,
  effectiveReasoningMode,
} from "./model-picker-controls.js";
import { groupModelsForPicker } from "./model-picker-groups.js";
import { DESKTOP_MENU_TRIGGER_TEXT_CLASS } from "../typography.js";
import type {
  ModelEffortSelection,
  ModelReasoningMode,
  ModelServiceTier,
  ModelPickerModelProfile,
  ModelRef,
  ModelCatalogEntry,
  ModelCatalogHint,
  ProviderEntryMeta,
  ProviderPickerPresetRow,
} from "./types.js";
import type { ModelPickerRuntime } from "./runtime.js";
import { modelRefKey, modelRefsEqual } from "./model-ref.js";
import { cn } from "../cn.js";

type ModelPickerItem = ModelPickerModelProfile;

function modelPickerItemRef(model: ModelPickerItem): ModelRef {
  return model.ref;
}

function resolveModelPickerDetailTooltipWidthClass(
  activeItem: unknown,
  models: readonly ModelPickerItem[],
  catalogDetailByModelName: Map<string, ModelCatalogEntry>,
): string {
  const hoveredModel = activeItem as ModelPickerItem | null;
  if (!hoveredModel) {
    return "w-max";
  }
  const model =
    models.find((entry) =>
      modelRefsEqual(modelPickerItemRef(entry), modelPickerItemRef(hoveredModel)),
    ) ?? hoveredModel;
  const catalogEntry = catalogDetailByModelName.get(modelCatalogScopeEntryKey(model));
  return modelPickerInspectorNeedsWideLayout(model, catalogEntry) ? "w-80" : "w-max";
}

const MODEL_PICKER_TOOLTIP_SHOW_DELAY_MS = 300;

function ModelPickerShortcutKbd() {
  const keys = modSlashShortcutKbdKeys();

  return (
    <KbdGroup>
      {isMacNavigatorPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>/</Kbd>
        </>
      )}
    </KbdGroup>
  );
}

const ModelPickerRow = memo(function ModelPickerRow({
  model,
  displayTitle,
  isActive,
  onSelectModel,
}: {
  model: ModelPickerItem;
  displayTitle: string;
  isActive: boolean;
  onSelectModel: (ref: ModelRef) => void;
}) {
  const modelRef = modelPickerItemRef(model);
  return (
    <TooltipItem item={model}>
      <DropdownMenuItem
        className={cn(isActive && DESKTOP_OVERLAY_LIST_ITEM_SELECTED)}
        onSelect={() => {
          onSelectModel(modelRef);
        }}
      >
        <span className={cn(DESKTOP_OVERLAY_LIST_ITEM_PRIMARY, "min-w-0 truncate")}>
          {displayTitle}
        </span>
      </DropdownMenuItem>
    </TooltipItem>
  );
});

/** Optional global-shortcut wiring (Desktop's Cmd+/ focus bridge); absent = no registration. */
export type ModelPickerShortcutTarget = {
  register(handlers: { open(): void; getRoot(): HTMLElement | null }): string;
  unregister(id: string): void;
  notifyFocused(id: string): void;
};

export type ModelPickerMenuProps = {
  models: readonly ModelPickerModelProfile[];
  catalogHints?: readonly ModelCatalogHint[];
  providers?: readonly ProviderEntryMeta[];
  /** Preset picker rows from the host snapshot: group order + fallback labels in the menu. */
  providerPresets?: readonly ProviderPickerPresetRow[];
  activeModelRef: ModelRef;
  activeReasoningEffort?: ModelEffortSelection;
  /** Last upstream-measured conversation input tokens; absent means unknown. */
  lastInputTokens?: number;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  onModelSelect(ref: ModelRef): void;
  onModelReasoningEffortSelect?(ref: ModelRef, reasoningEffort: ModelEffortSelection): void;
  onModelReasoningModeSelect?(ref: ModelRef, reasoningMode: ModelReasoningMode): void;
  onModelThinkingEnabledSelect?(ref: ModelRef, enabled: boolean): void | Promise<boolean>;
  onModelServiceTierSelect?(
    ref: ModelRef,
    serviceTier: ModelServiceTier | undefined,
  ): void | Promise<boolean>;
  shortcutTarget?: ModelPickerShortcutTarget;
  triggerClassName?: string;
  menuContentClassName?: string;
};

export function ModelPickerMenu({
  models,
  catalogHints,
  providers,
  providerPresets,
  activeModelRef,
  activeReasoningEffort,
  lastInputTokens,
  disabled,
  open: openProp,
  onOpenChange,
  onModelSelect,
  onModelReasoningEffortSelect,
  onModelReasoningModeSelect,
  onModelThinkingEnabledSelect,
  onModelServiceTierSelect,
  shortcutTarget,
  triggerClassName,
  menuContentClassName,
}: ModelPickerMenuProps) {
  const labels = useModelPickerLabels();
  const runtime = useModelPickerRuntime();
  const tooltipActions = useOptionalTooltipStableActions();
  const [internalOpen, setInternalOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const registrationIdRef = useRef<string | null>(null);
  const reactId = useId();

  const isControlled = openProp !== undefined;
  const modelMenuOpen = isControlled ? openProp : internalOpen;
  const suppressTooltip = modelMenuOpen || disabled;
  const setModelMenuOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const activeModelProfile = models.find((model) =>
    modelRefsEqual(modelPickerItemRef(model), activeModelRef),
  );
  const displayTitleByModelName = useMemo(
    () => buildModelCatalogDisplayTitleMap(runtime, models, catalogHints),
    [catalogHints, models, runtime],
  );
  const catalogDetailByModelName = useMemo(
    () => buildModelCatalogDetailMap(models, catalogHints),
    [catalogHints, models],
  );
  const modelGroups = useMemo(
    () => groupModelsForPicker(models, catalogHints, providers, providerPresets),
    [catalogHints, models, providers, providerPresets],
  );
  const filteredModelGroups = useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    if (!query) {
      return modelGroups;
    }
    return modelGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((model) => {
          const title = modelDisplayTitleFromMap(model, displayTitleByModelName).toLowerCase();
          return title.includes(query) || model.name.toLowerCase().includes(query);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [displayTitleByModelName, modelFilter, modelGroups]);

  const handleModelFilterChange = useCallback(
    (next: string) => {
      if (next !== modelFilter) {
        flushSync(() => {
          tooltipActions?.dismissActiveItem();
        });
      }
      setModelFilter(next);
    },
    [modelFilter, tooltipActions],
  );

  const dismissOpenListTooltip = useCallback(() => {
    flushSync(() => {
      tooltipActions?.dismissActiveItem();
    });
  }, [tooltipActions]);

  const handleSelectModel = useCallback(
    (ref: ModelRef) => {
      dismissOpenListTooltip();
      onModelSelect(ref);
      setModelFilter("");
      setModelMenuOpen(false);
    },
    [dismissOpenListTooltip, onModelSelect, setModelMenuOpen],
  );

  useEffect(() => {
    if (!shortcutTarget) {
      return;
    }
    const id = shortcutTarget.register({
      open: () => setModelMenuOpen(true),
      getRoot: () => rootRef.current,
    });
    registrationIdRef.current = id;
    return () => {
      shortcutTarget.unregister(id);
      registrationIdRef.current = null;
    };
  }, [setModelMenuOpen, shortcutTarget]);

  const handleTriggerFocus = useCallback(() => {
    const id = registrationIdRef.current;
    if (id) {
      shortcutTarget?.notifyFocused(id);
    }
  }, [shortcutTarget]);

  if (models.length === 0) {
    return (
      <span
        data-composer-chrome-static=""
        className="cursor-default px-1 text-xs text-muted-foreground"
      >
        {labels.noModelsAvailable}
      </span>
    );
  }

  return (
    <div ref={rootRef} data-model-picker-root data-model-picker-id={reactId} className="min-w-0">
      <FilteredOverlayMenu
        variant="filtered-list"
        open={modelMenuOpen}
        onOpenChange={(open) => {
          if (!open) {
            dismissOpenListTooltip();
          }
          setModelMenuOpen(open);
          if (!open) {
            setModelFilter("");
          }
        }}
        filterValue={modelFilter}
        onFilterChange={handleModelFilterChange}
        filterPlaceholder={labels.searchModels}
        trigger={
          <Tooltip
            open={suppressTooltip ? false : undefined}
            delayDuration={MODEL_PICKER_TOOLTIP_SHOW_DELAY_MS}
            disableHoverableContent
          >
            <TooltipTrigger asChild>
              <FilteredOverlayMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={labels.selectModel}
                  disabled={disabled}
                  onFocus={handleTriggerFocus}
                  className={cn(
                    DESKTOP_GHOST_MENU_TRIGGER,
                    DESKTOP_MENU_TRIGGER_TEXT_CLASS,
                    "text-muted-foreground",
                    triggerClassName,
                  )}
                >
                  {activeModelProfile ? (
                    <ModelPickerTriggerLabel
                      name={modelDisplayTitleFromMap(activeModelProfile, displayTitleByModelName)}
                      reasoningEffort={
                        activeReasoningEffort ?? selectedModelEffort(activeModelProfile)
                      }
                      model={activeModelProfile}
                      lastInputTokens={lastInputTokens}
                      catalogEntry={catalogDetailByModelName.get(
                        modelCatalogScopeEntryKey(activeModelProfile),
                      )}
                      runtime={runtime}
                    />
                  ) : (
                    <span className="min-w-0 truncate">{modelRefKey(activeModelRef)}</span>
                  )}
                  <ChevronDown
                    className="size-3 shrink-0 text-muted-foreground/80"
                    aria-hidden
                    strokeWidth={1.75}
                  />
                </button>
              </FilteredOverlayMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {labels.selectModel} <ModelPickerShortcutKbd />
            </TooltipContent>
          </Tooltip>
        }
      >
        {filteredModelGroups.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">{labels.noMatches}</p>
        ) : null}
        <Tooltip<ModelPickerItem>
          getItemId={(model) => modelRefKey(modelPickerItemRef(model))}
          delayDuration={0}
        >
          <Tooltip.Zone>
            {filteredModelGroups.length === 0
              ? null
              : filteredModelGroups.map((group) => (
                  <div key={group.providerId} className="mb-2 last:mb-0">
                    <div className={DESKTOP_OVERLAY_LIST_GROUP_LABEL}>
                      {group.customLabel ??
                        labels.providerGroupLabel(group.labelKey, group.fallbackLabel)}
                    </div>
                    {group.items.map((model) => {
                      const displayTitle = modelDisplayTitleFromMap(model, displayTitleByModelName);
                      const modelRef = modelPickerItemRef(model);
                      return (
                        <ModelPickerRow
                          key={`${group.providerId}:${modelRefKey(modelRef)}`}
                          model={model}
                          displayTitle={displayTitle}
                          isActive={modelRefsEqual(
                            activeModelProfile ? modelPickerItemRef(activeModelProfile) : undefined,
                            modelRef,
                          )}
                          onSelectModel={handleSelectModel}
                        />
                      );
                    })}
                  </div>
                ))}
          </Tooltip.Zone>
          <TooltipContent
            appearance="detail"
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={16}
            className={cn("z-[200] max-w-[min(20rem,calc(100vw-2rem))] p-3", menuContentClassName)}
            resolveClassName={(activeItem) =>
              resolveModelPickerDetailTooltipWidthClass(
                activeItem,
                models,
                catalogDetailByModelName,
              )
            }
          >
            {(activeItem) => {
              const hoveredModel = activeItem as ModelPickerItem | null;
              if (!hoveredModel) {
                return null;
              }
              const model =
                models.find((entry) =>
                  modelRefsEqual(modelPickerItemRef(entry), modelPickerItemRef(hoveredModel)),
                ) ?? hoveredModel;
              const group = filteredModelGroups.find((entry) =>
                entry.items.some((item) =>
                  modelRefsEqual(modelPickerItemRef(item), modelPickerItemRef(model)),
                ),
              );
              const providerLabel =
                group?.customLabel ??
                (group
                  ? labels.providerGroupLabel(group.labelKey, group.fallbackLabel)
                  : model.providerId);
              const catalogEntry = catalogDetailByModelName.get(modelCatalogScopeEntryKey(model));

              // The shared tooltip host renders outside this picker's provider subtree.
              return (
                <ModelPickerRuntimeProvider value={runtime}>
                  <ModelPickerLabelsProvider value={labels}>
                    <ModelPickerInspectorPanel
                      model={model}
                      catalogEntry={catalogEntry}
                      lastInputTokens={lastInputTokens}
                      providerLabel={providerLabel}
                      onEffortChange={(modelRef, effort) => {
                        onModelReasoningEffortSelect?.(modelRef, effort);
                        onModelSelect(modelRef);
                      }}
                      onReasoningModeChange={(modelRef, mode) => {
                        onModelReasoningModeSelect?.(modelRef, mode);
                        onModelSelect(modelRef);
                      }}
                      onThinkingEnabledChange={onModelThinkingEnabledSelect}
                      onServiceTierChange={onModelServiceTierSelect}
                    />
                  </ModelPickerLabelsProvider>
                </ModelPickerRuntimeProvider>
              );
            }}
          </TooltipContent>
        </Tooltip>
      </FilteredOverlayMenu>
    </div>
  );
}

function ModelPickerTriggerLabel({
  name,
  reasoningEffort,
  model,
  catalogEntry,
  lastInputTokens,
  runtime,
}: {
  name: string;
  reasoningEffort?: ModelEffortSelection;
  model: ModelPickerModelProfile;
  catalogEntry?: ModelCatalogEntry;
  lastInputTokens?: number;
  runtime: ModelPickerRuntime;
}) {
  const labels = useModelPickerLabels();
  const suffixTier = serviceTierTriggerSuffixTier(
    effectiveDeclaredServiceTier(runtime, model, catalogEntry, lastInputTokens),
  );

  const secondaryLabels: string[] = [];
  if (showsReasoningModeControl(model) && effectiveReasoningMode(model) === "pro") {
    secondaryLabels.push(labels.reasoningModePro);
  }

  const effortLabel = modelEffortTriggerLabel(model, reasoningEffort);
  if (effortLabel !== undefined) {
    secondaryLabels.push(effortLabel);
  }
  if (suffixTier !== undefined) {
    secondaryLabels.push(labels.serviceTierValue(suffixTier));
  }

  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
      <span className="min-w-0 truncate">{name}</span>
      {secondaryLabels.map((label) => (
        <span key={label} className="shrink-0 text-foreground-subtle">
          {label}
        </span>
      ))}
    </span>
  );
}
