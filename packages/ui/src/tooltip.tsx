// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import {
  Children,
  createContext,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { Popover as PopoverPrimitive, Slot, Tooltip as TooltipPrimitive } from "radix-ui";

import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_SHADOW_LG } from "./chrome.js";
import { cn } from "./cn.js";
import {
  bumpTooltipContentHostRevision,
  getTooltipContentHostRevision,
  isTooltipAnchorSlot,
  isTooltipItemHighlighted,
  isTooltipKeyboardInput,
  isTooltipPointerHighlightSlot,
  subscribeTooltipContentHostRevision,
  subscribeTooltipItemInteraction,
} from "./hooks/tooltip-item-interaction-store.js";
import { isEventTargetWithinTooltipCompanionOverlays } from "./hooks/tooltip-switch-registry.js";
import { useGlobalTooltipSwitch } from "./hooks/use-global-tooltip-switch.js";
import {
  UiPortalProvider,
  useUiPortalContainer,
  useUiPortalLocalPoint,
  type UiPortalContainerGetter,
} from "./portal.js";

type TooltipSwitchItem = { id: string };
type TooltipContentAppearance = "compact" | "detail";

type TooltipContentRegistration = {
  side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
  sideOffset?: number;
  align?: ComponentProps<typeof TooltipPrimitive.Content>["align"];
  collisionPadding?: ComponentProps<typeof TooltipPrimitive.Content>["collisionPadding"];
  appearance?: TooltipContentAppearance;
  className?: string;
  resolveClassName?: (activeItem: unknown) => string | undefined;
  onEscapeKeyDown?: ComponentProps<typeof TooltipPrimitive.Content>["onEscapeKeyDown"];
  onAnimationEnd?: ComponentProps<typeof TooltipPrimitive.Content>["onAnimationEnd"];
  render: (activeItem: unknown) => ReactNode;
};

const TOOLTIP_CONTENT_MOTION =
  "origin-(--radix-tooltip-content-transform-origin) data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

const TOOLTIP_CONTENT_COMPACT_CLASS = cn(
  "z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-lg bg-popover px-3 py-1.5 text-xs text-popover-foreground backdrop-blur-sm",
  TOOLTIP_CONTENT_MOTION,
  DESKTOP_OVERLAY_EDGE,
  DESKTOP_OVERLAY_SHADOW_LG,
);

