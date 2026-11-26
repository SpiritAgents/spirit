/** @vitest-environment jsdom */

import "./setup";

import { act, render } from "@testing-library/react";
import { useCallback, useLayoutEffect, useRef, type ComponentRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ScrollArea } from "@/components/ui/scroll-area";
import {
  useConversationSendTopScroll,
  type SendTopAnchorResolver,
  type UseConversationSendTopScrollResult,
} from "@/hooks/useConversationSendTopScroll";
import {
  useConversationStreamScrollTail,
  type UseConversationStreamScrollTailResult,
} from "@/hooks/useConversationStreamScrollTail";
import { buildConversationRenderItems } from "@/lib/conversation-process-groups";
import {
  computeSendTopCompensationPx,
  computeSendTopTargetScrollTop,
  findLastActiveUserMessage,
} from "@/lib/conversation-send-scroll";
import type { ConversationMessageSnapshot } from "@/types";

type ResizeCallback = () => void;

let resizeCallbacks: ResizeCallback[] = [];
let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;
let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextRafId = 1;
let nowMs = 1000;

beforeEach(() => {
  resizeCallbacks = [];
  rafQueue = [];
  nextRafId = 1;
  nowMs = 1000;
  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class MockResizeObserver {
    private readonly cb: ResizeCallback;
    constructor(cb: ResizeCallback) {
      this.cb = cb;
      resizeCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      resizeCallbacks = resizeCallbacks.filter((item) => item !== this.cb);
    }
  } as unknown as typeof ResizeObserver;

  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    const id = nextRafId++;
    rafQueue.push({ id, cb });
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    rafQueue = rafQueue.filter((item) => item.id !== id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  }
});

function stepRaf(deltaMs: number) {
  nowMs += deltaMs;
  const batch = rafQueue.splice(0, rafQueue.length);
  for (const item of batch) {
    item.cb(nowMs);
  }
}

function triggerResizeObservers() {
  for (const cb of resizeCallbacks.slice()) {
    cb();
  }
}

function makeMessage(
  id: number,
  role: "user" | "assistant",
  content: string,
  extra?: Partial<ConversationMessageSnapshot>,
): ConversationMessageSnapshot {
  return {
    id,
    role,
    content,
    ...extra,
  };
}

type MockViewportController = {
  viewport: HTMLDivElement;
  spacer: HTMLDivElement;
  setBaseListHeight: (height: number) => void;
  getBaseListHeight: () => number;
  setScrollTop: (top: number, options?: { fireScroll?: boolean }) => void;
  getCompPx: () => number;
};

function attachMockLayout(
  viewport: HTMLDivElement,
  spacer: HTMLDivElement,
  initial: { clientHeight: number; baseListHeight: number; bedPaddingPx: number },
): MockViewportController {
  let clientHeight = initial.clientHeight;
  let baseListHeight = initial.baseListHeight;
  const bedPaddingPx = initial.bedPaddingPx;
  let scrollTop = 0;

  const getSpacerHeight = () => Number.parseFloat(spacer.style.height) || 0;
  const getScrollHeight = () =>
    Math.max(clientHeight, Math.round(baseListHeight + getSpacerHeight() + bedPaddingPx));

  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
    set: (v: number) => {
      clientHeight = v;
    },
  });
  Object.defineProperty(viewport, "clientWidth", {
    configurable: true,
    value: 1200,
  });
  Object.defineProperty(viewport, "scrollHeight", {
    configurable: true,
    get: getScrollHeight,
  });
  Object.defineProperty(viewport, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      const maxTop = Math.max(0, getScrollHeight() - clientHeight);
      scrollTop = Math.max(0, Math.min(v, maxTop));
    },
  });
  Object.defineProperty(spacer, "offsetTop", {
    configurable: true,
    get: () => baseListHeight,
  });

  viewport.getBoundingClientRect = () =>
    ({
      top: 75,
      bottom: 75 + clientHeight,
      left: 0,
      right: 1200,
      width: 1200,
      height: clientHeight,
      x: 0,
      y: 75,
      toJSON: () => ({}),
    }) as DOMRect;

  spacer.getBoundingClientRect = () =>
    ({
      top: 75 + baseListHeight - scrollTop,
      bottom: 75 + baseListHeight - scrollTop + getSpacerHeight(),
      left: 0,
      right: 1200,
      width: 1200,
      height: getSpacerHeight(),
      x: 0,
      y: 75 + baseListHeight - scrollTop,
      toJSON: () => ({}),
    }) as DOMRect;

  return {
    viewport,
    spacer,
    setBaseListHeight(next: number) {
      baseListHeight = next;
      const maxTop = Math.max(0, getScrollHeight() - clientHeight);
      if (scrollTop > maxTop) {
        scrollTop = maxTop;
      }
    },
    getBaseListHeight: () => baseListHeight,
    setScrollTop(top: number, options?: { fireScroll?: boolean }) {
      const maxTop = Math.max(0, getScrollHeight() - clientHeight);
      scrollTop = Math.max(0, Math.min(top, maxTop));
      if (options?.fireScroll !== false) {
        viewport.dispatchEvent(new Event("scroll"));
      }
    },
    getCompPx: () => getSpacerHeight(),
  };
}

