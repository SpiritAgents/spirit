/**
 * Tooltip instant-switch is coordinated globally by TooltipProvider.
 * Each `<Tooltip>` registers triggers and content; no manual merging is required.
 */
import * as React from "react";
import { useSyncExternalStore } from "react";
import { Popover as PopoverPrimitive, Slot, Tooltip as TooltipPrimitive } from "radix-ui";

import {
  bumpTooltipContentHostRevision,
  getTooltipContentHostRevision,
  isTooltipAnchorSlot,
  isTooltipItemHighlighted,
  isTooltipKeyboardInput,
  isTooltipPointerHighlightSlot,
  subscribeTooltipContentHostRevision,
  subscribeTooltipItemInteraction,
} from "@/hooks/tooltip-item-interaction-store";
import { useGlobalTooltipSwitch } from "@/hooks/use-global-tooltip-switch";
import { isEventTargetWithinTooltipCompanionOverlays } from "@/hooks/tooltip-switch-registry";
import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_SHADOW_LG } from "@/lib/desktop-chrome";
import { getUiLayoutPortalContainer, viewportPointToScaleRootLocal } from "@/lib/ui-layout-scale";
import { cn } from "@/lib/utils";

const TOOLTIP_ZONE_SLOT = "tooltip-zone";

type TooltipSwitchItem = { id: string };

type TooltipContentAppearance = "compact" | "detail";

type TooltipContentRegistration = {
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
  sideOffset?: number;
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
  collisionPadding?: React.ComponentProps<typeof TooltipPrimitive.Content>["collisionPadding"];
  appearance?: TooltipContentAppearance;
  className?: string;
  resolveClassName?: (activeItem: unknown) => string | undefined;
  onEscapeKeyDown?: React.ComponentProps<typeof TooltipPrimitive.Content>["onEscapeKeyDown"];
  onAnimationEnd?: React.ComponentProps<typeof TooltipPrimitive.Content>["onAnimationEnd"];
  render: (activeItem: unknown) => React.ReactNode;
};

const TOOLTIP_CONTENT_COMPACT_CLASS = cn(
  "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-lg bg-popover px-3 py-1.5 text-xs text-popover-foreground backdrop-blur-sm has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
  DESKTOP_OVERLAY_EDGE,
  DESKTOP_OVERLAY_SHADOW_LG,
);

const TOOLTIP_CONTENT_DETAIL_CLASS = cn(
  "z-50 w-auto max-w-none origin-(--radix-tooltip-content-transform-origin) rounded-lg bg-popover text-popover-foreground backdrop-blur-sm data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
  DESKTOP_OVERLAY_EDGE,
  DESKTOP_OVERLAY_SHADOW_LG,
);

type TooltipGlobalContextValue = ReturnType<typeof useGlobalTooltipSwitch> & {
  registerContent: (registrationId: string, content: TooltipContentRegistration) => void;
  unregisterContent: (registrationId: string) => void;
  getContentRegistration: (registrationId: string) => TooltipContentRegistration | undefined;
  registerOpenChange: (
    registrationId: string,
    onOpenChange: ((open: boolean) => void) | undefined,
  ) => void;
};

type TooltipStableActionsValue = Pick<
  ReturnType<typeof useGlobalTooltipSwitch>,
  | "getTriggerProps"
  | "dismissIfOpen"
  | "dismissActiveItem"
  | "onTriggerPointerDown"
  | "registerTriggerElement"
>;

type TooltipStableRegistrationValue = Pick<
  ReturnType<typeof useGlobalTooltipSwitch>,
  | "registerTriggerZone"
  | "unregisterTriggerZone"
  | "setRegistrationTiming"
  | "onTriggerZonePointerLeave"
> & {
  registerContent: (registrationId: string, content: TooltipContentRegistration) => void;
  unregisterContent: (registrationId: string) => void;
  registerOpenChange: (
    registrationId: string,
    onOpenChange: ((open: boolean) => void) | undefined,
  ) => void;
};

