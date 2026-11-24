/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render } from "@testing-library/react";
import { StrictMode, useCallback, useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import {
  McpAppGlobalHostProvider,
  McpAppPaneProvider,
} from "@/components/mcp-app/mcp-app-pane-host";
import { McpAppToolCard } from "@/components/mcp-app/mcp-app-tool-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMcpAppWorkspaceTabBridge } from "@/contexts/mcp-app-contexts";
import { McpAppWorkspaceTabBridgeProvider } from "@/contexts/mcp-app-workspace-tab-bridge";
import { ThemeProvider } from "@/hooks/useTheme";
import type { ToolBlockSnapshot } from "@/types";
import { UiTestProviders } from "./ui-test-providers";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const mockRuntime = {
  hostKind: "web",
  mcpAppReadResource: vi.fn(() => new Promise(() => {})),
  mcpAppCallTool: vi.fn(),
  mcpAppUpdateModelContext: vi.fn(),
  openExtensionLink: vi.fn(),
} as unknown as Parameters<typeof McpAppPaneProvider>[0]["runtime"];

const sampleTool: ToolBlockSnapshot = {
  toolCallId: "tc-overlay-1",
  toolName: "mcp__github__get_me",
  phase: "succeeded",
  headline: "GitHub Get Me",
  detailLines: [],
  mcpApp: {
    server: "github",
    displayName: "GitHub",
    toolName: "get_me",
    resourceUri: "ui://github-mcp-server/get-me",
  },
};

const secondSameResourceTool: ToolBlockSnapshot = {
  ...sampleTool,
  toolCallId: "tc-overlay-2",
};

interface MockRightTab {
  instanceKey: string;
  appKey: string;
  sessionKey: string;
  tabTitle: string;
}

function MockRightPanelTab({
  tab,
  onClose,
}: {
  tab: MockRightTab;
  onClose: (instanceKey: string) => void;
}) {
  const bridge = useMcpAppWorkspaceTabBridge();
  const handleRef = useCallback(
    (node: HTMLDivElement | null) => {
      bridge?.setTabHostElement(tab.instanceKey, node);
    },
    [bridge, tab.instanceKey],
  );
  return (
    <div data-testid={`right-tab-${tab.appKey}`}>
      <span data-testid={`right-tab-title-${tab.appKey}`}>{tab.tabTitle}</span>
      <button
        type="button"
        data-testid={`right-tab-close-${tab.appKey}`}
        onClick={() => {
          bridge?.notifyTabClosedByUser(tab.instanceKey);
          onClose(tab.instanceKey);
        }}
      >
        Close Tab
      </button>
      <div ref={handleRef} data-spirit-mcp-app-tab-host={tab.appKey} />
    </div>
  );
}

function Harness({
  slotRect,
  showCard = true,
  tools = [sampleTool],
  runtime = mockRuntime,
}: {
  slotRect: DOMRect;
  showCard?: boolean;
  tools?: ToolBlockSnapshot[];
  runtime?: Parameters<typeof McpAppPaneProvider>[0]["runtime"];
}) {
  const [rightTabs, setRightTabs] = useState<MockRightTab[]>([]);
  const openMcpAppTab = useCallback(
    (input: { instanceKey: string; appKey: string; sessionKey: string; tabTitle: string }) => {
      setRightTabs((prev) =>
        prev.some((tab) => tab.instanceKey === input.instanceKey) ? prev : [...prev, input],
      );
    },
    [],
  );
  const closeMcpAppTab = useCallback((instanceKey: string) => {
    setRightTabs((prev) => prev.filter((tab) => tab.instanceKey !== instanceKey));
  }, []);

  return (
    <ThemeProvider>
      <TooltipProvider>
        <UiTestProviders>
          <McpAppWorkspaceTabBridgeProvider
            openMcpAppTab={openMcpAppTab}
            closeMcpAppTab={closeMcpAppTab}
          >
            <div data-testid="stage">
              <McpAppPaneProvider
                sessionKey="sess-1"
                sandboxUrl="http://127.0.0.1:65432/sandbox.html"
                runtime={runtime}
                pipBottomOffsetPx={120}
                getCurrentComposerText={() => ""}
                onReplaceComposerText={() => {}}
                onAppendComposerText={() => {}}
                onFocusComposer={() => {}}
                onOpenExternalUrl={async () => {}}
              >
                <div data-testid="scroll-body">
                  <button type="button" data-testid="before-btn">
                    1 Other
                  </button>
                  <div
                    ref={(node) => {
                      const slots = node?.querySelectorAll<HTMLDivElement>(
                        "[data-spirit-mcp-app-slot]",
                      );
                      slots?.forEach((slot) => {
                        slot.getBoundingClientRect = () => slotRect;
                      });
                    }}
                  >
                    {showCard
                      ? tools.map((tool) => (
                          <McpAppToolCard key={tool.toolCallId ?? tool.toolName} tool={tool} />
                        ))
                      : null}
                  </div>
                  <button type="button" data-testid="after-btn">
                    Thought
                  </button>
                </div>
              </McpAppPaneProvider>
              <div data-testid="right-panel">
                {rightTabs.map((tab) => (
                  <MockRightPanelTab key={tab.instanceKey} tab={tab} onClose={closeMcpAppTab} />
                ))}
              </div>
            </div>
          </McpAppWorkspaceTabBridgeProvider>
        </UiTestProviders>
      </TooltipProvider>
    </ThemeProvider>
  );
}

test("inline MCP App mounts inside its slot in natural DOM/Tab order (without Reload button) and moves atomically via moveBefore to PiP and back without remounting iframe", async () => {
  const visibleSlotRect = new DOMRect(376, 120, 728, 320);

  const { container } = render(<Harness slotRect={visibleSlotRect} />);

  const slot = container.querySelector<HTMLDivElement>("[data-spirit-mcp-app-slot]")!;
  const hostLayer = container.querySelector<HTMLDivElement>(
    '[data-spirit-surface="mcp-app-host-layer"]',
  )!;
  const parkLayer = container.querySelector<HTMLDivElement>(
    '[data-spirit-surface="mcp-app-park-layer"]',
  )!;

  const wrapper = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-1"]',
  )!;
  const iframe = wrapper.querySelector("iframe")!;
  expect(slot.contains(wrapper)).toBe(true);
  expect(hostLayer.contains(wrapper)).toBe(false);

  // Verify sequential DOM/Tab focus order (PiP -> Fullscreen -> Collapse -> IFRAME -> Thought) and that Reload button is removed.
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-testid="scroll-body"] button, [data-testid="scroll-body"] iframe',
    ),
  );
  const labels = focusables.map(
    (el) => el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.tagName,
  );
  expect(labels).toEqual([
    "before-btn",
    expect.stringMatching(/Picture/i),
    expect.stringMatching(/Fullscreen/i),
    expect.stringMatching(/Collapse/i),
    "IFRAME",
    "after-btn",
  ]);

  // Collapse and re-expand inline card: animates collapse container, toggles inert, and keeps the exact iframe mounted.
  const cardHeader = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-card="tc-overlay-1"][data-spirit-mcp-app-header="inline"]',
  )!;
  const collapseBtn = cardHeader.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')!;
  expect(collapseBtn.className).toContain("aria-expanded:bg-transparent");
  const collapseContent = container.querySelector<HTMLDivElement>(
    '[data-slot="animated-collapse-content"]',
  )!;
  expect(collapseContent.getAttribute("data-state")).toBe("open");
  expect(collapseContent.hasAttribute("inert")).toBe(false);

  await act(async () => {
    fireEvent.click(collapseBtn);
  });
  expect(collapseContent.getAttribute("data-state")).toBe("closed");
  expect(collapseContent.hasAttribute("inert")).toBe(true);
  expect(slot.contains(wrapper)).toBe(true);
  expect(wrapper.querySelector("iframe")).toBe(iframe);

  await act(async () => {
    fireEvent.click(collapseBtn);
  });
  expect(collapseContent.getAttribute("data-state")).toBe("open");
  expect(collapseContent.hasAttribute("inert")).toBe(false);
  expect(wrapper.querySelector("iframe")).toBe(iframe);

  const moveBeforeCalls: string[] = [];
  const spyMoveBefore = (label: string, el: HTMLElement) => {
    Object.defineProperty(el, "moveBefore", {
      configurable: true,
      value(node: Node, child: Node | null) {
        moveBeforeCalls.push(label);
        el.insertBefore(node, child);
      },
    });
  };
  spyMoveBefore("host", hostLayer);
  spyMoveBefore("park", parkLayer);

  const pipButton = cardHeader.querySelector<HTMLButtonElement>(
    'button[aria-label*="Picture"], button[aria-label*="PiP"], button[aria-label*="画中画"]',
  )!;
  await act(async () => {
    fireEvent.click(pipButton);
  });

  expect(wrapper.getAttribute("data-spirit-mcp-app-mode")).toBe("pip");
  expect(hostLayer.contains(wrapper)).toBe(true);
  expect(moveBeforeCalls).toContain("host");
  expect(Number.parseInt(wrapper.style.width, 10)).toBeGreaterThanOrEqual(280);
  expect(Number.parseInt(wrapper.style.height, 10)).toBeGreaterThanOrEqual(200);
  // Exact same iframe node survived the atomic transition.
  expect(wrapper.querySelector("iframe")).toBe(iframe);

  const returnButton = wrapper.querySelector<HTMLButtonElement>(
    'button[aria-label*="Return"], button[aria-label*="Inline"], button[aria-label*="回到行内"]',
  )!;
  await act(async () => {
    fireEvent.click(returnButton);
  });

  const restoredSlot = container.querySelector<HTMLDivElement>("[data-spirit-mcp-app-slot]")!;
  expect(wrapper.getAttribute("data-spirit-mcp-app-mode")).toBe("inline");
  expect(restoredSlot.contains(wrapper)).toBe(true);
  expect(wrapper.querySelector("iframe")).toBe(iframe);
});

