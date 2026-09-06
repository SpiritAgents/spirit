// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Toggle } from "@/components/ui/toggle";
import type { DesktopMarketplaceSource } from "@/types";

type MarketplaceSourceTabProps = {
  source: DesktopMarketplaceSource;
  active: boolean;
  onSelect: (sourceId: string) => void;
  onRemove: (source: DesktopMarketplaceSource) => void;
};

/** One marketplace source tab; custom sources carry a right-click remove menu. */
export function MarketplaceSourceTab({
  source,
  active,
  onSelect,
  onRemove,
}: MarketplaceSourceTabProps) {
  const { t } = useTranslation();
  const label =
    source.id === "built-in"
      ? t("marketplace.tabBuiltIn")
      : source.id === "personal"
        ? t("marketplace.tabPersonal")
        : source.displayName;

  const tab = (
    <Toggle
      size="sm"
      pressed={active}
      onPressedChange={() => onSelect(source.id)}
      aria-label={label}
    >
      {label}
    </Toggle>
  );
  if (source.internal) {
    return <span className="contents">{tab}</span>;
  }
  return (
    <ContextMenu>
      {/* No asChild onto the Toggle: the trigger's own data-state="closed"
          would reach Toggle.Root through the Slot merge, and radix Toggle
          spreads incoming props after its own data-state, so the menu state
          would clobber data-state="on" and silently disable all
          data-[state=on] styling on the tab. */}
      <ContextMenuTrigger className="inline-flex">{tab}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onSelect={() => onRemove(source)}>
          <X aria-hidden />
          {t("marketplace.removeMarketplace")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