type TooltipRegistrationContextValue<TItem = TooltipSwitchItem> = {
  registrationId: string;
  getItemId: (item: TItem) => string;
  openDelayMs: number;
  onOpenChange?: (open: boolean) => void;
};

const TooltipGlobalContext = React.createContext<TooltipGlobalContextValue | null>(null);
const TooltipStableActionsContext = React.createContext<TooltipStableActionsValue | null>(null);
const TooltipStableRegistrationContext = React.createContext<TooltipStableRegistrationValue | null>(
  null,
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TooltipRegistrationContext = React.createContext<TooltipRegistrationContextValue<any> | null>(
  null,
);

/** Null leaves ordinary menu items under Radix's focus handling. */
const TooltipItemMenuHighlightContext = React.createContext<{
  highlighted: boolean;
  pointer: boolean;
} | null>(null);

export function useOptionalTooltipItemMenuHighlight() {
  return React.useContext(TooltipItemMenuHighlightContext);
}

export function useTooltipKeyboardInput(): boolean {
  return useSyncExternalStore(subscribeTooltipItemInteraction, isTooltipKeyboardInput, () => false);
}

function useTooltipGlobalContext(): TooltipGlobalContextValue {
  const value = React.useContext(TooltipGlobalContext);
  if (!value) {
    throw new Error("Tooltip components must be used within TooltipProvider");
  }
  return value;
}

function useOptionalTooltipGlobalContext(): TooltipGlobalContextValue | null {
  return React.useContext(TooltipGlobalContext);
}

function useTooltipStableActions(): TooltipStableActionsValue {
  const value = React.useContext(TooltipStableActionsContext);
  if (!value) {
    throw new Error("Tooltip components must be used within TooltipProvider");
  }
  return value;
}

function useOptionalTooltipStableActions(): TooltipStableActionsValue | null {
  return React.useContext(TooltipStableActionsContext);
}

function useTooltipStableRegistration(): TooltipStableRegistrationValue {
  const value = React.useContext(TooltipStableRegistrationContext);
  if (!value) {
    throw new Error("Tooltip components must be used within TooltipProvider");
  }
  return value;
}

export function useTooltipItemHighlighted(registrationId: string, itemId: string): boolean {
  return useSyncExternalStore(
    subscribeTooltipItemInteraction,
    () => isTooltipItemHighlighted(registrationId, itemId),
    () => false,
  );
}

export function useTooltipTriggerProps<TItem>(item: TItem) {
  const registration = useTooltipRegistrationContext<TItem>();
  const actions = useTooltipStableActions();
  const itemId = registration.getItemId(item);
  const isHighlighted = useTooltipItemHighlighted(registration.registrationId, itemId);
  const { onPointerEnter } = actions.getTriggerProps(
    registration.registrationId,
    item,
    registration.getItemId,
    registration.openDelayMs,
  );
  return { onPointerEnter, isHighlighted };
}

function useTooltipRegistrationContext<
  TItem = TooltipSwitchItem,
>(): TooltipRegistrationContextValue<TItem> {
  const value = React.useContext(TooltipRegistrationContext);
  if (!value) {
    throw new Error("Tooltip compound subcomponents must be used within Tooltip");
  }
  return value as TooltipRegistrationContextValue<TItem>;
}

function useOptionalTooltipRegistrationContext<
  TItem = TooltipSwitchItem,
>(): TooltipRegistrationContextValue<TItem> | null {
  return React.useContext(
    TooltipRegistrationContext,
  ) as TooltipRegistrationContextValue<TItem> | null;
}

export function useTooltipContext<TItem = TooltipSwitchItem>() {
  const global = useTooltipGlobalContext();
  const registration = useTooltipRegistrationContext<TItem>();
  const { registrationId, getItemId, openDelayMs } = registration;
  const anchorSlot = global.anchorSlot;

  return {
    getItemId,
    anchorItemId: anchorSlot?.registrationId === registrationId ? anchorSlot.itemId : null,
    activeItem: (global.contentActiveItem as TItem | null) ?? null,
    getTriggerProps: (item: TItem) =>
      global.getTriggerProps(registrationId, item, getItemId, openDelayMs),
    onTriggerZonePointerLeave: (event: React.PointerEvent<HTMLDivElement>) =>
      global.onTriggerZonePointerLeave(registrationId, event),
    contentRef: global.contentRef,
    dismissIfOpen: global.dismissIfOpen,
    dismissActiveItem: global.dismissActiveItem,
  };
}

export function useOptionalTooltipContext<TItem = TooltipSwitchItem>(): {
  getItemId: (item: TItem) => string;
  anchorItemId: string | null;
  activeItem: TItem | null;
  getTriggerProps: (item: TItem) => {
    onPointerEnter: () => void;
    isHighlighted: boolean;
    isAnchor: boolean;
  };
  triggerZoneRef: React.RefObject<HTMLDivElement | null>;
  onTriggerZonePointerLeave: (event: React.PointerEvent<HTMLDivElement>) => void;
  contentRef: React.RefObject<HTMLDivElement | null>;
  dismissIfOpen: () => void;
  dismissActiveItem: () => void;
} | null {
  const global = useOptionalTooltipGlobalContext();
  const registration = useOptionalTooltipRegistrationContext<TItem>();
  if (!global || !registration) {
    return null;
  }

  const { registrationId, getItemId, openDelayMs } = registration;
  const anchorSlot = global.anchorSlot;

  return {
    getItemId,
    anchorItemId: anchorSlot?.registrationId === registrationId ? anchorSlot.itemId : null,
    activeItem: (global.contentActiveItem as TItem | null) ?? null,
    getTriggerProps: (item: TItem) =>
      global.getTriggerProps(registrationId, item, getItemId, openDelayMs),
    triggerZoneRef: { current: null },
    onTriggerZonePointerLeave: (event) => global.onTriggerZonePointerLeave(registrationId, event),
    contentRef: global.contentRef,
    dismissIfOpen: global.dismissIfOpen,
    dismissActiveItem: global.dismissActiveItem,
  };
}

function tooltipContentStateAttribute(
  openKind: ReturnType<typeof useGlobalTooltipSwitch>["openKind"],
  hasContent: boolean,
  open: boolean,
): "closed" | "delayed-open" | "instant-open" {
  if (!hasContent) {
    return "closed";
  }
  if (!open) {
    return "closed";
  }
  return openKind === "delayed" ? "delayed-open" : "instant-open";
}

function composeElementRef<T>(forwardedRef: React.Ref<T> | undefined, node: T | null) {
  if (typeof forwardedRef === "function") {
    return forwardedRef(node);
  } else if (forwardedRef) {
    forwardedRef.current = node;
  }
}

function tooltipContentId(registrationId: string): string {
  return `spirit-tooltip-${registrationId}`;
}

function GlobalTooltipContentHost() {
  const global = useTooltipGlobalContext();
  useSyncExternalStore(
    subscribeTooltipContentHostRevision,
    getTooltipContentHostRevision,
    getTooltipContentHostRevision,
  );
  const lastRegistrationIdRef = React.useRef<string | null>(null);

  if (global.activeRegistrationId) {
    lastRegistrationIdRef.current = global.activeRegistrationId;
  }

  const registrationId = global.activeRegistrationId ?? lastRegistrationIdRef.current;
  const contentRegistration = registrationId
    ? global.getContentRegistration(registrationId)
    : undefined;
  const hasContent = global.contentActiveItem !== null && contentRegistration !== undefined;
  const isNonHoverableContent =
    registrationId !== null && !global.isRegistrationHoverableContent(registrationId);
  const dataState = tooltipContentStateAttribute(global.openKind, hasContent, global.open);
  const lingerExitPosition =
    !global.open && global.lingerContentScreenRect !== null ? global.lingerContentScreenRect : null;
  const lingerExitLocal =
    lingerExitPosition !== null
      ? viewportPointToScaleRootLocal(lingerExitPosition.top, lingerExitPosition.left)
      : null;

  if (!hasContent) {
    return null;
  }

  const renderedChildren = contentRegistration.render(global.contentActiveItem);
  const appearance = contentRegistration.appearance ?? "compact";
  const resolvedClassName = contentRegistration.resolveClassName?.(global.contentActiveItem);
  const contentClassName = cn(
    appearance === "detail" ? TOOLTIP_CONTENT_DETAIL_CLASS : TOOLTIP_CONTENT_COMPACT_CLASS,
    contentRegistration.className,
    resolvedClassName,
    isNonHoverableContent && "pointer-events-none",
  );

  if (lingerExitPosition !== null && lingerExitLocal !== null) {
    return (
      <PopoverPrimitive.Portal container={getUiLayoutPortalContainer()}>
        <div
          ref={global.contentRef}
          id={registrationId ? tooltipContentId(registrationId) : undefined}
          role="tooltip"
          data-slot="tooltip-content"
          data-state={dataState}
          style={{
            position: "fixed",
            top: lingerExitLocal.top,
            left: lingerExitLocal.left,
            transform: "none",
          }}
          className={contentClassName}
          onAnimationEnd={contentRegistration.onAnimationEnd}
          onPointerEnter={global.onContentPointerEnter}
        >
          {renderedChildren}
        </div>
      </PopoverPrimitive.Portal>
    );
  }

  return (
    <PopoverPrimitive.Portal container={getUiLayoutPortalContainer()}>
      <PopoverPrimitive.Content
        ref={global.contentRef}
        id={registrationId ? tooltipContentId(registrationId) : undefined}
        role="tooltip"
        data-slot="tooltip-content"
        data-state={dataState}
        side={contentRegistration.side ?? "top"}
        align={contentRegistration.align}
        sideOffset={contentRegistration.sideOffset ?? 0}
        collisionPadding={contentRegistration.collisionPadding}
        className={contentClassName}
        style={
          {
            "--radix-tooltip-content-transform-origin":
              "var(--radix-popover-content-transform-origin)",
          } as React.CSSProperties
        }
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => {
          if (isEventTargetWithinTooltipCompanionOverlays(event.target)) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          contentRegistration.onEscapeKeyDown?.(event);
          global.dismissActiveItem();
        }}
        onAnimationEnd={contentRegistration.onAnimationEnd}
        onPointerEnter={global.onContentPointerEnter}
      >
        {renderedChildren}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

function TooltipProvider({
  delayDuration = 300,
  skipDelayDuration = 300,
  disableHoverableContent = false,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider> & {
  delayDuration?: number;
}) {
  const globalSwitch = useGlobalTooltipSwitch({ defaultOpenDelayMs: delayDuration });
  const contentRegistryRef = React.useRef(new Map<string, TooltipContentRegistration>());
  const lingerContentRegistryRef = React.useRef(new Map<string, TooltipContentRegistration>());
  const contentActiveItemRef = React.useRef(globalSwitch.contentActiveItem);
  contentActiveItemRef.current = globalSwitch.contentActiveItem;
  const onOpenChangeByRegistrationRef = React.useRef(
    new Map<string, ((open: boolean) => void) | undefined>(),
  );
  const prevOpenByRegistrationRef = React.useRef(new Map<string, boolean>());

  const registerContent = React.useCallback(
    (registrationId: string, content: TooltipContentRegistration) => {
      contentRegistryRef.current.set(registrationId, content);
      lingerContentRegistryRef.current.delete(registrationId);
    },
    [],
  );

  const unregisterContent = React.useCallback((registrationId: string) => {
    const content = contentRegistryRef.current.get(registrationId);
    if (!content) {
      return;
    }
    contentRegistryRef.current.delete(registrationId);
    if (contentActiveItemRef.current !== null) {
      lingerContentRegistryRef.current.set(registrationId, content);
    }
  }, []);

  const getContentRegistration = React.useCallback((registrationId: string) => {
    return (
      contentRegistryRef.current.get(registrationId) ??
      lingerContentRegistryRef.current.get(registrationId)
    );
  }, []);

  React.useEffect(() => {
    if (globalSwitch.contentActiveItem === null) {
      lingerContentRegistryRef.current.clear();
    }
  }, [globalSwitch.contentActiveItem]);

  const registerOpenChange = React.useCallback(
    (registrationId: string, onOpenChange: ((open: boolean) => void) | undefined) => {
      onOpenChangeByRegistrationRef.current.set(registrationId, onOpenChange);
    },
    [],
  );

  const effectiveOpen = globalSwitch.open || globalSwitch.contentActiveItem !== null;

  React.useEffect(() => {
    const globallyOpen = globalSwitch.open;
    for (const [registrationId, onOpenChange] of onOpenChangeByRegistrationRef.current) {
      if (!onOpenChange) {
        continue;
      }
      const wasNotifiedOpen = prevOpenByRegistrationRef.current.get(registrationId) ?? false;
      const isActiveRegistration = registrationId === globalSwitch.activeRegistrationId;

      if (globallyOpen && isActiveRegistration && !wasNotifiedOpen) {
        prevOpenByRegistrationRef.current.set(registrationId, true);
        onOpenChange(true);
      } else if ((!globallyOpen || !isActiveRegistration) && wasNotifiedOpen) {
        prevOpenByRegistrationRef.current.set(registrationId, false);
        onOpenChange(false);
      }
    }
  }, [globalSwitch.activeRegistrationId, globalSwitch.open]);

  const globalContextValue = React.useMemo(
    (): TooltipGlobalContextValue => ({
      ...globalSwitch,
      registerContent,
      unregisterContent,
      getContentRegistration,
      registerOpenChange,
    }),
    [globalSwitch, getContentRegistration, registerContent, registerOpenChange, unregisterContent],
  );

  const globalSwitchRef = React.useRef(globalSwitch);
  globalSwitchRef.current = globalSwitch;
  const stableActionsValue = React.useMemo(
    (): TooltipStableActionsValue => ({
      getTriggerProps: (...args) => globalSwitchRef.current.getTriggerProps(...args),
      dismissIfOpen: () => globalSwitchRef.current.dismissIfOpen(),
      dismissActiveItem: () => globalSwitchRef.current.dismissActiveItem(),
      onTriggerPointerDown: (...args) => globalSwitchRef.current.onTriggerPointerDown(...args),
      registerTriggerElement: (...args) => globalSwitchRef.current.registerTriggerElement(...args),
    }),
    [],
  );
  const stableRegistrationValue = React.useMemo(
    (): TooltipStableRegistrationValue => ({
      registerContent,
      unregisterContent,
      registerOpenChange,
      registerTriggerZone: (...args) => globalSwitchRef.current.registerTriggerZone(...args),
      unregisterTriggerZone: (...args) => globalSwitchRef.current.unregisterTriggerZone(...args),
      setRegistrationTiming: (...args) => globalSwitchRef.current.setRegistrationTiming(...args),
      onTriggerZonePointerLeave: (...args) =>
        globalSwitchRef.current.onTriggerZonePointerLeave(...args),
    }),
    [registerContent, registerOpenChange, unregisterContent],
  );

  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={0}
      skipDelayDuration={skipDelayDuration}
      disableHoverableContent={disableHoverableContent}
      {...props}
    >
      <TooltipGlobalContext.Provider value={globalContextValue}>
        <TooltipStableActionsContext.Provider value={stableActionsValue}>
          <TooltipStableRegistrationContext.Provider value={stableRegistrationValue}>
            <PopoverPrimitive.Root
              data-slot="tooltip-root-global"
              open={effectiveOpen}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                  globalSwitch.dismissActiveItem();
                }
              }}
            >
              {children}
              {/* A virtual anchor keeps trigger rows mounted while the shared detail changes. */}
              <PopoverPrimitive.Anchor virtualRef={globalSwitch.anchorRef} />
              <GlobalTooltipContentHost />
            </PopoverPrimitive.Root>
          </TooltipStableRegistrationContext.Provider>
        </TooltipStableActionsContext.Provider>
      </TooltipGlobalContext.Provider>
    </TooltipPrimitive.Provider>
  );
}

