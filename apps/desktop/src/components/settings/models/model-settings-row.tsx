import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { TooltipItem, useTooltipTriggerProps } from "@/components/ui/tooltip";
import { modelSettingsRowAriaLabel } from "@/lib/model-catalog-detail";
import { modelCapabilityLabel } from "@/lib/model-capability-label";
import { cn } from "@/lib/utils";
import type { SettingsModelProfile } from "./model-defaults";
import { DESKTOP_LIST_ITEM_PRIMARY_CLASS } from "@/lib/desktop-typography";

export function ModelSettingsRowButton({
  model,
  displayTitle,
  isActive,
  isImageDefault,
  isSecondaryDefault,
  defaultActionLabel,
  disabled,
  isHighlighted = false,
  showNativeTitle = true,
  onPointerEnter,
  onDefaultAction,
}: {
  model: SettingsModelProfile;
  displayTitle: string;
  isActive: boolean;
  isImageDefault: boolean;
  isSecondaryDefault: boolean;
  defaultActionLabel: string;
  disabled: boolean;
  isHighlighted?: boolean;
  /** Suppresses the browser title when Tooltip details exist, so it does not cover the detail overlay. */
  showNativeTitle?: boolean;
  onPointerEnter?: () => void;
  onDefaultAction: () => void;
}) {
  const { t } = useTranslation();
  const rowAriaLabel = modelSettingsRowAriaLabel(defaultActionLabel, model.name, displayTitle);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full appearance-none flex-col gap-3 bg-transparent px-4 py-3 text-left outline-none enabled:cursor-pointer enabled:hover:bg-canvas-hover focus-visible:ring-2 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        isHighlighted && "bg-muted/30",
      )}
      disabled={disabled}
      title={showNativeTitle ? rowAriaLabel : undefined}
      aria-label={rowAriaLabel}
      onPointerEnter={onPointerEnter}
      onClick={onDefaultAction}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>{displayTitle}</span>
          {isActive ? (
            <Badge variant="secondary" className="text-muted-foreground">
              {t("settings.currentLanguageModel")}
            </Badge>
          ) : null}
          {isImageDefault ? (
            <Badge variant="secondary" className="text-muted-foreground">
              {t("settings.currentImageGen")}
            </Badge>
          ) : null}
          {isSecondaryDefault ? (
            <Badge variant="secondary" className="text-muted-foreground">
              {t("settings.currentSecondaryLanguageModel")}
            </Badge>
          ) : null}
          {model.capabilities?.map((capability) => (
            <Badge key={capability} variant="outline" className="text-muted-foreground">
              {modelCapabilityLabel(capability)}
            </Badge>
          ))}
        </div>
      </div>
    </button>
  );
}

export function ModelSettingsRowWithHover({
  model,
  displayTitle,
  isActive,
  isImageDefault,
  isSecondaryDefault,
  defaultActionLabel,
  disabled,
  onDefaultAction,
}: {
  model: SettingsModelProfile;
  displayTitle: string;
  isActive: boolean;
  isImageDefault: boolean;
  isSecondaryDefault: boolean;
  defaultActionLabel: string;
  disabled: boolean;
  onDefaultAction: () => void;
}) {
  const { onPointerEnter, isHighlighted } = useTooltipTriggerProps(model);

  return (
    <TooltipItem item={model}>
      <ModelSettingsRowButton
        model={model}
        displayTitle={displayTitle}
        isActive={isActive}
        isImageDefault={isImageDefault}
        isSecondaryDefault={isSecondaryDefault}
        defaultActionLabel={defaultActionLabel}
        disabled={disabled}
        isHighlighted={isHighlighted}
        showNativeTitle={false}
        onPointerEnter={onPointerEnter}
        onDefaultAction={onDefaultAction}
      />
    </TooltipItem>
  );
}