function Harness({
  messages,
  contentKey,
  isBusy,
  enabled,
  bedPaddingPx = 186,
  anchorResolver,
  onRefs,
}: {
  messages: readonly ConversationMessageSnapshot[];
  contentKey: string;
  isBusy: boolean;
  enabled: boolean;
  bedPaddingPx?: number;
  anchorResolver: SendTopAnchorResolver;
  onRefs: (state: {
    sendTop: UseConversationSendTopScrollResult;
    streamTail: UseConversationStreamScrollTailResult;
    viewport: HTMLDivElement;
    spacer: HTMLDivElement;
  }) => void;
}) {
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea> | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const renderItems = buildConversationRenderItems(messages, "main");
  const enterSendTopTurnRef = useRef<(() => void) | null>(null);
  const releaseTailFollowRef = useRef<(() => void) | null>(null);
  const syncScrollToBottomVisibilityRef = useRef<(() => void) | null>(null);

  const sendTop = useConversationSendTopScroll({
    scrollAreaRef,
    spacerRef,
    messages,
    conversationRenderItems: renderItems,
    contentKey,
    bedPaddingPx,
    isBusy,
    enabled,
    onActivateSendTopTurn: useCallback(() => {
      enterSendTopTurnRef.current?.();
    }, []),
    onInterruptAnimation: useCallback(() => {
      releaseTailFollowRef.current?.();
    }, []),
    onStateChange: useCallback(() => {
      syncScrollToBottomVisibilityRef.current?.();
    }, []),
  });

  const streamTail = useConversationStreamScrollTail({
    scrollAreaRef,
    messages,
    pendingAuxState: undefined,
    isBusy,
    scrollBedPaddingPx: bedPaddingPx,
    enabled,
    contentKey,
    sendTopTriggerNonce: sendTop.sendTopTriggerNonce,
    isSendTopBlockingTail: sendTop.isSendTopBlockingTail,
    onForceStickToBottom: sendTop.cancelSendTop,
  });

  useLayoutEffect(() => {
    enterSendTopTurnRef.current = streamTail.enterSendTopTurn;
    releaseTailFollowRef.current = streamTail.releaseTailFollow;
    syncScrollToBottomVisibilityRef.current = streamTail.syncScrollToBottomVisibility;
  }, [
    streamTail.enterSendTopTurn,
    streamTail.releaseTailFollow,
    streamTail.syncScrollToBottomVisibility,
  ]);

  const { registerAnchorResolver } = sendTop;
  useLayoutEffect(() => {
    registerAnchorResolver(anchorResolver);
    return () => registerAnchorResolver(null);
  }, [anchorResolver, registerAnchorResolver]);

  useLayoutEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport && spacerRef.current) {
      onRefs({ sendTop, streamTail, viewport, spacer: spacerRef.current });
    }
  });

  return (
    <div
      ref={(node) => {
        scrollAreaRef.current = node as ComponentRef<typeof ScrollArea> | null;
      }}
    >
      <div data-radix-scroll-area-viewport="">
        <div>
          <div data-testid="list" />
          <div ref={spacerRef} data-spirit-surface="conversation-send-spacer" />
        </div>
      </div>
    </div>
  );
}

