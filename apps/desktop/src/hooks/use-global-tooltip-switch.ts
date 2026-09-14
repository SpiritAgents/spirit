import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  clearTooltipItemInteractionSlots,
  isTooltipAnchorSlot,
  isTooltipItemHighlighted,
  setTooltipActiveHighlightSlot,
  setTooltipAnchorSlot,
  setTooltipKeyboardInput,
  setTooltipPointerHighlightSlot,
} from "@/hooks/tooltip-item-interaction-store";
import {
  DEFAULT_ANCHORED_ITEM_SWITCH_ANCHOR_LINGER_MS,
  DEFAULT_ANCHORED_ITEM_SWITCH_CLOSE_DELAY_MS,
  DEFAULT_ANCHORED_ITEM_SWITCH_OPEN_DELAY_MS,
  type AnchoredItemSwitchTriggerProps,
} from "@/hooks/use-anchored-item-switch";
import {
  GlobalTooltipSwitchStateModel,
  TOOLTIP_SWITCH_CONTENT_LINGER_MS,
  isEventTargetWithinTooltipCompanionOverlays,
  isPointerOverTooltipCompanionOverlays,
  tooltipSwitchSlotKey,
  tooltipSwitchSlotsEqual,
  type TooltipSwitchSlotKey,
} from "@/hooks/tooltip-switch-registry";

export type TooltipSwitchOpenKind = "closed" | "delayed" | "instant";

export type UseGlobalTooltipSwitchOptions = {
  defaultOpenDelayMs?: number;
  defaultCloseDelayMs?: number;
  defaultAnchorLingerMs?: number;
};

export type TooltipLingerAnchorScreenRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type TooltipLingerContentScreenRect = {
  top: number;
  left: number;
};

export type TooltipTriggerRegistration = {
  registrationId: string;
  itemId: string | null;
  getItem: () => unknown | null;
  openDelayMs: number;
};

type PointerTarget = TooltipTriggerRegistration & { element: HTMLElement };
type RegistrationTiming = {
  closeDelayMs?: number;
  anchorLingerMs?: number;
  disableHoverableContent?: boolean;
  disabled?: boolean;
};
type ClientPoint = { clientX: number; clientY: number };