test("parks inline MCP App in park-layer while virtual row is unmounted and preserves iframe dimensions without CSS visible override", async () => {
  const visibleSlotRect = new DOMRect(376, 120, 728, 272);

  const { container, rerender } = render(<Harness slotRect={visibleSlotRect} showCard />);

  const slot = container.querySelector<HTMLDivElement>("[data-spirit-mcp-app-slot]")!;
  const parkLayer = container.querySelector<HTMLDivElement>(
    '[data-spirit-surface="mcp-app-park-layer"]',
  )!;
  slot.getBoundingClientRect = () => visibleSlotRect;

  const moveBeforeCalls: string[] = [];
  Object.defineProperty(parkLayer, "moveBefore", {
    configurable: true,
    value(node: Node, child: Node | null) {
      moveBeforeCalls.push("park");
      parkLayer.insertBefore(node, child);
    },
  });

  const wrapper = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-1"]',
  )!;
  const portal = wrapper.parentElement!;
  const iframe = wrapper.querySelector("iframe")!;
  expect(slot.contains(wrapper)).toBe(true);
  expect(portal.inert).toBe(false);

  // Simulate virtualizer unmounting the row when scrolled far offscreen.
  rerender(<Harness slotRect={visibleSlotRect} showCard={false} />);

  expect(parkLayer.contains(wrapper)).toBe(true);
  expect(moveBeforeCalls).toEqual(["park"]);
  expect(portal.inert).toBe(true);
  expect(portal.style.visibility).toBe("hidden");
  expect(portal.style.width).toBe("728px");
  expect(portal.style.height).toBe("272px");
  expect(wrapper.querySelector("iframe")).toBe(iframe);
  // Iframe must not declare CSS `visible`, which overrides ancestor `visibility: hidden`.
  expect(iframe.className.split(/\s+/)).not.toContain("visible");
});