test("findLastActiveUserMessage disambiguates duplicate messageId shared with assistant-thinking rows", () => {
  const messages: ConversationMessageSnapshot[] = [
    makeMessage(1, "user", "First"),
    makeMessage(3, "assistant", "", { aux: { thinking: "Thought" } }),
    makeMessage(2, "assistant", "Hello"),
    makeMessage(3, "user", "Second"),
  ];
  const renderItems = buildConversationRenderItems(messages, "main");
  const match = findLastActiveUserMessage(messages, renderItems);

  expect(match).toEqual({
    key: "3@3",
    messageIndex: 3,
    messageId: 3,
    renderIndex: 3,
  });
});

test("pure send-top geometry helpers compute exact target scrollTop and compensation", () => {
  expect(
    computeSendTopTargetScrollTop({
      bubbleTopPx: 217,
      scrollMarginPx: 28,
      rowGapBeforePx: 24,
    }),
  ).toBe(193);

  expect(
    computeSendTopCompensationPx({
      ceilingScrollTop: 193,
      viewportHeight: 883,
      baseContentHeight: 513,
    }),
  ).toBe(563);

  expect(
    computeSendTopCompensationPx({
      ceilingScrollTop: 193,
      viewportHeight: 883,
      baseContentHeight: 1200,
    }),
  ).toBe(0);
});

test("empty session first send does not trigger compensation or scroll-to-top", () => {
  let refs!: {
    sendTop: UseConversationSendTopScrollResult;
    streamTail: UseConversationStreamScrollTailResult;
    viewport: HTMLDivElement;
    spacer: HTMLDivElement;
  };
  let mock!: MockViewportController;

  const resolver: SendTopAnchorResolver = () => ({
    targetScrollTop: 0,
    renderIndex: 0,
    exactDom: true,
  });

  const { rerender } = render(
    <Harness
      messages={[]}
      contentKey="__no-session__:main:e0"
      isBusy={false}
      enabled={false}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
        if (!mock) {
          mock = attachMockLayout(r.viewport, r.spacer, {
            clientHeight: 883,
            baseListHeight: 0,
            bedPaddingPx: 186,
          });
        }
      }}
    />,
  );

  // First message arrives from empty session -> enabled flips false -> true.
  mock.setBaseListHeight(67);
  rerender(
    <Harness
      messages={[makeMessage(1, "user", "First message")]}
      contentKey="session-1:main:e0"
      isBusy={true}
      enabled={true}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
      }}
    />,
  );

  expect(refs.sendTop.sendTopTriggerNonce).toBe(0);
  expect(mock.getCompPx()).toBe(0);
  expect(mock.viewport.scrollTop).toBe(0);
  expect(refs.streamTail.followingTail).toBe(true);
});

