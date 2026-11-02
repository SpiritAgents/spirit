import { type ReactNode, useMemo } from "react";

import { Badge } from "../badge.js";
import {
  DESKTOP_OVERLAY_LIST_DETAIL_LABEL,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SECONDARY,
} from "../chrome.js";
import { buildModelCatalogDetailFields, modelCatalogDisplayTitle } from "./model-catalog-detail.js";
import { useModelPickerLabels } from "./labels.js";
import { useModelPickerRuntime } from "./runtime.js";
import { parseModelContextLength } from "./model-context-length.js";
import { DESKTOP_LIST_ITEM_PRIMARY_CLASS } from "../typography.js";
import { cn } from "../cn.js";
import type { ModelPickerModelProfile, ModelCatalogEntry } from "./types.js";

type ModelCatalogDetailPanelProps = {
  model: ModelPickerModelProfile;
  catalogEntry?: ModelCatalogEntry;
  providerLabel: string;
  density?: "default" | "list";
  children?: ReactNode;
};

function ModelCatalogDetailFieldSection({
  label,
  value,
  density = "default",
}: {
  label: string;
  value: string;
  density?: "default" | "list";
}) {
  return (
    <section className="flex items-baseline justify-between gap-2">
      <span
        className={
          density === "list"
            ? DESKTOP_OVERLAY_LIST_DETAIL_LABEL
            : "text-[11px] text-muted-foreground"
        }
      >
        {label}
      </span>
      <span className="text-right leading-5 text-foreground/90">{value}</span>
    </section>
  );
}

export function ModelCatalogDetailPanel({
  model,
  catalogEntry,
  providerLabel,
  density = "default",
  children,
}: ModelCatalogDetailPanelProps) {
  const labels = useModelPickerLabels();
  const runtime = useModelPickerRuntime();
  const isList = density === "list";
  const title = modelCatalogDisplayTitle(runtime, model, catalogEntry);
  const capabilities = model.capabilities ?? catalogEntry?.capabilities;
  const contextLength =
    parseModelContextLength(model.contextLength) ??
    parseModelContextLength(catalogEntry?.contextLength);
  const maxCompletionTokens = catalogEntry?.outputLimit ?? catalogEntry?.maxCompletionTokens;
  const description = catalogEntry?.description?.trim() ?? "";
  const detailFields = useMemo(
    () =>
      buildModelCatalogDetailFields({
        ...(contextLength !== undefined ? { contextLength } : {}),
        ...(maxCompletionTokens !== undefined ? { maxCompletionTokens } : {}),
        pricing: catalogEntry?.pricing,
        labels,
      }),
    [
      catalogEntry?.outputLimit,
      catalogEntry?.maxCompletionTokens,
      catalogEntry?.pricing,
      contextLength,
      labels,
    ],
  );
  const hasDetailFields = detailFields.length > 0;
  const hasContentBelowHeader = Boolean(description || children || hasDetailFields);
  const hasFollowingSection = Boolean(children || hasDetailFields);
  const controlsIsLast = !hasDetailFields;
  const sectionPadding = isList ? "px-2 py-1.5" : "px-3 py-2.5";
  const sectionPaddingLast = isList ? "px-2 pt-1.5" : "px-3 pt-2.5";
  const sectionDivider = "border-b border-border/40";

  return (
    <div className={cn(isList ? "flex flex-col" : "-mx-3 flex flex-col")}>
      <div
        className={cn(
          hasContentBelowHeader &&
            (isList ? "border-b border-border/40" : "border-b border-border/60"),
          isList ? "px-2 py-1.5" : hasContentBelowHeader ? "px-3 pb-3" : "px-3",
        )}
      >
        <p
          className={cn(
            isList
              ? DESKTOP_OVERLAY_LIST_ITEM_PRIMARY
              : cn(DESKTOP_LIST_ITEM_PRIMARY_CLASS, "leading-snug"),
          )}
        >
          {title}
        </p>
        <p
          className={cn(
            isList ? DESKTOP_OVERLAY_LIST_ITEM_SECONDARY : "mt-1 text-[11px] text-muted-foreground",
          )}
        >
          {providerLabel}
        </p>
        {(capabilities && capabilities.length > 0) || model.hasProviderTools === true ? (
          <div className={cn("flex flex-wrap gap-1.5", isList ? "mt-1.5" : "mt-2")}>
            {(capabilities ?? []).map((capability) => (
              <Badge
                key={capability}
                variant="secondary"
                className="text-[10px] text-secondary-foreground"
              >
                {labels.capability(capability)}
              </Badge>
            ))}
            {/* Presence-only marker: the provider entry declares providerTools (no per-kind split). */}
            {model.hasProviderTools === true ? (
              <Badge variant="secondary" className="text-[10px] text-secondary-foreground">
                {labels.capabilityProviderTools}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>
      {description ? (
        <div
          className={cn(
            hasFollowingSection ? sectionPadding : sectionPaddingLast,
            hasFollowingSection && sectionDivider,
            "text-xs",
          )}
        >
          <p className="whitespace-pre-wrap leading-5 text-foreground/90">{description}</p>
        </div>
      ) : null}
      {children ? (
        <div
          className={cn(
            controlsIsLast ? sectionPaddingLast : sectionPadding,
            !controlsIsLast && sectionDivider,
          )}
        >
          {children}
        </div>
      ) : null}
      {hasDetailFields ? (
        <div className={cn(sectionPaddingLast, "space-y-2 text-xs")}>
          {detailFields.map((field) => (
            <ModelCatalogDetailFieldSection
              key={field.id}
              label={field.label}
              value={field.value}
              density={density}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