test("applies iframe allow attribute from resource permissions before navigating to sandboxUrl", async () => {
  const visibleSlotRect = new DOMRect(376, 120, 728, 320);

  let resolveResource!: (value: {
    uri: string;
    mimeType: string;
    html: string;
    uiMeta: {
      permissions: { camera: Record<string, never>; clipboardWrite: Record<string, never> };
    };
  }) => void;
  const runtime = {
    ...mockRuntime,
    mcpAppReadResource: vi.fn(
      () =>
        new Promise((resolve) => {
          resolveResource = resolve;
        }),
    ),
  } as unknown as Parameters<typeof McpAppPaneProvider>[0]["runtime"];

  const { container } = render(<Harness slotRect={visibleSlotRect} runtime={runtime} />);

  const iframe = container.querySelector<HTMLIFrameElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-1"] iframe',
  )!;
  expect(iframe).not.toBeNull();
  // Before resource metadata arrives, outer iframe has not navigated to sandboxUrl yet.
  expect(iframe.getAttribute("src")).toBe("about:blank");

  let allowAtSrcAssignment = "";
  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src")!;
  Object.defineProperty(iframe, "src", {
    configurable: true,
    get() {
      return srcDescriptor.get!.call(this);
    },
    set(value: string) {
      if (value.includes("sandbox.html")) {
        allowAtSrcAssignment = iframe.allow;
      }
      srcDescriptor.set!.call(this, value);
    },
  });

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => {
    resolveResource({
      uri: "ui://fixture/dashboard",
      mimeType: "text/html;profile=mcp-app",
      html: "<!doctype html><html><body>ok</body></html>",
      uiMeta: {
        permissions: { camera: {}, clipboardWrite: {} },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(allowAtSrcAssignment).toBe("camera; clipboard-write");
  expect(iframe.src).toContain("sandbox.html");
});

test("fullscreen mounts pure iframe inside right-panel tabs, allows multiple instances of the same resource, and syncs Return Inline and Tab close without reloading", async () => {
  const visibleSlotRect = new DOMRect(376, 120, 728, 320);

  const { container } = render(
    <Harness slotRect={visibleSlotRect} tools={[sampleTool, secondSameResourceTool]} />,
  );

  const wrapper1 = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-1"]',
  )!;
  const wrapper2 = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-2"]',
  )!;
  const iframe1 = wrapper1.querySelector("iframe")!;
  const iframe2 = wrapper2.querySelector("iframe")!;

  // Enter fullscreen for both instances (same resource URI ui://github-mcp-server/get-me).
  const card1 = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-card="tc-overlay-1"]',
  )!;
  const card2 = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-card="tc-overlay-2"]',
  )!;
  const fsBtn1 = card1.querySelector<HTMLButtonElement>('button[aria-label*="Fullscreen"]')!;
  const fsBtn2 = card2.querySelector<HTMLButtonElement>('button[aria-label*="Fullscreen"]')!;
  await act(async () => {
    fireEvent.click(fsBtn1);
  });
  await act(async () => {
    fireEvent.click(fsBtn2);
  });

  const tabHost1 = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-tab-host="tc-overlay-1"]',
  )!;
  const tabHost2 = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-tab-host="tc-overlay-2"]',
  )!;
  expect(tabHost1).not.toBeNull();
  expect(tabHost2).not.toBeNull();
  expect(tabHost1.contains(wrapper1)).toBe(true);
  expect(tabHost2.contains(wrapper2)).toBe(true);
  expect(container.querySelector('[data-testid="right-tab-title-tc-overlay-1"]')?.textContent).toBe(
    "GitHub Get Me",
  );
  expect(container.querySelector('[data-testid="right-tab-title-tc-overlay-2"]')?.textContent).toBe(
    "GitHub Get Me",
  );

  // Fullscreen tabs render pure iframe content with no MCP App header bar.
  expect(wrapper1.querySelector("[data-spirit-mcp-app-header]")).toBeNull();
  expect(wrapper2.querySelector("[data-spirit-mcp-app-header]")).toBeNull();
  expect(wrapper1.querySelector("iframe")).toBe(iframe1);
  expect(wrapper2.querySelector("iframe")).toBe(iframe2);

  // Conversation cards show dashed fullscreen placeholders with Return Inline buttons.
  const placeholder1 = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-card="tc-overlay-1"][data-spirit-mcp-app-placeholder="fullscreen"]',
  )!;
  expect(placeholder1).not.toBeNull();

  // Clicking Return Inline on card 1 closes right-panel tab 1 and returns iframe1 to inline without reloading.
  const returnInlineBtn1 = placeholder1.querySelector<HTMLButtonElement>("button")!;
  await act(async () => {
    fireEvent.click(returnInlineBtn1);
  });
  expect(container.querySelector('[data-spirit-mcp-app-tab-host="tc-overlay-1"]')).toBeNull();
  expect(container.querySelector('[data-spirit-mcp-app-tab-host="tc-overlay-2"]')).not.toBeNull();
  const restoredSlot1 = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-slot="tc-overlay-1"]',
  )!;
  expect(restoredSlot1.contains(wrapper1)).toBe(true);
  expect(wrapper1.querySelector("iframe")).toBe(iframe1);
  expect(
    container.querySelector(
      '[data-spirit-mcp-app-card="tc-overlay-1"][data-spirit-mcp-app-header="inline"]',
    ),
  ).not.toBeNull();

  // Closing tab 2 directly in the right panel exits fullscreen and returns iframe2 to inline without reloading.
  const closeTabBtn2 = container.querySelector<HTMLButtonElement>(
    '[data-testid="right-tab-close-tc-overlay-2"]',
  )!;
  await act(async () => {
    fireEvent.click(closeTabBtn2);
  });
  expect(container.querySelector('[data-spirit-mcp-app-tab-host="tc-overlay-2"]')).toBeNull();
  const restoredSlot2 = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-slot="tc-overlay-2"]',
  )!;
  expect(restoredSlot2.contains(wrapper2)).toBe(true);
  expect(wrapper2.querySelector("iframe")).toBe(iframe2);
});