test("existing session send smoothly pins user bubble, offsets streaming growth to 0, shrinks irreversibly on upward scroll, and re-triggers on consecutive sends", () => {
  let refs!: {
    sendTop: UseConversationSendTopScrollResult;
    streamTail: UseConversationStreamScrollTailResult;
    viewport: HTMLDivElement;
    spacer: HTMLDivElement;
  };
  let mock!: MockViewportController;

  const anchorTargets = new Map<number, { targetScrollTop: number; renderIndex: number }>([
    [3, { targetScrollTop: 193, renderIndex: 3 }],
    [6, { targetScrollTop: 1200, renderIndex: 6 }],
  ]);

  const resolver: SendTopAnchorResolver = (anchor) => {
    const entry = anchorTargets.get(anchor.messageIndex);
    return entry ? { ...entry, exactDom: true } : null;
  };

  const initialMessages = [
    makeMessage(1, "user", "First"),
    makeMessage(3, "assistant", "", { aux: { thinking: "T1" } }),
    makeMessage(2, "assistant", "Ready."),
  ];

  const { rerender } = render(
    <Harness
      messages={initialMessages}
      contentKey="session-1:main:e0"
      isBusy={false}
      enabled={true}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
        if (!mock) {
          mock = attachMockLayout(r.viewport, r.spacer, {
            clientHeight: 883,
            baseListHeight: 193,
            bedPaddingPx: 186,
          });
        }
      }}
    />,
  );

  // Send message #2 in the existing session (with colliding messageId=3 at messageIndex=3).
  mock.setBaseListHeight(280);
  const turn2Messages = [...initialMessages, makeMessage(3, "user", "Second message")];
  rerender(
    <Harness
      messages={turn2Messages}
      contentKey="session-1:main:e0"
      isBusy={true}
      enabled={true}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
      }}
    />,
  );

  expect(refs.sendTop.sendTopTriggerNonce).toBe(1);
  // Required compensation: (193 + 883) - (280 + 186) = 610px.
  expect(mock.getCompPx()).toBe(610);
  // Tail-follow remains armed (for once compensation is consumed) while blocked during send-top.
  expect(refs.streamTail.followingTail).toBe(true);
  expect(refs.streamTail.showScrollToBottom).toBe(false);

  // Advance smooth animation to completion (~271ms duration for 193px distance).
  act(() => {
    stepRaf(100);
  });
  expect(mock.viewport.scrollTop).toBeGreaterThan(0);
  expect(mock.viewport.scrollTop).toBeLessThan(193);

  act(() => {
    stepRaf(300);
  });
  expect(mock.viewport.scrollTop).toBe(193);
  expect(mock.getCompPx()).toBe(610);
  expect(refs.streamTail.showScrollToBottom).toBe(false);

  // Agent reply streams +300px -> compensation shrinks by 300px, scrollTop stays locked at 193.
  act(() => {
    mock.setBaseListHeight(580);
    refs.sendTop.syncSendTopLayout();
    refs.streamTail.pinScrollToTail();
    triggerResizeObservers();
  });
  expect(mock.getCompPx()).toBe(310);
  expect(mock.viewport.scrollTop).toBe(193);
  expect(refs.streamTail.showScrollToBottom).toBe(false);

  // Agent reply grows past remaining compensation (+500px -> baseListHeight = 1080, maxScrollTop = 383)
  // -> comp hits 0 and smooth animated tail-follow kicks in without instant jumping.
  act(() => {
    mock.setBaseListHeight(1080);
    refs.sendTop.syncSendTopLayout();
    refs.streamTail.pinScrollToTail();
    triggerResizeObservers();
  });
  expect(mock.getCompPx()).toBe(0);
  expect(mock.viewport.scrollTop).toBe(193);

  act(() => {
    stepRaf(16);
  });
  expect(mock.viewport.scrollTop).toBeGreaterThan(193);
  expect(mock.viewport.scrollTop).toBeLessThan(383);

  for (let i = 0; i < 40; i += 1) {
    act(() => {
      stepRaf(20);
    });
  }
  expect(mock.viewport.scrollTop).toBe(383);
  expect(refs.streamTail.showScrollToBottom).toBe(false);

  // Finish turn 2 and send consecutive message #3 (turn 3).
  const turn3Messages = [
    ...turn2Messages,
    makeMessage(5, "assistant", "", { aux: { thinking: "T2" } }),
    makeMessage(4, "assistant", "Long reply"),
    makeMessage(6, "user", "Third short prompt"),
  ];
  mock.setBaseListHeight(1260);
  rerender(
    <Harness
      messages={turn3Messages}
      contentKey="session-1:main:e0"
      isBusy={true}
      enabled={true}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
      }}
    />,
  );

  expect(refs.sendTop.sendTopTriggerNonce).toBe(2);
  // Required compensation: (1200 + 883) - (1260 + 186) = 637px.
  expect(mock.getCompPx()).toBe(637);

  // Complete turn 3 animation and end busy with short reply (+100px -> comp = 537px).
  act(() => {
    stepRaf(500);
    mock.setBaseListHeight(1360);
    refs.sendTop.syncSendTopLayout();
  });
  rerender(
    <Harness
      messages={turn3Messages}
      contentKey="session-1:main:e0"
      isBusy={false}
      enabled={true}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
      }}
    />,
  );
  expect(mock.viewport.scrollTop).toBe(1200);
  expect(mock.getCompPx()).toBe(537);

  // User wheels UP by 200px (1200 -> 1000) -> compensation shrinks by 200px (537 -> 337) without jumping.
  act(() => {
    mock.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
    mock.setScrollTop(1000);
  });
  expect(mock.viewport.scrollTop).toBe(1000);
  expect(mock.getCompPx()).toBe(337);
  expect(mock.viewport.scrollHeight - mock.viewport.clientHeight).toBe(1000);
  // While compensation is still > 0, no content sits below viewport so button stays hidden.
  expect(refs.streamTail.showScrollToBottom).toBe(false);

  // Trying to scroll DOWN cannot restore disappeared compensation.
  act(() => {
    mock.setScrollTop(1200);
  });
  expect(mock.viewport.scrollTop).toBe(1000);
  expect(mock.getCompPx()).toBe(337);

  // Switching session resets compensation to 0.
  rerender(
    <Harness
      messages={initialMessages}
      contentKey="session-2:main:e0"
      isBusy={false}
      enabled={true}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
      }}
    />,
  );
  expect(mock.getCompPx()).toBe(0);
});

