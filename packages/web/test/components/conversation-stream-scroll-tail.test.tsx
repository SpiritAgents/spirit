/** @vitest-environment jsdom */

import "./setup";

import { act, render } from "@testing-library/react";
import { useRef, type ComponentRef } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";

import type { ScrollArea } from "@/components/ui/scroll-area";
import {
  useConversationStreamScrollTail,
  type UseConversationStreamScrollTailResult,
} from "@/hooks/useConversationStreamScrollTail";

type ResizeCallback = () => void;

let resizeCallbacks: ResizeCallback[] = [];
let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

beforeEach(() => {
  resizeCallbacks = [];
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
});

afterEach(() => {
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  }
});

function triggerResizeObservers() {
  for (const cb of resizeCallbacks.slice()) {
    cb();
  }
}

function Harness({
  isBusy,
  onReady,
}: {
  isBusy: boolean;
  onReady: (api: UseConversationStreamScrollTailResult, viewport: HTMLDivElement) => void;
}) {
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea> | null>(null);
  const api = useConversationStreamScrollTail({
    scrollAreaRef,
    messages: [],
    pendingAuxState: undefined,
    isBusy,
    scrollBedPaddingPx: 120,
    enabled: true,
  });

  return (
    <div
      ref={(node) => {
        scrollAreaRef.current = node as ComponentRef<typeof ScrollArea> | null;
        const viewport = node?.querySelector<HTMLDivElement>("[data-radix-scroll-area-viewport]");
        if (viewport) {
          onReady(api, viewport);
        }
      }}
    >
      <div data-radix-scroll-area-viewport="">
        <div data-testid="content" />
      </div>
    </div>
  );
}

function setViewportMetrics(
  viewport: HTMLDivElement,
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number; clientWidth?: number },
) {
  let currentTop = metrics.scrollTop;
  Object.defineProperty(viewport, "scrollTop", {
    configurable: true,
    get: () => currentTop,
    set: (v: number) => {
      currentTop = v;
    },
  });
  Object.defineProperty(viewport, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(viewport, "clientWidth", {
    configurable: true,
    value: metrics.clientWidth ?? 800,
  });
}

test("idle content height growth does not slam scrollTop to bottom and releases followingTail when pushed past threshold", () => {
  let latestApi!: UseConversationStreamScrollTailResult;
  let viewport!: HTMLDivElement;

  render(
    <Harness
      isBusy={false}
      onReady={(api, vp) => {
        latestApi = api;
        viewport = vp;
      }}
    />,
  );

  // Initially sitting at bottom of a finished idle session (stickToBottom=true); establish initial viewport size.
  setViewportMetrics(viewport, { scrollTop: 500, scrollHeight: 1200, clientHeight: 700 });
  act(() => {
    triggerResizeObservers();
  });
  expect(viewport.scrollTop).toBe(500);
  expect(latestApi.followingTail).toBe(true);

  // User manually expands a Thinking / MCP App card: content grows +400px while viewport size is unchanged.
  setViewportMetrics(viewport, { scrollTop: 500, scrollHeight: 1600, clientHeight: 700 });
  act(() => {
    latestApi.pinScrollToTail();
    triggerResizeObservers();
  });

  // Must NOT jump to bottom (scrollTop stays 500), and followingTail releases so "Scroll to bottom" can appear.
  expect(viewport.scrollTop).toBe(500);
  expect(latestApi.followingTail).toBe(false);

  // Explicit "Scroll to bottom" button (forceStick=true) still scrolls to bottom (1600 - 700 = 900).
  act(() => {
    latestApi.pinScrollToTail(true, "auto");
  });
  expect(viewport.scrollTop).toBe(900);
  expect(latestApi.followingTail).toBe(true);
});

test("streaming content growth and idle viewport resizes still re-pin when sticking to bottom", () => {
  let latestApi!: UseConversationStreamScrollTailResult;
  let viewport!: HTMLDivElement;

  const { rerender } = render(
    <Harness
      isBusy={false}
      onReady={(api, vp) => {
        latestApi = api;
        viewport = vp;
      }}
    />,
  );

  setViewportMetrics(viewport, {
    scrollTop: 500,
    scrollHeight: 1200,
    clientHeight: 700,
    clientWidth: 800,
  });
  act(() => {
    triggerResizeObservers();
  });

  // Viewport height shrinks while sticking in an idle session -> must re-pin (1200 - 550 = 650).
  setViewportMetrics(viewport, {
    scrollTop: 500,
    scrollHeight: 1200,
    clientHeight: 550,
    clientWidth: 800,
  });
  act(() => {
    triggerResizeObservers();
  });
  expect(viewport.scrollTop).toBe(650);

  // During active streaming (isBusy=true), virtual list totalSize changes pin synchronously (1500 - 550 = 950).
  rerender(
    <Harness
      isBusy={true}
      onReady={(api, vp) => {
        latestApi = api;
        viewport = vp;
      }}
    />,
  );
  setViewportMetrics(viewport, {
    scrollTop: 650,
    scrollHeight: 1500,
    clientHeight: 550,
    clientWidth: 800,
  });
  act(() => {
    latestApi.pinScrollToTail();
  });
  expect(viewport.scrollTop).toBe(950);
});