const TOOLTIP_CONTENT_DETAIL_CLASS = cn(
  "z-50 w-auto max-w-none rounded-lg bg-popover text-popover-foreground backdrop-blur-sm",
  TOOLTIP_CONTENT_MOTION,
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

const TooltipGlobalContext = createContext<TooltipGlobalContextValue | null>(null);
const TooltipStableActionsContext = createContext<TooltipStableActionsValue | null>(null);
const TooltipStableRegistrationContext = createContext<TooltipStableRegistrationValue | null>(null);
const TooltipRegistrationContext = createContext<TooltipRegistrationContextValue<unknown> | null>(
  null,
);
const TooltipItemMenuHighlightContext = createContext<{
  highlighted: boolean;
  pointer: boolean;
} | null>(null);

export function useOptionalTooltipItemMenuHighlight() {
  return useContext(TooltipItemMenuHighlightContext);
}

export function useTooltipKeyboardInput(): boolean {
  return useSyncExternalStore(subscribeTooltipItemInteraction, isTooltipKeyboardInput, () => false);
}

function useTooltipGlobalContext(): TooltipGlobalContextValue {
  const value = useContext(TooltipGlobalContext);
  if (!value) {
    throw new Error("Tooltip components must be used within TooltipProvider");
  }
  return value;
}

export function useOptionalTooltipGlobalContext(): TooltipGlobalContextValue | null {
  return useContext(TooltipGlobalContext);
}

function useTooltipStableActions(): TooltipStableActionsValue {
  const value = useContext(TooltipStableActionsContext);
  if (!value) {
    throw new Error("Tooltip components must be used within TooltipProvider");
  }
  return value;
}

export function useOptionalTooltipStableActions(): TooltipStableActionsValue | null {
  return useContext(TooltipStableActionsContext);
}

function useTooltipStableRegistration(): TooltipStableRegistrationValue {
  const value = useContext(TooltipStableRegistrationContext);
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

function useTooltipRegistrationContext<
  TItem = TooltipSwitchItem,
>(): TooltipRegistrationContextValue<TItem> {
  const value = useContext(TooltipRegistrationContext);
  if (!value) {
    throw new Error("Tooltip compound subcomponents must be used within Tooltip");
  }
  return value as TooltipRegistrationContextValue<TItem>;
}

function useOptionalTooltipRegistrationContext<
  TItem = TooltipSwitchItem,
>(): TooltipRegistrationContextValue<TItem> | null {
  return useContext(TooltipRegistrationContext) as TooltipRegistrationContextValue<TItem> | null;
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
    onTriggerZonePointerLeave: (event: ReactPointerEvent<HTMLDivElement>) =>
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
  triggerZoneRef: RefObject<HTMLDivElement | null>;
  onTriggerZonePointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
  contentRef: RefObject<HTMLDivElement | null>;
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
  if (!hasContent || !open) {
    return "closed";
  }
  return openKind === "delayed" ? "delayed-open" : "instant-open";
}

function composeElementRef<T>(forwardedRef: Ref<T> | undefined, node: T | null) {
  if (typeof forwardedRef === "function") {
    return forwardedRef(node);
  }
  if (forwardedRef) {
    forwardedRef.current = node;
  }
}

function tooltipContentId(registrationId: string): string {
  return `spirit-tooltip-${registrationId}`;
}

function GlobalTooltipContentHost() {
  const global = useTooltipGlobalContext();
  const portalContainer = useUiPortalContainer();
  const toLocalPoint = useUiPortalLocalPoint();
  useSyncExternalStore(
    subscribeTooltipContentHostRevision,
    getTooltipContentHostRevision,
    getTooltipContentHostRevision,
  );
  const lastRegistrationIdRef = useRef<string | null>(null);

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
      ? toLocalPoint(lingerExitPosition.top, lingerExitPosition.left)
      : null;

  if (!hasContent || !contentRegistration) {
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
      <PopoverPrimitive.Portal container={portalContainer}>
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
    <PopoverPrimitive.Portal container={portalContainer}>
      <PopoverPrimitive.Content
        ref={global.contentRef}
        id={registrationId ? tooltipContentId(registrationId) : undefined}
        role="tooltip"
        data-slot="tooltip-content"
        data-state={dataState}
        side={contentRegistration.side ?? "top"}
        {...(contentRegistration.align === undefined ? {} : { align: contentRegistration.align })}
        sideOffset={contentRegistration.sideOffset ?? 0}
        {...(contentRegistration.collisionPadding === undefined
          ? {}
          : { collisionPadding: contentRegistration.collisionPadding })}
        className={contentClassName}
        style={
          {
            "--radix-tooltip-content-transform-origin":
              "var(--radix-popover-content-transform-origin)",
          } as CSSProperties
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
        {...(contentRegistration.onAnimationEnd === undefined
          ? {}
          : { onAnimationEnd: contentRegistration.onAnimationEnd })}
        onPointerEnter={global.onContentPointerEnter}
      >
        {renderedChildren}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export function TooltipProvider({
  delayDuration = 300,
  skipDelayDuration = 300,
  disableHoverableContent = false,
  getPortalContainer,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider> & {
  delayDuration?: number;
  getPortalContainer?: UiPortalContainerGetter;
}) {
  const inheritedToLocalPoint = useUiPortalLocalPoint();
  const globalSwitch = useGlobalTooltipSwitch({ defaultOpenDelayMs: delayDuration });
  const contentRegistryRef = useRef(new Map<string, TooltipContentRegistration>());
  const lingerContentRegistryRef = useRef(new Map<string, TooltipContentRegistration>());
  const contentActiveItemRef = useRef(globalSwitch.contentActiveItem);
  contentActiveItemRef.current = globalSwitch.contentActiveItem;
  const onOpenChangeByRegistrationRef = useRef(
    new Map<string, ((open: boolean) => void) | undefined>(),
  );
  const prevOpenByRegistrationRef = useRef(new Map<string, boolean>());

  const registerContent = useCallback(
    (registrationId: string, content: TooltipContentRegistration) => {
      contentRegistryRef.current.set(registrationId, content);
      lingerContentRegistryRef.current.delete(registrationId);
    },
    [],
  );

  const unregisterContent = useCallback((registrationId: string) => {
    const content = contentRegistryRef.current.get(registrationId);
    if (!content) {
      return;
    }
    contentRegistryRef.current.delete(registrationId);
    if (contentActiveItemRef.current !== null) {
      lingerContentRegistryRef.current.set(registrationId, content);
    }
  }, []);

  const getContentRegistration = useCallback((registrationId: string) => {
    return (
      contentRegistryRef.current.get(registrationId) ??
      lingerContentRegistryRef.current.get(registrationId)
    );
  }, []);

  useEffect(() => {
    if (globalSwitch.contentActiveItem === null) {
      lingerContentRegistryRef.current.clear();
    }
  }, [globalSwitch.contentActiveItem]);

  const registerOpenChange = useCallback(
    (registrationId: string, onOpenChange: ((open: boolean) => void) | undefined) => {
      onOpenChangeByRegistrationRef.current.set(registrationId, onOpenChange);
    },
    [],
  );

  const effectiveOpen = globalSwitch.open || globalSwitch.contentActiveItem !== null;

  useEffect(() => {
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

  const globalContextValue = useMemo(
    (): TooltipGlobalContextValue => ({
      ...globalSwitch,
      registerContent,
      unregisterContent,
      getContentRegistration,
      registerOpenChange,
    }),
    [globalSwitch, getContentRegistration, registerContent, registerOpenChange, unregisterContent],
  );

  const globalSwitchRef = useRef(globalSwitch);
  globalSwitchRef.current = globalSwitch;
  const stableActionsValue = useMemo(
    (): TooltipStableActionsValue => ({
      getTriggerProps: (...args) => globalSwitchRef.current.getTriggerProps(...args),
      dismissIfOpen: () => globalSwitchRef.current.dismissIfOpen(),
      dismissActiveItem: () => globalSwitchRef.current.dismissActiveItem(),
      onTriggerPointerDown: (...args) => globalSwitchRef.current.onTriggerPointerDown(...args),
      registerTriggerElement: (...args) => globalSwitchRef.current.registerTriggerElement(...args),
    }),
    [],
  );
  const stableRegistrationValue = useMemo(
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

  const tree = (
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
              <PopoverPrimitive.Anchor virtualRef={globalSwitch.anchorRef} />
              <GlobalTooltipContentHost />
            </PopoverPrimitive.Root>
          </TooltipStableRegistrationContext.Provider>
        </TooltipStableActionsContext.Provider>
      </TooltipGlobalContext.Provider>
    </TooltipPrimitive.Provider>
  );

  if (!getPortalContainer) {
    return tree;
  }

  return (
    <UiPortalProvider getContainer={getPortalContainer} toLocalPoint={inheritedToLocalPoint}>
      {tree}
    </UiPortalProvider>
  );
}

type TooltipProps<TItem> = Omit<
  ComponentProps<typeof TooltipPrimitive.Root>,
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
}: TooltipProps<TItem>) {
  const registrationId = useId();
  const stableRegistration = useTooltipStableRegistration();
  const resolvedGetItemId = useCallback(
    (item: TItem) => (getItemId ? getItemId(item) : (item as TooltipSwitchItem).id),
    [getItemId],
  );

  useEffect(() => {
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

  useEffect(() => {
    return () => {
      stableRegistration.unregisterTriggerZone(registrationId);
      stableRegistration.unregisterContent(registrationId);
      stableRegistration.registerOpenChange(registrationId, undefined);
    };
  }, [registrationId, stableRegistration]);

  const registrationValue = useMemo(
    (): TooltipRegistrationContextValue<TItem> => ({
      registrationId,
      getItemId: resolvedGetItemId,
      openDelayMs: delayDuration,
      ...(onOpenChange === undefined ? {} : { onOpenChange }),
    }),
    [delayDuration, onOpenChange, registrationId, resolvedGetItemId],
  );

  const childArray = Children.toArray(children);
  const hasExplicitZone = childArray.some(
    (child) =>
      isValidElement(child) &&
      (child.type as { displayName?: string }).displayName === TooltipZone.displayName,
  );
  const contentChildren = childArray.filter(
    (child) =>
      isValidElement(child) &&
      (child.type as { displayName?: string }).displayName === TooltipContent.displayName,
  );
  const bodyChildren = childArray.filter((child) => !contentChildren.includes(child));

  return (
    <TooltipRegistrationContext.Provider
      value={registrationValue as TooltipRegistrationContextValue<unknown>}
    >
      {hasExplicitZone ? (
        bodyChildren
      ) : (
        <TooltipZone className="contents">{bodyChildren}</TooltipZone>
      )}
      {contentChildren}
    </TooltipRegistrationContext.Provider>
  );
}

const TooltipZone = memo(function TooltipZone({
  ref,
  className,
  onPointerLeave,
  ...props
}: ComponentProps<"div">) {
  const stableRegistration = useTooltipStableRegistration();
  const { registrationId } = useTooltipRegistrationContext();

  return (
    <div
      data-slot="tooltip-zone"
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
  children: ReactNode;
  className?: string;
};

function useTooltipElementRegistration<TItem>(
  item: TItem | null,
  registration: TooltipRegistrationContextValue<TItem> | null,
  actions: TooltipStableActionsValue | null,
) {
  const itemRef = useRef(item);
  itemRef.current = item;
  const registrationId = registration?.registrationId;
  const itemId = registration && item !== null ? registration.getItemId(item) : null;
  const openDelayMs = registration?.openDelayMs ?? 0;

  const registerElement = useCallback(
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
  const menuHighlight = useMemo(
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
        {...(triggerProps === null ? {} : { onPointerEnter: triggerProps.onPointerEnter })}
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

function TooltipTrigger({
  item: itemProp,
  asChild = false,
  children,
  ref,
  className,
  onPointerEnter: onPointerEnterProp,
  onPointerDown: onPointerDownProp,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Trigger> & {
  item?: TooltipSwitchItem;
}) {
  const actions = useOptionalTooltipStableActions();
  const registration = useOptionalTooltipRegistrationContext();
  const autoId = useId();
  const switchItem = useMemo(
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
  const composedRef = useCallback(
    (element: HTMLElement | null) => {
      const unregister = registerElement(element);
      const cleanupForwardedRef = composeElementRef(ref as Ref<HTMLElement>, element);
      return () => {
        unregister?.();
        if (typeof cleanupForwardedRef === "function") {
          cleanupForwardedRef();
        } else {
          composeElementRef(ref as Ref<HTMLElement>, null);
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
        {...(onPointerEnterProp === undefined ? {} : { onPointerEnter: onPointerEnterProp })}
        {...(onPointerDownProp === undefined ? {} : { onPointerDown: onPointerDownProp })}
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
      onPointerEnter={(event: ReactPointerEvent<HTMLElement>) => {
        onPointerEnter(event);
        onPointerEnterProp?.(event as ReactPointerEvent<HTMLButtonElement>);
      }}
      onPointerDown={(event: ReactPointerEvent<HTMLElement>) => {
        if (itemId !== null) {
          actions.onTriggerPointerDown(registration.registrationId, itemId);
        }
        onPointerDownProp?.(event as ReactPointerEvent<HTMLButtonElement>);
      }}
    >
      {children}
    </Component>
  );
}

function TooltipContent({
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
}: Omit<ComponentProps<typeof TooltipPrimitive.Content>, "children"> & {
  appearance?: TooltipContentAppearance;
  resolveClassName?: (activeItem: unknown) => string | undefined;
  children: ReactNode | ((activeItem: unknown) => ReactNode);
}) {
  const stableRegistration = useTooltipStableRegistration();
  const { registrationId } = useTooltipRegistrationContext();
  const childrenRef = useRef(children);
  childrenRef.current = children;
  const resolveClassNameRef = useRef(resolveClassName);
  resolveClassNameRef.current = resolveClassName;
  useLayoutEffect(() => {
    bumpTooltipContentHostRevision();
  });

  useEffect(() => {
    const render = (activeItem: unknown) => {
      const currentChildren = childrenRef.current;
      if (typeof currentChildren === "function") {
        return currentChildren(activeItem ?? null);
      }
      return activeItem ? currentChildren : null;
    };

    stableRegistration.registerContent(registrationId, {
      ...(side === undefined ? {} : { side }),
      sideOffset,
      ...(align === undefined ? {} : { align }),
      ...(collisionPadding === undefined ? {} : { collisionPadding }),
      appearance,
      ...(className === undefined ? {} : { className }),
      resolveClassName: (activeItem) => resolveClassNameRef.current?.(activeItem),
      ...(onEscapeKeyDown === undefined ? {} : { onEscapeKeyDown }),
      ...(onAnimationEnd === undefined ? {} : { onAnimationEnd }),
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

export { Tooltip, TooltipContent, TooltipItem, TooltipTrigger, TooltipZone };