type TooltipProps<TItem> = Omit<
  React.ComponentProps<typeof TooltipPrimitive.Root>,
  "open" | "onOpenChange" | "delayDuration"
> & {
  getItemId?: (item: TItem) => string;
  delayDuration?: number;
  closeDelayMs?: number;
  anchorLingerMs?: number;
  disableHoverableContent?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function TooltipRoot<TItem = TooltipSwitchItem>({
  getItemId,
  delayDuration = 300,
  closeDelayMs = 120,
  anchorLingerMs = 220,
  disableHoverableContent = false,
  open: openProp,
  onOpenChange,
  children,
  ...props
}: TooltipProps<TItem>) {
  void props;

  const registrationId = React.useId();
  const stableRegistration = useTooltipStableRegistration();
  const resolvedGetItemId = React.useCallback(
    (item: TItem) => (getItemId ? getItemId(item) : (item as TooltipSwitchItem).id),
    [getItemId],
  );

  React.useEffect(() => {
    stableRegistration.setRegistrationTiming(registrationId, {
      closeDelayMs,
      anchorLingerMs,
      disableHoverableContent,
      disabled: openProp === false,
    });
    stableRegistration.registerOpenChange(registrationId, onOpenChange);
  }, [
    anchorLingerMs,
    closeDelayMs,
    disableHoverableContent,
    onOpenChange,
    openProp,
    registrationId,
    stableRegistration,
  ]);

  React.useEffect(() => {
    return () => {
      stableRegistration.unregisterTriggerZone(registrationId);
      stableRegistration.unregisterContent(registrationId);
      stableRegistration.registerOpenChange(registrationId, undefined);
    };
  }, [registrationId, stableRegistration]);

  const registrationValue = React.useMemo(
    (): TooltipRegistrationContextValue<TItem> => ({
      registrationId,
      getItemId: resolvedGetItemId,
      openDelayMs: delayDuration,
      onOpenChange,
    }),
    [delayDuration, onOpenChange, registrationId, resolvedGetItemId],
  );

  const childArray = React.Children.toArray(children);
  const hasExplicitZone = childArray.some(
    (child) =>
      React.isValidElement(child) &&
      (child.type as { displayName?: string }).displayName === TooltipZone.displayName,
  );
  const contentChildren = childArray.filter(
    (child) =>
      React.isValidElement(child) &&
      (child.type as { displayName?: string }).displayName === TooltipContent.displayName,
  );
  const bodyChildren = childArray.filter((child) => !contentChildren.includes(child));

  return (
    <TooltipRegistrationContext.Provider value={registrationValue}>
      {hasExplicitZone ? (
        bodyChildren
      ) : (
        <TooltipZone className="contents">{bodyChildren}</TooltipZone>
      )}
      {contentChildren}
    </TooltipRegistrationContext.Provider>
  );
}

type TooltipZoneProps = React.ComponentProps<"div">;

const TooltipZone = React.memo(function TooltipZone({
  ref,
  className,
  onPointerLeave,
  ...props
}: TooltipZoneProps) {
  const stableRegistration = useTooltipStableRegistration();
  const { registrationId } = useTooltipRegistrationContext();

  return (
    <div
      data-slot={TOOLTIP_ZONE_SLOT}
      ref={(node) => {
        stableRegistration.registerTriggerZone(registrationId, node);
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      className={className}
      onPointerLeave={(event) => {
        stableRegistration.onTriggerZonePointerLeave(registrationId, event);
        onPointerLeave?.(event);
      }}
      {...props}
    />
  );
});
TooltipZone.displayName = "TooltipZone";

type TooltipItemProps<TItem> = {
  item: TItem | null;
  children: React.ReactNode;
  className?: string;
};

function useTooltipElementRegistration<TItem>(
  item: TItem | null,
  registration: TooltipRegistrationContextValue<TItem> | null,
  actions: TooltipStableActionsValue | null,
) {
  const itemRef = React.useRef(item);
  itemRef.current = item;
  const registrationId = registration?.registrationId;
  const itemId = registration && item !== null ? registration.getItemId(item) : null;
  const openDelayMs = registration?.openDelayMs ?? 0;

  const registerElement = React.useCallback(
    (element: HTMLElement | null) => {
      if (!element || !actions || registrationId === undefined) {
        return;
      }
      return actions.registerTriggerElement(element, {
        registrationId,
        itemId,
        getItem: () => itemRef.current,
        openDelayMs,
      });
    },
    [actions, itemId, openDelayMs, registrationId],
  );
  const isAnchor = useSyncExternalStore(
    subscribeTooltipItemInteraction,
    () =>
      registrationId !== undefined && itemId !== null
        ? isTooltipAnchorSlot(registrationId, itemId)
        : false,
    () => false,
  );
  return { registerElement, isAnchor, registrationId, itemId };
}

function TooltipItem<TItem>({ item, children, className }: TooltipItemProps<TItem>) {
  const actions = useOptionalTooltipStableActions();
  const registration = useOptionalTooltipRegistrationContext<TItem>();
  const { registerElement, isAnchor, registrationId, itemId } = useTooltipElementRegistration(
    item,
    registration,
    actions,
  );
  const isHighlighted = useSyncExternalStore(
    subscribeTooltipItemInteraction,
    () =>
      registrationId !== undefined && itemId !== null
        ? isTooltipItemHighlighted(registrationId, itemId)
        : false,
    () => false,
  );
  const isPointerHover = useSyncExternalStore(
    subscribeTooltipItemInteraction,
    () =>
      registrationId !== undefined && itemId !== null
        ? isTooltipPointerHighlightSlot(registrationId, itemId)
        : false,
    () => false,
  );
  const menuHighlight = React.useMemo(
    () => ({ highlighted: isHighlighted, pointer: isPointerHover }),
    [isHighlighted, isPointerHover],
  );

  if (!registration || !actions) {
    return children;
  }
  const triggerProps =
    item !== null
      ? actions.getTriggerProps(
          registration.registrationId,
          item,
          registration.getItemId,
          registration.openDelayMs,
        )
      : null;

  return (
    <TooltipItemMenuHighlightContext.Provider value={item !== null ? menuHighlight : null}>
      <div
        ref={registerElement}
        data-slot="tooltip-trigger"
        aria-describedby={isAnchor ? tooltipContentId(registration.registrationId) : undefined}
        className={cn("flex w-full min-w-0", className)}
        onPointerEnter={triggerProps?.onPointerEnter}
        onPointerDown={() => {
          if (itemId !== null) {
            actions.onTriggerPointerDown(registration.registrationId, itemId);
          }
        }}
      >
        {children}
      </div>
    </TooltipItemMenuHighlightContext.Provider>
  );
}
TooltipItem.displayName = "TooltipItem";

type TooltipTriggerProps = React.ComponentProps<typeof TooltipPrimitive.Trigger> & {
  item?: TooltipSwitchItem;
};

function TooltipTrigger({
  item: itemProp,
  asChild = false,
  children,
  ref,
  className,
  onPointerEnter: onPointerEnterProp,
  onPointerDown: onPointerDownProp,
  ...props
}: TooltipTriggerProps) {
  const actions = useOptionalTooltipStableActions();
  const registration = useOptionalTooltipRegistrationContext();
  const autoId = React.useId();
  const switchItem = React.useMemo(
    (): TooltipSwitchItem => itemProp ?? { id: autoId },
    [autoId, itemProp],
  );
  const { registerElement, isAnchor, registrationId, itemId } = useTooltipElementRegistration(
    switchItem,
    registration,
    actions,
  );
  const isPointerHover = useSyncExternalStore(
    subscribeTooltipItemInteraction,
    () =>
      registrationId !== undefined && itemId !== null
        ? isTooltipPointerHighlightSlot(registrationId, itemId)
        : false,
    () => false,
  );
  const composedRef = React.useCallback(
    (element: HTMLElement | null) => {
      const unregister = registerElement(element);
      const cleanupForwardedRef = composeElementRef(ref as React.Ref<HTMLElement>, element);
      return () => {
        unregister?.();
        if (typeof cleanupForwardedRef === "function") {
          cleanupForwardedRef();
        } else {
          composeElementRef(ref as React.Ref<HTMLElement>, null);
        }
      };
    },
    [ref, registerElement],
  );

  if (!actions || !registration) {
    return (
      <TooltipPrimitive.Trigger
        ref={ref}
        data-slot="tooltip-trigger"
        asChild={asChild}
        className={className}
        onPointerEnter={onPointerEnterProp}
        onPointerDown={onPointerDownProp}
        {...props}
      >
        {children}
      </TooltipPrimitive.Trigger>
    );
  }

  const { onPointerEnter } = actions.getTriggerProps(
    registration.registrationId,
    switchItem,
    registration.getItemId,
    registration.openDelayMs,
  );
  const Component = asChild ? Slot.Root : "span";
  return (
    <Component
      {...props}
      ref={composedRef}
      data-slot="tooltip-trigger"
      data-pointer-hover={isPointerHover ? "" : undefined}
      aria-describedby={isAnchor ? tooltipContentId(registration.registrationId) : undefined}
      className={cn(!asChild && "inline-flex min-w-0", className)}
      onPointerEnter={(event) => {
        onPointerEnter(event);
        onPointerEnterProp?.(event as React.PointerEvent<HTMLButtonElement>);
      }}
      onPointerDown={(event) => {
        if (itemId !== null) {
          actions.onTriggerPointerDown(registration.registrationId, itemId);
        }
        onPointerDownProp?.(event as React.PointerEvent<HTMLButtonElement>);
      }}
    >
      {children}
    </Component>
  );
}

type TooltipContentProps = Omit<
  React.ComponentProps<typeof TooltipPrimitive.Content>,
  "children"
> & {
  appearance?: TooltipContentAppearance;
  resolveClassName?: (activeItem: unknown) => string | undefined;
  children: React.ReactNode | ((activeItem: unknown) => React.ReactNode);
};

function TooltipContent({
  ref,
  className,
  sideOffset = 0,
  side,
  align,
  collisionPadding,
  appearance = "compact",
  resolveClassName,
  children,
  onEscapeKeyDown,
  onAnimationEnd,
}: TooltipContentProps) {
  void ref;

  const stableRegistration = useTooltipStableRegistration();
  const registration = useTooltipRegistrationContext();
  const { registrationId } = registration;
  const childrenRef = React.useRef(children);
  childrenRef.current = children;
  const resolveClassNameRef = React.useRef(resolveClassName);
  resolveClassNameRef.current = resolveClassName;
  React.useLayoutEffect(() => {
    bumpTooltipContentHostRevision();
  });

  React.useEffect(() => {
    const render = (activeItem: unknown) => {
      const currentChildren = childrenRef.current;
      if (typeof currentChildren === "function") {
        return currentChildren(activeItem ?? null);
      }
      return activeItem ? currentChildren : null;
    };

    stableRegistration.registerContent(registrationId, {
      side,
      sideOffset,
      align,
      collisionPadding,
      appearance,
      className,
      resolveClassName: (activeItem) => resolveClassNameRef.current?.(activeItem),
      onEscapeKeyDown,
      onAnimationEnd,
      render,
    });

    return () => {
      stableRegistration.unregisterContent(registrationId);
    };
  }, [
    align,
    appearance,
    className,
    collisionPadding,
    onAnimationEnd,
    onEscapeKeyDown,
    registrationId,
    side,
    sideOffset,
    stableRegistration,
  ]);

  return null;
}
TooltipContent.displayName = "TooltipContent";

const Tooltip = Object.assign(TooltipRoot, {
  Zone: TooltipZone,
  Item: TooltipItem,
});

export {
  Tooltip,
  TooltipContent,
  TooltipItem,
  TooltipProvider,
  TooltipTrigger,
  TooltipZone,
  useOptionalTooltipGlobalContext,
  useOptionalTooltipStableActions,
};