test("global PiP survives session switches, new chat, and non-conversation surfaces, supports multiple PiP windows with z-order focus, and returns inline without reloading", async () => {
  localStorage.clear();
  const visibleSlotRect = new DOMRect(200, 120, 640, 300);

  function GlobalAppHarness({
    surface,
    sessionKey,
    tools,
    onEnsureConversationSurface,
  }: {
    surface: "conversation" | "settings" | "marketplace" | "automations";
    sessionKey: string;
    tools: ToolBlockSnapshot[];
    onEnsureConversationSurface?: () => void;
  }) {
    const [rightTabs, setRightTabs] = useState<MockRightTab[]>([]);
    const openMcpAppTab = useCallback(
      (input: { instanceKey: string; appKey: string; sessionKey: string; tabTitle: string }) => {
        setRightTabs((prev) =>
          prev.some((tab) => tab.instanceKey === input.instanceKey) ? prev : [...prev, input],
        );
      },
      [],
    );
    const closeMcpAppTab = useCallback((instanceKey: string) => {
      setRightTabs((prev) => prev.filter((tab) => tab.instanceKey !== instanceKey));
    }, []);

    return (
      <ThemeProvider>
        <TooltipProvider>
          <UiTestProviders>
            <McpAppWorkspaceTabBridgeProvider
              openMcpAppTab={openMcpAppTab}
              closeMcpAppTab={closeMcpAppTab}
            >
              <McpAppGlobalHostProvider
                activeSessionKey={sessionKey}
                sandboxUrl="http://127.0.0.1:65432/sandbox.html"
                runtime={mockRuntime}
                conversationSurfaceVisible={surface === "conversation"}
                onEnsureConversationSurface={onEnsureConversationSurface}
              >
                {surface === "conversation" ? (
                  <McpAppPaneProvider
                    sessionKey={sessionKey}
                    sandboxUrl="http://127.0.0.1:65432/sandbox.html"
                    runtime={mockRuntime}
                    getCurrentComposerText={() => ""}
                    onReplaceComposerText={() => {}}
                    onAppendComposerText={() => {}}
                    onFocusComposer={() => {}}
                    onOpenExternalUrl={async () => {}}
                  >
                    <div
                      ref={(node) => {
                        const slots = node?.querySelectorAll<HTMLDivElement>(
                          "[data-spirit-mcp-app-slot]",
                        );
                        slots?.forEach((slot) => {
                          slot.getBoundingClientRect = () => visibleSlotRect;
                        });
                      }}
                    >
                      {tools.map((tool) => (
                        <McpAppToolCard key={tool.toolCallId ?? tool.toolName} tool={tool} />
                      ))}
                    </div>
                  </McpAppPaneProvider>
                ) : (
                  <div data-testid={`surface-${surface}`}>{surface}</div>
                )}
                <div data-testid="right-panel">
                  {rightTabs.map((tab) => (
                    <MockRightPanelTab key={tab.instanceKey} tab={tab} onClose={closeMcpAppTab} />
                  ))}
                </div>
              </McpAppGlobalHostProvider>
            </McpAppWorkspaceTabBridgeProvider>
          </UiTestProviders>
        </TooltipProvider>
      </ThemeProvider>
    );
  }

  const ensureConversation = vi.fn();
  const { container, rerender } = render(
    <GlobalAppHarness
      surface="conversation"
      sessionKey="session-a"
      tools={[sampleTool]}
      onEnsureConversationSurface={ensureConversation}
    />,
  );

  const hostLayer = container.querySelector<HTMLDivElement>(
    '[data-spirit-surface="mcp-app-host-layer"]',
  )!;
  const wrapperA = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-1"]',
  )!;
  const iframeA = wrapperA.querySelector("iframe")!;

  const pipBtnA = container.querySelector<HTMLButtonElement>(
    '[data-spirit-mcp-app-card="tc-overlay-1"] button[aria-label*="Picture"], [data-spirit-mcp-app-card="tc-overlay-1"] button[aria-label*="PiP"]',
  )!;
  await act(async () => {
    fireEvent.click(pipBtnA);
  });

  expect(hostLayer.contains(wrapperA)).toBe(true);
  expect(wrapperA.getAttribute("data-spirit-mcp-app-mode")).toBe("pip");

  // Switch to another session B and open a second PiP: both PiP windows coexist and survive without reload.
  rerender(
    <GlobalAppHarness
      surface="conversation"
      sessionKey="session-b"
      tools={[secondSameResourceTool]}
      onEnsureConversationSurface={ensureConversation}
    />,
  );
  expect(hostLayer.contains(wrapperA)).toBe(true);
  expect(wrapperA.querySelector("iframe")).toBe(iframeA);

  const wrapperB = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-2"]',
  )!;
  const iframeB = wrapperB.querySelector("iframe")!;
  const pipBtnB = container.querySelector<HTMLButtonElement>(
    '[data-spirit-mcp-app-card="tc-overlay-2"] button[aria-label*="Picture"], [data-spirit-mcp-app-card="tc-overlay-2"] button[aria-label*="PiP"]',
  )!;
  await act(async () => {
    fireEvent.click(pipBtnB);
  });

  expect(hostLayer.contains(wrapperA)).toBe(true);
  expect(hostLayer.contains(wrapperB)).toBe(true);
  expect(Number(wrapperB.style.zIndex)).toBeGreaterThan(Number(wrapperA.style.zIndex));

  // Clicking wrapperA brings it to the front.
  await act(async () => {
    fireEvent.pointerDown(wrapperA);
  });
  expect(Number(wrapperA.style.zIndex)).toBeGreaterThan(Number(wrapperB.style.zIndex));

  // Switch to Marketplace / Automations / Settings (unmounting ConversationView completely): both PiPs stay live.
  for (const surface of ["marketplace", "automations", "settings"] as const) {
    rerender(
      <GlobalAppHarness
        surface={surface}
        sessionKey="session-b"
        tools={[]}
        onEnsureConversationSurface={ensureConversation}
      />,
    );
    expect(container.querySelector(`[data-testid="surface-${surface}"]`)).not.toBeNull();
    expect(hostLayer.contains(wrapperA)).toBe(true);
    expect(hostLayer.contains(wrapperB)).toBe(true);
    expect(wrapperA.querySelector("iframe")).toBe(iframeA);
    expect(wrapperB.querySelector("iframe")).toBe(iframeB);
  }

  // Clicking Fullscreen on PiP B while in Settings switches back to conversation surface and opens a window-visible right tab.
  const fsBtnOnPipB = wrapperB.querySelector<HTMLButtonElement>(
    'button[aria-label*="Fullscreen"]',
  )!;
  await act(async () => {
    fireEvent.click(fsBtnOnPipB);
  });
  expect(ensureConversation).toHaveBeenCalledTimes(1);

  // Switch back to session A: card A shows dashed PiP placeholder; clicking X on PiP A returns the exact same iframe inline.
  rerender(
    <GlobalAppHarness
      surface="conversation"
      sessionKey="session-a"
      tools={[sampleTool]}
      onEnsureConversationSurface={ensureConversation}
    />,
  );
  expect(
    container.querySelector(
      '[data-spirit-mcp-app-card="tc-overlay-1"][data-spirit-mcp-app-placeholder="pip"]',
    ),
  ).not.toBeNull();

  const closePipABtn = wrapperA.querySelector<HTMLButtonElement>(
    'button[aria-label*="Return"], button[aria-label*="Inline"]',
  )!;
  await act(async () => {
    fireEvent.click(closePipABtn);
  });
  const slotA = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-slot="tc-overlay-1"]',
  )!;
  expect(slotA.contains(wrapperA)).toBe(true);
  expect(wrapperA.querySelector("iframe")).toBe(iframeA);
});