export type UseGlobalTooltipSwitchResult = {
  open: boolean;
  openKind: TooltipSwitchOpenKind;
  anchorSlot: TooltipSwitchSlotKey | null;
  anchorRef: RefObject<HTMLElement | null>;
  contentActiveItem: unknown | null;
  activeRegistrationId: string | null;
  contentRef: RefObject<HTMLDivElement | null>;
  registerTriggerZone: (registrationId: string, zone: HTMLDivElement | null) => void;
  unregisterTriggerZone: (registrationId: string) => void;
  registerTriggerElement: (
    element: HTMLElement,
    registration: TooltipTriggerRegistration,
  ) => () => void;
  setRegistrationTiming: (registrationId: string, timing: RegistrationTiming) => void;
  getTriggerProps: <TItem>(
    registrationId: string,
    item: TItem,
    getItemId: (item: TItem) => string,
    openDelayMs: number,
  ) => AnchoredItemSwitchTriggerProps;
  onTriggerZonePointerLeave: (
    registrationId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  dismissActiveItem: () => void;
  dismissIfOpen: () => void;
  onTriggerPointerDown: (registrationId: string, itemId: string) => void;
  isRegistrationHoverableContent: (registrationId: string | null) => boolean;
  isAnchorSlot: (registrationId: string, itemId: string) => boolean;
  onContentPointerEnter: () => void;
  lingerAnchorScreenRect: TooltipLingerAnchorScreenRect | null;
  lingerContentScreenRect: TooltipLingerContentScreenRect | null;
};

export function useGlobalTooltipSwitch({
  defaultOpenDelayMs = DEFAULT_ANCHORED_ITEM_SWITCH_OPEN_DELAY_MS,
  defaultCloseDelayMs = DEFAULT_ANCHORED_ITEM_SWITCH_CLOSE_DELAY_MS,
  defaultAnchorLingerMs = DEFAULT_ANCHORED_ITEM_SWITCH_ANCHOR_LINGER_MS,
}: UseGlobalTooltipSwitchOptions = {}): UseGlobalTooltipSwitchResult {
  const [activeSlot, setActiveSlot] = useState<TooltipSwitchSlotKey | null>(null);
  const [activeItem, setActiveItem] = useState<unknown | null>(null);
  const [lingerAnchorSlot, setLingerAnchorSlot] = useState<TooltipSwitchSlotKey | null>(null);
  const [lingerActiveItem, setLingerActiveItem] = useState<unknown | null>(null);
  const [openKind, setOpenKind] = useState<TooltipSwitchOpenKind>("closed");
  const [lingerAnchorScreenRect, setLingerAnchorScreenRect] =
    useState<TooltipLingerAnchorScreenRect | null>(null);
  const [lingerContentScreenRect, setLingerContentScreenRect] =
    useState<TooltipLingerContentScreenRect | null>(null);

  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lingerClearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lingerContentClearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeItemRef = useRef<unknown | null>(null);
  const activeSlotRef = useRef<TooltipSwitchSlotKey | null>(null);
  const pointerSlotRef = useRef<TooltipSwitchSlotKey | null>(null);
  const pendingTargetRef = useRef<{ target: PointerTarget; ready: boolean } | null>(null);
  const lingerActiveItemRef = useRef<unknown | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerElementsRef = useRef(new Map<HTMLElement, TooltipTriggerRegistration>());
  const triggerZonesRef = useRef(new Map<string, HTMLDivElement>());
  const timingRef = useRef(new Map<string, RegistrationTiming>());
  const pointerDismissedRegistrationsRef = useRef(new Set<string>());
  const pointerRef = useRef<ClientPoint | null>(null);
  const keyboardInputRef = useRef(false);
  const reconcileFrameRef = useRef<number | null>(null);
  const reconcileRef = useRef<() => void>(() => {});

  const schedulePointerReconcile = useCallback(() => {
    if (
      reconcileFrameRef.current !== null ||
      (!activeSlotRef.current && (!pointerRef.current || keyboardInputRef.current))
    ) {
      return;
    }
    reconcileFrameRef.current = requestAnimationFrame(() => {
      reconcileFrameRef.current = null;
      reconcileRef.current();
    });
  }, []);

  const clearHoverOpenTimer = useCallback(() => {
    if (hoverOpenTimerRef.current !== undefined) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = undefined;
    }
    pendingTargetRef.current = null;
  }, []);

  const clearHoverCloseTimer = useCallback(() => {
    if (hoverCloseTimerRef.current !== undefined) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = undefined;
    }
  }, []);

  const clearPointerHighlight = useCallback(() => {
    pointerSlotRef.current = null;
    setTooltipPointerHighlightSlot(null);
    setTooltipActiveHighlightSlot(null);
  }, []);

  const clearLinger = useCallback(() => {
    if (lingerClearTimerRef.current !== undefined) {
      clearTimeout(lingerClearTimerRef.current);
      lingerClearTimerRef.current = undefined;
    }
    if (lingerContentClearTimerRef.current !== undefined) {
      clearTimeout(lingerContentClearTimerRef.current);
      lingerContentClearTimerRef.current = undefined;
    }
    lingerActiveItemRef.current = null;
    setLingerAnchorSlot(null);
    setLingerActiveItem(null);
    setLingerAnchorScreenRect(null);
    setLingerContentScreenRect(null);
  }, []);

  const commitClose = useCallback(() => {
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    clearPointerHighlight();
    const closingSlot = activeSlotRef.current;
    if (!closingSlot) {
      return;
    }
    const closingItem = activeItemRef.current;
    const anchorRect = anchorRef.current?.isConnected
      ? anchorRef.current.getBoundingClientRect()
      : null;
    const contentRect = contentRef.current?.getBoundingClientRect();
    setLingerAnchorScreenRect(
      anchorRect
        ? {
            top: anchorRect.top,
            left: anchorRect.left,
            width: anchorRect.width,
            height: anchorRect.height,
          }
        : null,
    );
    setLingerContentScreenRect(
      contentRect ? { top: contentRect.top, left: contentRect.left } : null,
    );
    activeSlotRef.current = null;
    activeItemRef.current = null;
    lingerActiveItemRef.current = closingItem;
    setActiveSlot(null);
    setActiveItem(null);
    setLingerAnchorSlot(closingSlot);
    setLingerActiveItem(closingItem);
    setOpenKind("closed");
    setTooltipAnchorSlot(closingSlot);

    const anchorLingerMs =
      timingRef.current.get(closingSlot.registrationId)?.anchorLingerMs ?? defaultAnchorLingerMs;
    lingerClearTimerRef.current = setTimeout(() => {
      lingerClearTimerRef.current = undefined;
      anchorRef.current = null;
      setLingerAnchorSlot(null);
      setLingerAnchorScreenRect(null);
      setTooltipAnchorSlot(null);
    }, anchorLingerMs);
    lingerContentClearTimerRef.current = setTimeout(() => {
      lingerContentClearTimerRef.current = undefined;
      lingerActiveItemRef.current = null;
      setLingerActiveItem(null);
      setLingerContentScreenRect(null);
    }, TOOLTIP_SWITCH_CONTENT_LINGER_MS);
  }, [clearHoverCloseTimer, clearHoverOpenTimer, clearPointerHighlight, defaultAnchorLingerMs]);

  const scheduleHoverClose = useCallback(() => {
    clearHoverOpenTimer();
    if (!activeSlotRef.current || hoverCloseTimerRef.current !== undefined) {
      return;
    }
    const closeDelayMs =
      timingRef.current.get(activeSlotRef.current.registrationId)?.closeDelayMs ??
      defaultCloseDelayMs;
    hoverCloseTimerRef.current = setTimeout(commitClose, closeDelayMs);
  }, [clearHoverOpenTimer, commitClose, defaultCloseDelayMs]);

  const isRegistrationHoverableContent = useCallback((registrationId: string | null) => {
    return !registrationId || !timingRef.current.get(registrationId)?.disableHoverableContent;
  }, []);

  const activateTarget = useCallback(
    (target: PointerTarget & { itemId: string }, item: unknown, kind: TooltipSwitchOpenKind) => {
      const slot = tooltipSwitchSlotKey(target.registrationId, target.itemId);
      clearLinger();
      anchorRef.current = target.element;
      activeSlotRef.current = slot;
      activeItemRef.current = item;
      setActiveSlot(slot);
      setActiveItem(item);
      setOpenKind(kind);
      setTooltipAnchorSlot(slot);
      setTooltipActiveHighlightSlot(slot);
    },
    [clearLinger],
  );

  const enterTarget = useCallback(
    (target: PointerTarget) => {
      const item = target.getItem();
      if (
        target.itemId === null ||
        item === null ||
        timingRef.current.get(target.registrationId)?.disabled ||
        pointerDismissedRegistrationsRef.current.has(target.registrationId)
      ) {
        clearPointerHighlight();
        scheduleHoverClose();
        return;
      }
      const resolvedTarget = { ...target, itemId: target.itemId };
      const slot = tooltipSwitchSlotKey(target.registrationId, target.itemId);
      pointerSlotRef.current = slot;
      setTooltipPointerHighlightSlot(slot);
      clearHoverCloseTimer();
      if (
        tooltipSwitchSlotsEqual(activeSlotRef.current, slot) &&
        anchorRef.current === target.element
      ) {
        return;
      }
      if (activeItemRef.current !== null || lingerActiveItemRef.current !== null) {
        clearHoverOpenTimer();
        activateTarget(resolvedTarget, item, "instant");
        return;
      }
      const pending = pendingTargetRef.current;
      if (
        pending?.target.element === target.element &&
        pending.target.registrationId === target.registrationId &&
        pending.target.itemId === target.itemId
      ) {
        if (pending.ready) {
          clearHoverOpenTimer();
          activateTarget(resolvedTarget, item, "delayed");
        }
        return;
      }
      clearHoverOpenTimer();
      if (target.openDelayMs === 0) {
        activateTarget(resolvedTarget, item, "delayed");
        return;
      }
      const nextPending = { target, ready: false };
      pendingTargetRef.current = nextPending;
      hoverOpenTimerRef.current = setTimeout(() => {
        hoverOpenTimerRef.current = undefined;
        nextPending.ready = true;
        schedulePointerReconcile();
      }, target.openDelayMs ?? defaultOpenDelayMs);
    },
    [
      activateTarget,
      clearHoverCloseTimer,
      clearHoverOpenTimer,
      clearPointerHighlight,
      defaultOpenDelayMs,
      scheduleHoverClose,
      schedulePointerReconcile,
    ],
  );

  const reconcilePointer = useCallback(() => {
    const active = activeSlotRef.current;
    const anchor = anchorRef.current;
    const anchorRegistration = anchor ? triggerElementsRef.current.get(anchor) : undefined;
    // A virtualized or filtered-out source can disappear while its detail is hovered.
    if (
      active &&
      (!anchor?.isConnected ||
        anchorRegistration?.registrationId !== active.registrationId ||
        anchorRegistration.itemId !== active.itemId)
    ) {
      commitClose();
    }
    const point = pointerRef.current;
    if (!point || keyboardInputRef.current) {
      return;
    }
    // Scrolling can move a different row under a stationary pointer before boundary
    // events arrive. Native hit-testing also respects clipping, portals and UI scale.
    const hit = document.elementFromPoint(point.clientX, point.clientY);
    for (const registrationId of pointerDismissedRegistrationsRef.current) {
      if (!hit || !triggerZonesRef.current.get(registrationId)?.contains(hit)) {
        pointerDismissedRegistrationsRef.current.delete(registrationId);
      }
    }
    let element: Element | null = hit;
    while (element) {
      const registration = triggerElementsRef.current.get(element as HTMLElement);
      if (registration) {
        enterTarget({ ...registration, element: element as HTMLElement });
        return;
      }
      element = element.parentElement;
    }
    pointerSlotRef.current = null;
    setTooltipPointerHighlightSlot(null);
    const currentActive = activeSlotRef.current;
    if (
      currentActive &&
      isRegistrationHoverableContent(currentActive.registrationId) &&
      (contentRef.current?.contains(hit) ||
        isPointerOverTooltipCompanionOverlays(point.clientX, point.clientY))
    ) {
      clearHoverOpenTimer();
      clearHoverCloseTimer();
      setTooltipActiveHighlightSlot(currentActive);
      return;
    }
    setTooltipActiveHighlightSlot(null);
    scheduleHoverClose();
  }, [
    clearHoverCloseTimer,
    clearHoverOpenTimer,
    commitClose,
    enterTarget,
    isRegistrationHoverableContent,
    scheduleHoverClose,
  ]);
  reconcileRef.current = reconcilePointer;

  const recordPointer = useCallback(
    (event: ClientPoint & { pointerType?: string }, explicitPointerInput = false) => {
      if (event.pointerType === "touch") {
        pointerRef.current = null;
        commitClose();
        return;
      }
      const previous = pointerRef.current;
      const moved =
        !previous || previous.clientX !== event.clientX || previous.clientY !== event.clientY;
      pointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      // Keyboard scrolling may itself cause boundary events at unchanged coordinates.
      if (moved || explicitPointerInput) {
        keyboardInputRef.current = false;
        setTooltipKeyboardInput(false);
      }
      schedulePointerReconcile();
    },
    [commitClose, schedulePointerReconcile],
  );

  const registerTriggerElement = useCallback(
    (element: HTMLElement, registration: TooltipTriggerRegistration) => {
      triggerElementsRef.current.set(element, registration);
      schedulePointerReconcile();
      return () => {
        if (triggerElementsRef.current.get(element) === registration) {
          triggerElementsRef.current.delete(element);
          schedulePointerReconcile();
        }
      };
    },
    [schedulePointerReconcile],
  );

  const registerTriggerZone = useCallback((registrationId: string, zone: HTMLDivElement | null) => {
    if (zone) {
      triggerZonesRef.current.set(registrationId, zone);
    } else {
      triggerZonesRef.current.delete(registrationId);
    }
  }, []);

  const unregisterTriggerZone = useCallback(
    (registrationId: string) => {
      triggerZonesRef.current.delete(registrationId);
      timingRef.current.delete(registrationId);
      pointerDismissedRegistrationsRef.current.delete(registrationId);
      schedulePointerReconcile();
    },
    [schedulePointerReconcile],
  );

  const setRegistrationTiming = useCallback(
    (registrationId: string, timing: RegistrationTiming) => {
      timingRef.current.set(registrationId, timing);
      schedulePointerReconcile();
    },
    [schedulePointerReconcile],
  );

  const getTriggerProps = useCallback(
    <TItem>(
      registrationId: string,
      item: TItem,
      getItemId: (item: TItem) => string,
      _openDelayMs: number,
    ): AnchoredItemSwitchTriggerProps => {
      const itemId = getItemId(item);
      return {
        onPointerEnter: (event?: ReactPointerEvent) => {
          if (event) {
            recordPointer(event);
          } else {
            schedulePointerReconcile();
          }
        },
        isHighlighted: isTooltipItemHighlighted(registrationId, itemId),
        isAnchor: isTooltipAnchorSlot(registrationId, itemId),
      };
    },
    [recordPointer, schedulePointerReconcile],
  );

  const onTriggerZonePointerLeave = useCallback(
    (_registrationId: string, _event: ReactPointerEvent<HTMLDivElement>) => {
      schedulePointerReconcile();
    },
    [schedulePointerReconcile],
  );

  const onTriggerPointerDown = useCallback(
    (registrationId: string, _itemId: string) => {
      pointerDismissedRegistrationsRef.current.add(registrationId);
      commitClose();
    },
    [commitClose],
  );

  const onContentPointerEnter = useCallback(() => {
    const active = activeSlotRef.current;
    if (active && isRegistrationHoverableContent(active.registrationId)) {
      clearHoverCloseTimer();
      setTooltipActiveHighlightSlot(active);
    }
  }, [clearHoverCloseTimer, isRegistrationHoverableContent]);

  useEffect(() => {
    const handlePointer = (event: PointerEvent) => recordPointer(event);
    const handleWheel = (event: WheelEvent) => recordPointer(event, true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
        return;
      }
      keyboardInputRef.current = true;
      setTooltipKeyboardInput(true);
      if (isEventTargetWithinTooltipCompanionOverlays(event.target)) {
        clearHoverOpenTimer();
      } else {
        commitClose();
      }
    };
    const handlePointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) {
        pointerRef.current = null;
        pointerDismissedRegistrationsRef.current.clear();
        clearPointerHighlight();
        scheduleHoverClose();
      }
    };
    const handleWindowBlur = () => {
      pointerRef.current = null;
      pointerDismissedRegistrationsRef.current.clear();
      commitClose();
    };
    document.addEventListener("pointermove", handlePointer, true);
    document.addEventListener("pointerover", handlePointer, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("wheel", handleWheel, { capture: true, passive: true });
    document.addEventListener("scroll", schedulePointerReconcile, { capture: true, passive: true });
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("pointermove", handlePointer, true);
      document.removeEventListener("pointerover", handlePointer, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("wheel", handleWheel, true);
      document.removeEventListener("scroll", schedulePointerReconcile, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    clearHoverOpenTimer,
    clearPointerHighlight,
    commitClose,
    recordPointer,
    scheduleHoverClose,
    schedulePointerReconcile,
  ]);

  useEffect(() => {
    return () => {
      clearHoverOpenTimer();
      clearHoverCloseTimer();
      if (lingerClearTimerRef.current !== undefined) {
        clearTimeout(lingerClearTimerRef.current);
      }
      if (lingerContentClearTimerRef.current !== undefined) {
        clearTimeout(lingerContentClearTimerRef.current);
      }
      if (reconcileFrameRef.current !== null) {
        cancelAnimationFrame(reconcileFrameRef.current);
        reconcileFrameRef.current = null;
      }
      clearTooltipItemInteractionSlots();
    };
  }, [clearHoverCloseTimer, clearHoverOpenTimer]);

  const model = useMemo(() => {
    const next = new GlobalTooltipSwitchStateModel();
    next.activeSlot = activeSlot;
    next.activeItem = activeItem;
    next.lingerAnchorSlot = lingerAnchorSlot;
    next.lingerActiveItem = lingerActiveItem;
    return next;
  }, [activeItem, activeSlot, lingerActiveItem, lingerAnchorSlot]);

  return {
    open: model.open,
    openKind,
    anchorSlot: model.anchorSlot,
    anchorRef,
    contentActiveItem: model.contentActiveItem,
    activeRegistrationId: activeSlot?.registrationId ?? null,
    contentRef,
    registerTriggerZone,
    unregisterTriggerZone,
    registerTriggerElement,
    setRegistrationTiming,
    getTriggerProps,
    onTriggerZonePointerLeave,
    dismissActiveItem: commitClose,
    dismissIfOpen: commitClose,
    onTriggerPointerDown,
    isRegistrationHoverableContent,
    isAnchorSlot: isTooltipAnchorSlot,
    onContentPointerEnter,
    lingerAnchorScreenRect,
    lingerContentScreenRect,
  };
}