test("scrolling up during compensation detaches tail-follow so later streaming overflow does not yank viewport to bottom", () => {
  let refs!: {
    sendTop: UseConversationSendTopScrollResult;
    streamTail: UseConversationStreamScrollTailResult;
    viewport: HTMLDivElement;
    spacer: HTMLDivElement;
  };
  let mock!: MockViewportController;
  const resolver: SendTopAnchorResolver = () => ({
    targetScrollTop: 200,
    renderIndex: 2,
    exactDom: true,
  });

  const initialMessages = [makeMessage(1, "user", "First"), makeMessage(2, "assistant", "Reply")];
  const { rerender } = render(
    <Harness
      messages={initialMessages}
      contentKey="session-1:main:e0"
      isBusy={false}
      enabled={true}
      bedPaddingPx={180}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
        if (!mock) {
          mock = attachMockLayout(r.viewport, r.spacer, {
            clientHeight: 800,
            baseListHeight: 200,
            bedPaddingPx: 180,
          });
        }
      }}
    />,
  );

  mock.setBaseListHeight(260);
  rerender(
    <Harness
      messages={[...initialMessages, makeMessage(3, "user", "Second")]}
      contentKey="session-1:main:e0"
      isBusy={true}
      enabled={true}
      bedPaddingPx={180}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
      }}
    />,
  );

  act(() => {
    stepRaf(500);
  });
  expect(mock.viewport.scrollTop).toBe(200);
  expect(mock.getCompPx()).toBe(560);

  // User actively scrolls UP while compensation is active -> detaches tail-follow and shrinks comp.
  act(() => {
    mock.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    mock.setScrollTop(100);
  });
  expect(mock.getCompPx()).toBe(460);
  expect(refs.streamTail.followingTail).toBe(false);

  // Agent continues streaming past the remaining compensation and overflows below the fold.
  act(() => {
    mock.setBaseListHeight(1100);
    refs.sendTop.syncSendTopLayout();
    refs.streamTail.pinScrollToTail();
    triggerResizeObservers();
    stepRaf(200);
  });
  // Viewport MUST stay at 100 (not yanked to bottom) and show "Scroll to bottom".
  expect(mock.getCompPx()).toBe(0);
  expect(mock.viewport.scrollTop).toBe(100);
  expect(refs.streamTail.showScrollToBottom).toBe(true);
});