test("PiP header drags with default cursor and 8-edge handles resize with blocked-edge cursors", async () => {
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });

  const visibleSlotRect = new DOMRect(200, 120, 640, 300);
  const { container } = render(<Harness slotRect={visibleSlotRect} />);

  const pipBtn = container.querySelector<HTMLButtonElement>(
    '[data-spirit-mcp-app-card="tc-overlay-1"] button[aria-label*="Picture"], [data-spirit-mcp-app-card="tc-overlay-1"] button[aria-label*="PiP"]',
  )!;
  await act(async () => {
    fireEvent.click(pipBtn);
  });

  const wrapper = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-1"]',
  )!;
  const header = wrapper.querySelector<HTMLDivElement>('[data-spirit-mcp-app-header="pip"]')!;
  expect(header.className).toContain("cursor-default");
  expect(header.className).not.toContain("cursor-grab");
  expect(header.className).not.toContain("cursor-move");

  // All 8 resize handles are rendered.
  for (const edge of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
    expect(wrapper.querySelector(`[data-spirit-mcp-app-resize-handle="${edge}"]`)).not.toBeNull();
  }

  // Drag header by (-200, -100).
  const initialLeft = Number.parseInt(wrapper.style.left, 10);
  const initialTop = Number.parseInt(wrapper.style.top, 10);
  await act(async () => {
    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 850, clientY: 400 });
    fireEvent.pointerMove(header, { button: 0, pointerId: 1, clientX: 650, clientY: 300 });
    fireEvent.pointerUp(header, { button: 0, pointerId: 1, clientX: 650, clientY: 300 });
  });
  expect(Number.parseInt(wrapper.style.left, 10)).toBe(initialLeft - 200);
  expect(Number.parseInt(wrapper.style.top, 10)).toBe(initialTop - 100);

  // Resize east handle down to minimum width -> cursor switches to blocked single-headed `e-resize`.
  const eastHandle = wrapper.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-resize-handle="e"]',
  )!;
  expect(eastHandle.style.cursor).toBe("col-resize");
  await act(async () => {
    fireEvent.pointerDown(eastHandle, { button: 0, pointerId: 2, clientX: 984, clientY: 360 });
    fireEvent.pointerMove(eastHandle, { button: 0, pointerId: 2, clientX: 500, clientY: 360 });
    fireEvent.pointerUp(eastHandle, { button: 0, pointerId: 2, clientX: 500, clientY: 360 });
  });
  expect(Number.parseInt(wrapper.style.width, 10)).toBe(280);
  expect(eastHandle.style.cursor).toBe("e-resize");
});

