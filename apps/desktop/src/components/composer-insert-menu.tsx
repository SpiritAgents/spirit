import { Plus } from "@spiritagent/icons/plus";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AtSign, File } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DESKTOP_COMPOSER_GHOST_HOVER,
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_LIST_GAP,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { FONT_WEIGHT_MEDIUM } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

type ComposerInsertMenuProps = {
  disabled?: boolean;
  canPickLocalFile?: boolean;
  onInsertWorkspaceReference(): void;
  onPickLocalFile(): void | Promise<void>;
  onInsertSkillTrigger(): void;
};

type PendingInsertAction = "at" | "slash" | "local";

function SlashBadge() {
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted/65 text-[10px]",
        FONT_WEIGHT_MEDIUM,
      )}
    >
      /
    </span>
  );
}

export function ComposerInsertMenu({
  disabled = false,
  canPickLocalFile = false,
  onInsertWorkspaceReference,
  onPickLocalFile,
  onInsertSkillTrigger,
}: ComposerInsertMenuProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const pendingActionRef = useRef<PendingInsertAction | null>(null);
  const suppressTooltip = menuOpen || disabled;

  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      setMenuOpen(open);
      if (open) {
        return;
      }
      const action = pendingActionRef.current;
      if (!action) {
        return;
      }
      pendingActionRef.current = null;
      switch (action) {
        case "at":
          onInsertWorkspaceReference();
          break;
        case "slash":
          onInsertSkillTrigger();
          break;
        case "local":
          void onPickLocalFile();
          break;
      }
    },
    [onInsertSkillTrigger, onInsertWorkspaceReference, onPickLocalFile],
  );

  return (
    <DropdownMenu modal onOpenChange={handleMenuOpenChange}>
      <Tooltip
        open={suppressTooltip ? false : undefined}
        delayDuration={300}
        disableHoverableContent
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("composer.openInsertPanel")}
              disabled={disabled}
              className={cn(
                DESKTOP_COMPOSER_GHOST_HOVER,
                "size-7 shrink-0 rounded-full p-0 text-muted-foreground shadow-none",
                "hover:text-chrome-emphasis aria-expanded:text-chrome-emphasis",
                instantHoverMotionClass,
              )}
            >
              <Plus className="size-3.5" aria-hidden strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {t("composer.insert")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={10}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        className={cn(
          "flex w-max min-w-[11rem] max-w-[min(15rem,calc(100vw-1.25rem))] flex-col",
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          DESKTOP_OVERLAY_LIST_LIST_PADDING,
          DESKTOP_OVERLAY_LIST_LIST_GAP,
        )}
      >
        <DropdownMenuItem
          className={cn(
            "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none",
            DESKTOP_OVERLAY_LIST_ITEM,
            "text-popover-foreground",
          )}
          onSelect={() => {
            pendingActionRef.current = "at";
          }}
        >
          <AtSign className="size-4 shrink-0" aria-hidden strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{t("composer.insertWorkspaceFile")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canPickLocalFile}
          className={cn(
            "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none",
            DESKTOP_OVERLAY_LIST_ITEM,
            "text-popover-foreground",
          )}
          onSelect={() => {
            pendingActionRef.current = "local";
          }}
        >
          <File className="size-4 shrink-0" aria-hidden strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{t("composer.selectLocalFile")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={cn(
            "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none",
            DESKTOP_OVERLAY_LIST_ITEM,
            "text-popover-foreground",
          )}
          onSelect={() => {
            pendingActionRef.current = "slash";
          }}
        >
          <SlashBadge />
          <span className="min-w-0 flex-1 truncate">{t("composer.slashCommand")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
