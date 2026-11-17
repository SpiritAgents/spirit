import { Slot } from "radix-ui";
import { RovingFocus as RovingFocusPrimitive } from "radix-ui/internal";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";

type RovingFocusContextValue = {
  currentTabStopId: string | null;
  setCurrentTabStopId: (tabStopId: string) => void;
};

const RovingFocusContext = createContext<RovingFocusContextValue | null>(null);

export type RovingFocusGroupProps = ComponentProps<typeof RovingFocusPrimitive.Root>;
export type RovingFocusItemProps = ComponentProps<typeof RovingFocusPrimitive.Item>;

export const RovingFocusGroup = forwardRef<HTMLDivElement, RovingFocusGroupProps>(
  function RovingFocusGroup(
    {
      currentTabStopId: currentTabStopIdProp,
      defaultCurrentTabStopId,
      onCurrentTabStopIdChange,
      ...props
    },
    ref,
  ) {
    const [currentTabStopIdState, setCurrentTabStopIdState] = useState<string | null>(
      defaultCurrentTabStopId ?? null,
    );
    const currentTabStopId =
      currentTabStopIdProp === undefined ? currentTabStopIdState : currentTabStopIdProp;
    const setCurrentTabStopId = useCallback(
      (tabStopId: string) => {
        if (currentTabStopIdProp === undefined) {
          setCurrentTabStopIdState(tabStopId);
        }
        onCurrentTabStopIdChange?.(tabStopId);
      },
      [currentTabStopIdProp, onCurrentTabStopIdChange],
    );
    const context = useMemo(
      () => ({ currentTabStopId, setCurrentTabStopId }),
      [currentTabStopId, setCurrentTabStopId],
    );

    return (
      <RovingFocusContext.Provider value={context}>
        <RovingFocusPrimitive.Root
          {...props}
          ref={ref}
          currentTabStopId={currentTabStopIdProp}
          defaultCurrentTabStopId={defaultCurrentTabStopId}
          onCurrentTabStopIdChange={(tabStopId) => {
            if (tabStopId !== null) {
              setCurrentTabStopId(tabStopId);
            }
          }}
        />
      </RovingFocusContext.Provider>
    );
  },
);

export const RovingFocusItem = forwardRef<HTMLSpanElement, RovingFocusItemProps>(
  function RovingFocusItem(
    { active: _active, asChild = false, focusable = true, tabStopId, onFocus, ...props },
    ref,
  ) {
    const context = useContext(RovingFocusContext);
    if (!context) {
      const Component = asChild ? Slot.Root : "span";
      const children =
        typeof props.children === "function"
          ? props.children({ hasTabStop: false, isCurrentTabStop: false })
          : props.children;
      return (
        <Component {...props} ref={ref} onFocus={onFocus}>
          {children}
        </Component>
      );
    }

    return (
      <RovingFocusPrimitive.Item
        {...props}
        ref={ref}
        asChild={asChild}
        active={_active}
        tabStopId={tabStopId}
        focusable={focusable}
        onFocus={(event) => {
          onFocus?.(event);
          if (tabStopId !== undefined) {
            context?.setCurrentTabStopId(tabStopId);
          }
        }}
        data-roving-focus-item=""
        data-roving-focus-id={tabStopId}
        data-roving-focus-focusable={focusable ? undefined : "false"}
      />
    );
  },
);

type RovingFocusActionProps = ComponentProps<typeof Slot.Root> & {
  /** Matches the RovingFocusItem that owns this row action. */
  tabStopId?: string;
  children: ReactElement;
};

/** Keeps non-current row actions out of the Tab order without disabling pointer interaction. */
export const RovingFocusAction = forwardRef<HTMLElement, RovingFocusActionProps>(
  function RovingFocusAction(
    { tabStopId, children, onFocus, tabIndex: tabIndexProp, ...props },
    ref,
  ) {
    const context = useContext(RovingFocusContext);
    return (
      <Slot.Root
        {...props}
        ref={ref}
        tabIndex={
          context && tabStopId !== undefined
            ? context.currentTabStopId === tabStopId
              ? 0
              : -1
            : tabIndexProp
        }
        onFocus={(event) => {
          onFocus?.(event);
          if (tabStopId !== undefined) {
            context?.setCurrentTabStopId(tabStopId);
          }
        }}
      >
        {children}
      </Slot.Root>
    );
  },
);