test("remounting host preserves open fullscreen tab, re-attaches iframe into tab host, and keeps close synchronized", async () => {
  const visibleSlotRect = new DOMRect(200, 120, 640, 300);

  function RemountHarness({ hostGeneration }: { hostGeneration: number }) {
    const [rightTabs, setRightTabs] = useState<MockRightTab[]>([]);
    const openMcpAppTab = useCallback(
      (input: { instanceKey: string; appKey: string; sessionKey: string; tabTitle: string }) => {
        setRightTabs((prev) =>
          prev.some((tab) => tab.instanceKey === input.instanceKey) ? prev : [...prev, input],
        );
      },
      [],
    );
    const closeMcpAppTab = useCallback((instanceKey: string) => {
      setRightTabs((prev) => prev.filter((tab) => tab.instanceKey !== instanceKey));
    }, []);

    return (
      <ThemeProvider>
        <TooltipProvider>
          <UiTestProviders>
            <McpAppWorkspaceTabBridgeProvider
              openMcpAppTab={openMcpAppTab}
              closeMcpAppTab={closeMcpAppTab}
            >
              <McpAppGlobalHostProvider
                key={hostGeneration}
                activeSessionKey="sess-remount"
                sandboxUrl="http://127.0.0.1:65432/sandbox.html"
                runtime={mockRuntime}
                conversationSurfaceVisible
              >
                <McpAppPaneProvider
                  sessionKey="sess-remount"
                  sandboxUrl="http://127.0.0.1:65432/sandbox.html"
                  runtime={mockRuntime}
                  getCurrentComposerText={() => ""}
                  onReplaceComposerText={() => {}}
                  onAppendComposerText={() => {}}
                  onFocusComposer={() => {}}
                  onOpenExternalUrl={async () => {}}
                >
                  <div
                    ref={(node) => {
                      const slots = node?.querySelectorAll<HTMLDivElement>(
                        "[data-spirit-mcp-app-slot]",
                      );
                      slots?.forEach((slot) => {
                        slot.getBoundingClientRect = () => visibleSlotRect;
                      });
                    }}
                  >
                    <McpAppToolCard tool={sampleTool} />
                  </div>
                </McpAppPaneProvider>
              </McpAppGlobalHostProvider>
              <div data-testid="right-panel">
                {rightTabs.map((tab) => (
                  <MockRightPanelTab key={tab.instanceKey} tab={tab} onClose={closeMcpAppTab} />
                ))}
              </div>
            </McpAppWorkspaceTabBridgeProvider>
          </UiTestProviders>
        </TooltipProvider>
      </ThemeProvider>
    );
  }

  const { container, rerender } = render(<RemountHarness hostGeneration={1} />);

  const fsBtn = container.querySelector<HTMLButtonElement>(
    '[data-spirit-mcp-app-card="tc-overlay-1"] button[aria-label*="Fullscreen"]',
  )!;
  await act(async () => {
    fireEvent.click(fsBtn);
  });
  expect(container.querySelector('[data-spirit-mcp-app-tab-host="tc-overlay-1"]')).not.toBeNull();
  expect(
    container.querySelector(
      '[data-spirit-mcp-app-card="tc-overlay-1"][data-spirit-mcp-app-placeholder="fullscreen"]',
    ),
  ).not.toBeNull();

  // Force a full remount of McpAppGlobalHostProvider (simulating HMR remount).
  rerender(<RemountHarness hostGeneration={2} />);

  const tabHostAfterRemount = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-tab-host="tc-overlay-1"]',
  )!;
  const wrapperAfterRemount = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-1"]',
  )!;
  expect(tabHostAfterRemount).not.toBeNull();
  expect(tabHostAfterRemount.contains(wrapperAfterRemount)).toBe(true);
  expect(
    container.querySelector(
      '[data-spirit-mcp-app-card="tc-overlay-1"][data-spirit-mcp-app-placeholder="fullscreen"]',
    ),
  ).not.toBeNull();

  // Closing the preserved right-panel tab still transitions the remounted host back to inline.
  const closeTabBtn = container.querySelector<HTMLButtonElement>(
    '[data-testid="right-tab-close-tc-overlay-1"]',
  )!;
  await act(async () => {
    fireEvent.click(closeTabBtn);
  });
  expect(container.querySelector('[data-spirit-mcp-app-tab-host="tc-overlay-1"]')).toBeNull();
  const restoredSlot = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-slot="tc-overlay-1"]',
  )!;
  expect(restoredSlot.contains(wrapperAfterRemount)).toBe(true);
});

