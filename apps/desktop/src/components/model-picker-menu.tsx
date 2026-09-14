import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

import {
  ModelPickerInspectorPanel,
  modelPickerInspectorNeedsWideLayout,
} from "@/components/model-picker-inspector-panel";
import {
  FilteredOverlayMenu,
  FilteredOverlayMenuTrigger,
} from "@/components/ui/filtered-overlay-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipItem,
  TooltipTrigger,
  useOptionalTooltipStableActions,
} from "@/components/ui/tooltip";
import {
  DESKTOP_GHOST_MENU_TRIGGER,
  DESKTOP_OVERLAY_LIST_GROUP_LABEL,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
} from "@/lib/desktop-chrome";
import { isMacDesktopPlatform, modSlashShortcutKbdKeys } from "@/lib/desktop-shell";
import {
  notifyModelPickerFocused,
  registerModelPicker,
  unregisterModelPicker,
} from "@/lib/model-picker-shortcut-bridge";
import {
  buildModelCatalogDetailMap,
  buildModelCatalogDisplayTitleMap,
  modelCatalogScopeEntryKey,
  modelDisplayTitleFromMap,
} from "@/lib/model-catalog-detail";
import { toolCardSecondaryTextClass } from "@/lib/file-tool-lsp-diagnostics-display";
import {
  modelReasoningEffortLabel,
  modelSupportsReasoningModeControl,
  resolveModelReasoningMode,
} from "@spiritagent/agent-core/reasoning-effort";
import {
  modelSupportsThinkingSwitch,
  resolveModelThinkingEnabled,
} from "@spiritagent/agent-core/model-thinking-controls";
import { groupModelsForPicker } from "@/lib/model-picker-groups";
import { DESKTOP_MENU_TRIGGER_TEXT_CLASS } from "@/lib/desktop-typography";
import type {
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  DesktopSnapshot,
  ModelProfileSnapshot,
  ModelRef,
  PreviewModelCatalogEntry,
} from "@/types";
import { modelRefKey, modelRefsEqual } from "@spiritagent/host-internal/config-v2";
import { cn } from "@/lib/utils";

type ModelPickerItem = DesktopSnapshot["config"]["models"][number];

function modelPickerItemRef(model: ModelPickerItem): ModelRef {
  return model.ref ?? { groupId: model.groupId ?? "", name: model.name };
}

