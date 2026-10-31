import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SelectionAnchorRect } from "@/hooks/use-text-selection-action-menu";
import { scaleRootFixedAnchorStyle } from "@/lib/scale-root-fixed-anchor-style";
import { cn } from "@/lib/utils";

type TextSelectionActionMenuProps = {
  open: boolean;
  anchor: SelectionAnchorRect | null;
  onOpenChange(open: boolean): void;
  children: ReactNode;
};

export function TextSelectionActionMenu({
  open,
  anchor,
  onOpenChange,
  children,
}: TextSelectionActionMenuProps) {
  if (!anchor) {
    return null;
  }

  const triggerStyle = scaleRootFixedAnchorStyle({
    left: anchor.x,
    top: anchor.y,
    width: anchor.width,
    height: anchor.height,
  });

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden tabIndex={-1} style={triggerStyle} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        side="top"
        sideOffset={8}
        className="p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type TextSelectionActionMenuItemProps = {
  label: string;
  onSelect(): void;
};

export function TextSelectionActionMenuItem({ label, onSelect }: TextSelectionActionMenuItemProps) {
  return (
    <DropdownMenuItem onSelect={onSelect} onMouseDown={(event) => event.preventDefault()}>
      {label}
    </DropdownMenuItem>
  );
}

export type TextSelectionActionMenuSegment = {
  label: string;
  onSelect(): void;
};

/** Connected segmented button group: one rounded outer shell with separators between segments, shaped like a single Button Group. */
export function TextSelectionActionMenuSegmentedItems({
  segments,
}: {
  segments: readonly TextSelectionActionMenuSegment[];
}) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-sm">
      {segments.map((segment, index) => (
        <DropdownMenuItem
          key={segment.label}
          onSelect={segment.onSelect}
          onMouseDown={(event) => event.preventDefault()}
          className={cn("w-auto rounded-none", index > 0 && "border-border border-l")}
        >
          {segment.label}
        </DropdownMenuItem>
      ))}
    </div>
  );
}