test("StrictMode mount does not leak duplicate PostMessageTransport listeners or trigger false draft-conflict dialog on ui/message", async () => {
  const visibleSlotRect = new DOMRect(200, 120, 640, 300);
  let draft = "";
  const onReplaceComposerText = vi.fn((text: string) => {
    draft = text;
  });
  const onFocusComposer = vi.fn();

  const { container } = render(
    <StrictMode>
      <ThemeProvider>
        <TooltipProvider>
          <UiTestProviders>
            <McpAppWorkspaceTabBridgeProvider openMcpAppTab={() => {}} closeMcpAppTab={() => {}}>
              <McpAppGlobalHostProvider
                activeSessionKey="sess-strict-ui-msg"
                sandboxUrl="http://127.0.0.1:65432/sandbox.html"
                runtime={mockRuntime}
                conversationSurfaceVisible
              >
                <McpAppPaneProvider
                  sessionKey="sess-strict-ui-msg"
                  sandboxUrl="http://127.0.0.1:65432/sandbox.html"
                  runtime={mockRuntime}
                  getCurrentComposerText={() => draft}
                  onReplaceComposerText={onReplaceComposerText}
                  onAppendComposerText={(text) => {
                    draft = draft ? `${draft}\n${text}` : text;
                  }}
                  onFocusComposer={onFocusComposer}
                  onOpenExternalUrl={async () => {}}
                >
                  <div
                    ref={(node) => {
                      const slots = node?.querySelectorAll<HTMLDivElement>(
                        "[data-spirit-mcp-app-slot]",
                      );
                      slots?.forEach((slot) => {
                        slot.getBoundingClientRect = () => visibleSlotRect;
                      });
                    }}
                  >
                    <McpAppToolCard tool={sampleTool} />
                  </div>
                </McpAppPaneProvider>
              </McpAppGlobalHostProvider>
            </McpAppWorkspaceTabBridgeProvider>
          </UiTestProviders>
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const iframe = container.querySelector<HTMLIFrameElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-1"] iframe',
  )!;
  expect(iframe.contentWindow).not.toBeNull();

  // One ui/message from the iframe while composer is empty must prefill exactly once with no conflict dialog.
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          jsonrpc: "2.0",
          id: 101,
          method: "ui/message",
          params: {
            role: "user",
            content: [{ type: "text", text: "Hello from app" }],
          },
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(onReplaceComposerText).toHaveBeenCalledTimes(1);
  expect(onReplaceComposerText).toHaveBeenCalledWith("Hello from app");
  expect(draft).toBe("Hello from app");
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  // A subsequent ui/message while composer already has draft text still opens the conflict dialog.
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          jsonrpc: "2.0",
          id: 102,
          method: "ui/message",
          params: {
            role: "user",
            content: [{ type: "text", text: "Second message" }],
          },
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(onReplaceComposerText).toHaveBeenCalledTimes(1);
  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain("GitHub Get Me");
  expect(dialog?.textContent).toContain("Second message");

  // Dismissing the dialog must keep dynamic app name & message mounted during Radix exit animation
  // (cleared via runAfterRadixOverlayClose instead of synchronously wiping to empty).
  vi.useFakeTimers();
  try {
    const cancelBtn = dialog!.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    // Immediately after dismiss, payload is still intact if a reopen happens or while closing animates.
    const closingDialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    if (closingDialog) {
      expect(closingDialog.textContent).toContain("GitHub Get Me");
      expect(closingDialog.textContent).toContain("Second message");
    }

    // Reopening before the 100ms close timer expires must not be wiped by the stale timer.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            jsonrpc: "2.0",
            id: 103,
            method: "ui/message",
            params: {
              role: "user",
              content: [{ type: "text", text: "Third message" }],
            },
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    const reopenedDialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(reopenedDialog).not.toBeNull();
    expect(reopenedDialog?.textContent).toContain("GitHub Get Me");
    expect(reopenedDialog?.textContent).toContain("Third message");
  } finally {
    vi.useRealTimers();
  }
});