function resolveModelPickerDetailTooltipWidthClass(
  activeItem: unknown,
  models: ModelPickerItem[],
  catalogDetailByModelName: Map<string, PreviewModelCatalogEntry>,
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
      {isMacDesktopPlatform() ? (
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

export type ModelPickerMenuProps = {
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  providerGroups?: DesktopSnapshot["config"]["providerGroups"];
  activeModelRef: ModelRef;
  activeReasoningEffort?: DesktopModelReasoningEffort;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  onModelSelect(ref: ModelRef): void;
  onModelReasoningEffortSelect?(ref: ModelRef, reasoningEffort: DesktopModelReasoningEffort): void;
  onModelReasoningModeSelect?(ref: ModelRef, reasoningMode: DesktopModelReasoningMode): void;
  onModelThinkingEnabledSelect?(ref: ModelRef, enabled: boolean): void | Promise<boolean>;
  triggerClassName?: string;
  menuContentClassName?: string;
};

export function ModelPickerMenu({
  models,
  catalogHints,
  providerGroups,
  activeModelRef,
  activeReasoningEffort,
  disabled,
  open: openProp,
  onOpenChange,
  onModelSelect,
  onModelReasoningEffortSelect,
  onModelReasoningModeSelect,
  onModelThinkingEnabledSelect,
  triggerClassName,
  menuContentClassName,
}: ModelPickerMenuProps) {
  const { t } = useTranslation();
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
    () => buildModelCatalogDisplayTitleMap(models, catalogHints),
    [catalogHints, models],
  );
  const catalogDetailByModelName = useMemo(
    () => buildModelCatalogDetailMap(models, catalogHints),
    [catalogHints, models],
  );
  const modelGroups = useMemo(
    () => groupModelsForPicker(models, catalogHints, providerGroups),
    [catalogHints, models, providerGroups],
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
    const id = registerModelPicker({
      open: () => setModelMenuOpen(true),
      getRoot: () => rootRef.current,
    });
    registrationIdRef.current = id;
    return () => {
      unregisterModelPicker(id);
      registrationIdRef.current = null;
    };
  }, [setModelMenuOpen]);

  const handleTriggerFocus = useCallback(() => {
    const id = registrationIdRef.current;
    if (id) {
      notifyModelPickerFocused(id);
    }
  }, []);

  if (models.length === 0) {
    return (
      <span
        data-composer-chrome-static=""
        className="cursor-default px-1 text-xs text-muted-foreground"
      >
        {t("app.noModelsAvailable")}
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
        filterPlaceholder={t("app.searchModels")}
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
                  aria-label={t("app.selectModel")}
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
                      reasoningEffort={activeReasoningEffort ?? activeModelProfile.reasoningEffort}
                      model={activeModelProfile}
                      catalogEntry={catalogDetailByModelName.get(
                        modelCatalogScopeEntryKey(activeModelProfile),
                      )}
                    />
                  ) : (
                    <span className="min-w-0 truncate">{modelRefKey(activeModelRef)}</span>
                  )}
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
                </button>
              </FilteredOverlayMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {t("app.selectModel")} <ModelPickerShortcutKbd />
            </TooltipContent>
          </Tooltip>
        }
      >
        {filteredModelGroups.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("app.noMatches")}
          </p>
        ) : null}
        <Tooltip<ModelPickerItem>
          getItemId={(model) => modelRefKey(modelPickerItemRef(model))}
          delayDuration={0}
        >
          <Tooltip.Zone>
            {filteredModelGroups.length === 0
              ? null
              : filteredModelGroups.map((group) => (
                  <div key={group.groupId} className="mb-2 last:mb-0">
                    <div className={DESKTOP_OVERLAY_LIST_GROUP_LABEL}>
                      {group.customLabel ??
                        t(group.labelKey, { defaultValue: group.fallbackLabel })}
                    </div>
                    {group.items.map((model) => {
                      const displayTitle = modelDisplayTitleFromMap(model, displayTitleByModelName);
                      const modelRef = modelPickerItemRef(model);
                      return (
                        <ModelPickerRow
                          key={`${group.groupId}:${modelRefKey(modelRef)}`}
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
                  ? t(group.labelKey, { defaultValue: group.fallbackLabel })
                  : (model.provider ?? model.name));
              const catalogEntry = catalogDetailByModelName.get(modelCatalogScopeEntryKey(model));

              return (
                <ModelPickerInspectorPanel
                  model={model}
                  catalogEntry={catalogEntry}
                  providerLabel={providerLabel}
                  onReasoningEffortChange={(modelRef, effort) => {
                    onModelReasoningEffortSelect?.(modelRef, effort);
                    onModelSelect(modelRef);
                  }}
                  onReasoningModeChange={(modelRef, mode) => {
                    onModelReasoningModeSelect?.(modelRef, mode);
                    onModelSelect(modelRef);
                  }}
                  onThinkingEnabledChange={(modelRef, enabled) => {
                    onModelThinkingEnabledSelect?.(modelRef, enabled);
                  }}
                />
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
}: {
  name: string;
  reasoningEffort: DesktopModelReasoningEffort;
  model: ModelProfileSnapshot;
  catalogEntry?: PreviewModelCatalogEntry;
}) {
  const { t } = useTranslation();
  const modelContext = {
    ...(model.provider ? { provider: model.provider } : {}),
    model: model.name,
    ...(model.supportedReasoningEfforts !== undefined
      ? { supportedEfforts: model.supportedReasoningEfforts }
      : {}),
    ...(model.transportKind ? { transportKind: model.transportKind } : {}),
    ...((model.supportsThinkingType ?? catalogEntry?.supportsThinkingType)
      ? { supportsThinkingType: model.supportsThinkingType ?? catalogEntry?.supportsThinkingType }
      : {}),
    ...((model.supportsThinkingSwitch ?? catalogEntry?.supportsThinkingSwitch) === true
      ? { supportsThinkingSwitch: true as const }
      : {}),
  };
  const supportsReasoningMode = modelSupportsReasoningModeControl(modelContext);
  const reasoningMode = resolveModelReasoningMode(model.reasoningMode, modelContext);
  const supportsThinkingSwitch = modelSupportsThinkingSwitch(modelContext);
  const thinkingEnabled = resolveModelThinkingEnabled(model.thinkingEnabled);

  const secondaryLabels: string[] = [];
  if (supportsReasoningMode && reasoningMode === "pro") {
    secondaryLabels.push(t("app.modelPickerReasoningModePro"));
  }

  const effortOrThinkingLabel =
    supportsThinkingSwitch && !thinkingEnabled
      ? t("app.modelPickerNotThinking")
      : modelReasoningEffortLabel(reasoningEffort);

  secondaryLabels.push(effortOrThinkingLabel);

  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
      <span className="min-w-0 truncate">{name}</span>
      {secondaryLabels.map((label) => (
        <span key={label} className={cn("shrink-0", toolCardSecondaryTextClass)}>
          {label}
        </span>
      ))}
    </span>
  );
}