test("active wheel input interrupts smooth scroll-to-top animation immediately", () => {
  let mock!: MockViewportController;
  const resolver: SendTopAnchorResolver = () => ({
    targetScrollTop: 500,
    renderIndex: 2,
    exactDom: true,
  });

  const initialMessages = [makeMessage(1, "user", "First"), makeMessage(2, "assistant", "Reply")];
  const { rerender } = render(
    <Harness
      messages={initialMessages}
      contentKey="session-1:main:e0"
      isBusy={false}
      enabled={true}
      bedPaddingPx={180}
      anchorResolver={resolver}
      onRefs={(r) => {
        if (!mock) {
          mock = attachMockLayout(r.viewport, r.spacer, {
            clientHeight: 800,
            baseListHeight: 500,
            bedPaddingPx: 180,
          });
        }
      }}
    />,
  );

  mock.setBaseListHeight(560);
  rerender(
    <Harness
      messages={[...initialMessages, makeMessage(3, "user", "Interrupt me")]}
      contentKey="session-1:main:e0"
      isBusy={true}
      enabled={true}
      bedPaddingPx={180}
      anchorResolver={resolver}
      onRefs={() => {}}
    />,
  );

  // Advance partway through the animation.
  act(() => {
    stepRaf(80);
  });
  const midAnimationTop = mock.viewport.scrollTop;
  expect(midAnimationTop).toBeGreaterThan(0);
  expect(midAnimationTop).toBeLessThan(500);

  // User wheels up -> cancels animation immediately; subsequent rAF frames do not move scrollTop.
  act(() => {
    mock.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -40 }));
    stepRaf(400);
  });
  expect(mock.viewport.scrollTop).toBe(midAnimationTop);
});

test("Tab focus scrolling viewport upward during compensation or streaming detaches tail-follow so new tokens do not pull back down", () => {
  let refs!: {
    sendTop: UseConversationSendTopScrollResult;
    streamTail: UseConversationStreamScrollTailResult;
    viewport: HTMLDivElement;
    spacer: HTMLDivElement;
  };
  let mock!: MockViewportController;
  const resolver: SendTopAnchorResolver = () => ({
    targetScrollTop: 1000,
    renderIndex: 2,
    exactDom: true,
  });

  const initialMessages = [makeMessage(1, "user", "First"), makeMessage(2, "assistant", "Reply")];
  const { rerender } = render(
    <Harness
      messages={initialMessages}
      contentKey="session-1:main:e0"
      isBusy={false}
      enabled={true}
      bedPaddingPx={180}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
        if (!mock) {
          mock = attachMockLayout(r.viewport, r.spacer, {
            clientHeight: 800,
            baseListHeight: 1000,
            bedPaddingPx: 180,
          });
        }
      }}
    />,
  );

  mock.setBaseListHeight(1060);
  rerender(
    <Harness
      messages={[...initialMessages, makeMessage(3, "user", "New message")]}
      contentKey="session-1:main:e0"
      isBusy={true}
      enabled={true}
      bedPaddingPx={180}
      anchorResolver={resolver}
      onRefs={(r) => {
        refs = r;
      }}
    />,
  );

  // Settle send-top animation at scrollTop = 1000 with active compensation (560px).
  act(() => {
    stepRaf(500);
  });
  expect(mock.viewport.scrollTop).toBe(1000);
  expect(mock.getCompPx()).toBe(560);
  expect(refs.streamTail.followingTail).toBe(true);

  // Simulate Chromium native Tab focus jump to an earlier message above:
  // keydown(Tab) -> browser updates scrollTop -> focusin inside viewport -> async scroll event.
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    mock.setScrollTop(500, { fireScroll: false });
    mock.viewport.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    mock.viewport.dispatchEvent(new Event("scroll"));
  });

  expect(mock.viewport.scrollTop).toBe(500);
  expect(mock.getCompPx()).toBe(60);
  expect(refs.streamTail.followingTail).toBe(false);

  // Agent streams new tokens pushing baseListHeight past remaining compensation -> MUST NOT chase back down.
  act(() => {
    mock.setBaseListHeight(1800);
    refs.sendTop.syncSendTopLayout();
    refs.streamTail.pinScrollToTail();
    triggerResizeObservers();
    stepRaf(100);
    stepRaf(100);
  });
  expect(mock.getCompPx()).toBe(0);
  expect(mock.viewport.scrollTop).toBe(500);
  expect(refs.streamTail.showScrollToBottom).toBe(true);
});