test("inline ui/request-display-mode allows focused iframe userActivation and blocks unsolicited escalation", async () => {
  const visibleSlotRect = new DOMRect(200, 120, 640, 300);
  const { container } = render(<Harness slotRect={visibleSlotRect} />);

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const wrapper = container.querySelector<HTMLDivElement>(
    '[data-spirit-mcp-app-instance="tc-overlay-1"]',
  )!;
  const iframe = wrapper.querySelector<HTMLIFrameElement>("iframe")!;
  expect(wrapper.getAttribute("data-spirit-mcp-app-mode")).toBe("inline");

  const originalUserActivation = Object.getOwnPropertyDescriptor(navigator, "userActivation");
  const setUserActivation = (isActive: boolean) => {
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { isActive, hasBeenActive: isActive },
    });
  };

  try {
    // 1. Unsolicited request with no userActivation -> blocked.
    setUserActivation(false);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            jsonrpc: "2.0",
            id: 201,
            method: "ui/request-display-mode",
            params: { mode: "pip" },
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(wrapper.getAttribute("data-spirit-mcp-app-mode")).toBe("inline");

    // 2. Host window has userActivation (e.g. user clicked sidebar/composer), but iframe is NOT focused -> blocked.
    setUserActivation(true);
    (document.body as HTMLElement).focus();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            jsonrpc: "2.0",
            id: 202,
            method: "ui/request-display-mode",
            params: { mode: "fullscreen" },
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(wrapper.getAttribute("data-spirit-mcp-app-mode")).toBe("inline");

    // 3. User clicked inside the cross-origin iframe (userActivation.isActive && activeElement === iframe, no wrapper pointerDown) -> allowed!
    iframe.focus();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            jsonrpc: "2.0",
            id: 203,
            method: "ui/request-display-mode",
            params: { mode: "pip" },
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(wrapper.getAttribute("data-spirit-mcp-app-mode")).toBe("pip");
  } finally {
    if (originalUserActivation) {
      Object.defineProperty(navigator, "userActivation", originalUserActivation);
    } else {
      Reflect.deleteProperty(navigator, "userActivation");
    }
  }
});