type RovingFocusRectEntry = {
  element: HTMLElement;
  rect: DOMRect;
};

type RovingFocusVisualRow = {
  top: number;
  entries: RovingFocusRectEntry[];
};

function isNavigableRovingFocusItem(element: HTMLElement): boolean {
  return (
    element.dataset.rovingFocusFocusable !== "false" &&
    element.getAttribute("aria-disabled") !== "true" &&
    !element.matches(":disabled")
  );
}

function findRovingFocusItem(container: HTMLElement | null, tabStopId: string): HTMLElement | null {
  if (!container) {
    return null;
  }
  return (
    Array.from(container.querySelectorAll<HTMLElement>("[data-roving-focus-item]")).find(
      (element) =>
        element.dataset.rovingFocusId === tabStopId && isNavigableRovingFocusItem(element),
    ) ?? null
  );
}

function visualRows(container: HTMLElement): RovingFocusVisualRow[] {
  const entries = Array.from(container.querySelectorAll<HTMLElement>("[data-roving-focus-item]"))
    .filter(
      (element) =>
        element.closest("[data-roving-focus-grid]") === container &&
        isNavigableRovingFocusItem(element) &&
        element.getClientRects().length > 0,
    )
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
  const rows: RovingFocusVisualRow[] = [];
  for (const entry of entries) {
    const row = rows.at(-1);
    // Sub-pixel layout can differ by a fraction within one CSS grid row.
    if (row && Math.abs(row.top - entry.rect.top) <= 2) {
      row.entries.push(entry);
    } else {
      rows.push({ top: entry.rect.top, entries: [entry] });
    }
  }
  for (const row of rows) {
    row.entries.sort((left, right) => left.rect.left - right.rect.left);
  }
  return rows;
}

function nearestHorizontalEntry(
  entries: RovingFocusRectEntry[],
  current: RovingFocusRectEntry,
): HTMLElement | null {
  const currentCenter = current.rect.left + current.rect.width / 2;
  return (
    entries.reduce<RovingFocusRectEntry | null>((nearest, entry) => {
      if (!nearest) {
        return entry;
      }
      const entryDistance = Math.abs(entry.rect.left + entry.rect.width / 2 - currentCenter);
      const nearestDistance = Math.abs(nearest.rect.left + nearest.rect.width / 2 - currentCenter);
      return entryDistance < nearestDistance ? entry : nearest;
    }, null)?.element ?? null
  );
}

export const RovingFocusGrid = forwardRef<HTMLDivElement, RovingFocusGroupProps>(
  function RovingFocusGrid({ onKeyDownCapture, ...props }, forwardedRef) {
    const gridRef = useRef<HTMLDivElement | null>(null);
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        gridRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    const handleKeyDownCapture = useCallback(
      (event: ReactKeyboardEvent<HTMLDivElement>) => {
        onKeyDownCapture?.(event);
        if (
          event.defaultPrevented ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey
        ) {
          return;
        }
        const grid = gridRef.current;
        const target = event.target;
        if (!(grid && target instanceof HTMLElement)) {
          return;
        }
        const currentElement = target.closest<HTMLElement>("[data-roving-focus-item]");
        if (!currentElement || currentElement.closest("[data-roving-focus-grid]") !== grid) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        const rows = visualRows(grid);
        const currentRowIndex = rows.findIndex((row) =>
          row.entries.some((entry) => entry.element === currentElement),
        );
        if (currentRowIndex < 0) {
          return;
        }
        const currentRow = rows[currentRowIndex]!;
        const currentEntry = currentRow.entries.find((entry) => entry.element === currentElement)!;
        const currentColumnIndex = currentRow.entries.indexOf(currentEntry);
        let nextElement: HTMLElement | null = null;
        if (event.key === "ArrowLeft") {
          nextElement = currentRow.entries[currentColumnIndex - 1]?.element ?? null;
        } else if (event.key === "ArrowRight") {
          nextElement = currentRow.entries[currentColumnIndex + 1]?.element ?? null;
        } else {
          const nextRow =
            event.key === "ArrowUp" ? rows[currentRowIndex - 1] : rows[currentRowIndex + 1];
          nextElement = nextRow ? nearestHorizontalEntry(nextRow.entries, currentEntry) : null;
        }
        nextElement?.focus();
      },
      [onKeyDownCapture],
    );

    return (
      <RovingFocusGroup
        {...props}
        ref={setRefs}
        data-roving-focus-grid=""
        onKeyDownCapture={handleKeyDownCapture}
      />
    );
  },
);

