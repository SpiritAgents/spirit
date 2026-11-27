import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
} from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { RovingFocusGroup } from "@/components/ui/roving-focus-group";
import { scrollAreaViewport, useStickyHeaderPinned } from "@/hooks/use-sticky-header-pinned";
import { bottomScrollFadeMaskStyle, topScrollFadeMaskStyle } from "@/lib/mask-styles";
import { cn } from "@/lib/utils";
import {
  ProviderPickerRowButton,
  type LocalizedProviderRow,
} from "@/components/settings/models/provider-picker-rows";

type ProviderFeaturedSectionProps = {
  label: string;
  rows: readonly LocalizedProviderRow[];
  children: ReactNode;
  onSelect: (id: string) => void;
  className?: string;
  listClassName?: string;
  listRef?: Ref<HTMLDivElement>;
  onListKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
  type?: ComponentProps<typeof ScrollArea>["type"];
  hideScrollbar?: boolean;
  hasMoreBelow?: boolean;
  animateFade?: boolean;
  onScrollRootChange?: (root: HTMLDivElement | null) => void;
};

/**
 * Provider-picker scroll list with a docking Featured group, shared by Settings and Onboarding.
 *
 * The heading is ordinary in-flow sticky content: it travels with the list, docks, leaves
 * with its section, and rubber-bands natively. It paints no background, so the window
 * material stays visible behind it on any surface; the rows sliding beneath it are clipped
 * instead, by a compositor-driven clip that needs no pin state (`.spirit-dock-clip` in
 * `@spiritagent/ui/rendering/dock-clip.css`). Pin state only drives the cosmetic fade at the
 * clip edge.
 */
export function ProviderFeaturedSection({
  label,
  rows,
  children,
  onSelect,
  className,
  listClassName,
  listRef,
  onListKeyDownCapture,
  type = "auto",
  hideScrollbar = false,
  hasMoreBelow = false,
  animateFade = true,
  onScrollRootChange,
}: ProviderFeaturedSectionProps) {
  const [scrollRoot, setScrollRoot] = useState<ComponentRef<typeof ScrollArea> | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const getScrollViewport = useCallback(() => scrollAreaViewport(scrollRoot), [scrollRoot]);
  const hasFeatured = rows.length > 0;
  const docked = useStickyHeaderPinned(sentinelRef, getScrollViewport, hasFeatured);

  useEffect(() => {
    onScrollRootChange?.(scrollRoot);
  }, [onScrollRootChange, scrollRoot]);

  return (
    <ScrollArea
      ref={setScrollRoot}
      data-spirit-surface="provider-featured-scroll"
      type={type}
      className={className}
      // scroll-pt-5 declares the band the docked heading occupies (h-4 + mt-1); the rows
      // clip docks at that line.
      viewportClassName={cn(hideScrollbar && "no-scrollbar", hasFeatured && "scroll-pt-5")}
      style={bottomScrollFadeMaskStyle(hasMoreBelow, { animate: animateFade })}
    >
      <RovingFocusGroup asChild orientation="vertical" onKeyDownCapture={onListKeyDownCapture}>
        <div ref={listRef} className={cn(listClassName, hasFeatured && "overflow-y-clip pt-5")}>
          {hasFeatured ? (
            <section aria-label={label} className="mb-3">
              <div
                ref={sentinelRef}
                className="pointer-events-none -mb-px h-px w-full"
                aria-hidden
              />
              <h2 className="spirit-dock-header z-10 h-4 px-3 text-xs font-normal text-muted-foreground">
                {label}
              </h2>
              <div
                className="spirit-dock-clip mt-1"
                style={topScrollFadeMaskStyle(docked, { animate: animateFade })}
              >
                <div>
                  {rows.map((row) => (
                    <ProviderPickerRowButton key={row.id} row={row} onSelect={onSelect} />
                  ))}
                </div>
              </div>
            </section>
          ) : null}
          {children}
        </div>
      </RovingFocusGroup>
    </ScrollArea>
  );
}
