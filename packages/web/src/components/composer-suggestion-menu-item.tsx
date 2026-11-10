import type { ComponentProps, ReactNode } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

type ComposerSuggestionMenuItemProps = {
  selected?: boolean;
  children: ReactNode;
  onClick?: () => void;
} & Pick<
  ComponentProps<typeof DropdownMenuItem>,
  "onMouseDown" | "onMouseEnter" | "onFocus" | "title" | "onPointerMove"
> & {
    "data-skill-slash-index"?: number;
    "data-workspace-file-reference-index"?: number;
  };

export function ComposerSuggestionMenuItem({
  selected = false,
  children,
  className,
  onClick,
  onPointerMove,
  ...props
}: ComposerSuggestionMenuItemProps & { className?: string }) {
  return (
    <DropdownMenuItem
      className={cn(
        "items-start",
        DESKTOP_OVERLAY_LIST_ITEM,
        selected && DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
        className,
      )}
      onSelect={(event) => {
        event.preventDefault();
        onClick?.();
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        // Radix MenuItem calls item.focus() on pointermove unless preventDefault'ed; the
        // suggestion menu must keep focus in the Composer
        event.preventDefault();
      }}
      {...props}
    >
      {children}
    </DropdownMenuItem>
  );
}