type UseVirtualRovingFocusOptions = {
  containerRef: RefObject<HTMLElement | null>;
  /** All navigable row ids in logical order, including rows not currently mounted. */
  itemIds: readonly string[];
  scrollToIndex: (index: number) => void;
};

/** Extends a vertical RovingFocusGroup across the unmounted edges of a virtualized list. */
export function useVirtualRovingFocus({
  containerRef,
  itemIds,
  scrollToIndex,
}: UseVirtualRovingFocusOptions) {
  const pendingTabStopIdRef = useRef<string | null>(null);
  const pendingIndexRef = useRef(-1);
  const pendingItemIdsRef = useRef(itemIds);

  useLayoutEffect(() => {
    const pendingTabStopId = pendingTabStopIdRef.current;
    if (pendingTabStopId === null) {
      return;
    }
    if (!itemIds.includes(pendingTabStopId)) {
      pendingTabStopIdRef.current = null;
      pendingIndexRef.current = -1;
      pendingItemIdsRef.current = itemIds;
      return;
    }
    const target = findRovingFocusItem(containerRef.current, pendingTabStopId);
    if (target) {
      pendingTabStopIdRef.current = null;
      pendingIndexRef.current = -1;
      pendingItemIdsRef.current = itemIds;
      if (target.ownerDocument.activeElement !== target) {
        target.focus();
      }
      return;
    }
    const nextIndex = itemIds.indexOf(pendingTabStopId);
    if (pendingItemIdsRef.current !== itemIds || pendingIndexRef.current !== nextIndex) {
      pendingItemIdsRef.current = itemIds;
      pendingIndexRef.current = nextIndex;
      scrollToIndex(nextIndex);
    }
  });

  const onKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (
        !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const currentElement = target.closest<HTMLElement>("[data-roving-focus-item]");
      const currentTabStopId = pendingTabStopIdRef.current ?? currentElement?.dataset.rovingFocusId;
      if (!currentTabStopId) {
        return;
      }
      const currentIndex = itemIds.indexOf(currentTabStopId);
      if (currentIndex < 0) {
        return;
      }
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? itemIds.length - 1
            : event.key === "ArrowUp"
              ? currentIndex - 1
              : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= itemIds.length || nextIndex === currentIndex) {
        return;
      }
      const nextTabStopId = itemIds[nextIndex]!;
      event.preventDefault();
      event.stopPropagation();
      pendingTabStopIdRef.current = nextTabStopId;
      pendingIndexRef.current = nextIndex;
      pendingItemIdsRef.current = itemIds;
      const nextElement = findRovingFocusItem(containerRef.current, nextTabStopId);
      if (nextElement) {
        nextElement.focus();
      } else {
        scrollToIndex(nextIndex);
      }
    },
    [containerRef, itemIds, scrollToIndex],
  );

  const onFocusCapture = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const tabStopId = target.closest<HTMLElement>("[data-roving-focus-item]")?.dataset
        .rovingFocusId;
      if (tabStopId !== undefined && tabStopId !== pendingTabStopIdRef.current) {
        pendingTabStopIdRef.current = null;
        pendingIndexRef.current = -1;
        pendingItemIdsRef.current = itemIds;
      }
    },
    [itemIds],
  );

  const onBlurCapture = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      const container = containerRef.current;
      const relatedTarget = event.relatedTarget;
      // A virtual row may blur with a null target while its replacement mounts.
      // Successful focus clears the pending id in the layout effect above.
      if (container && relatedTarget instanceof Node && !container.contains(relatedTarget)) {
        pendingTabStopIdRef.current = null;
        pendingIndexRef.current = -1;
      }
    },
    [containerRef],
  );

  return { onKeyDownCapture, onFocusCapture, onBlurCapture };
}
