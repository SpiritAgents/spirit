/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

type IntersectionCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let lastIntersectionCallback: IntersectionCallback | null = null;

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionCallback) {
      lastIntersectionCallback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
}

import "./setup";

import { act, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, test, vi } from "vitest";

import { MarketplaceView } from "@/components/marketplace-view";

const viewProps = {
  snapshot: null,
  extensionsBusy: false,
  onImportExtension: async () => {},
  onInstallMarketplaceExtension: async () => ({ status: "installed" as const }),
  onUpdateExtension: async () => ({ status: "up-to-date" as const }),
  onAddMarketplaceSource: async () => ({ sourceId: "source" }),
  onRemoveMarketplaceSource: async () => {},
  onPickMarketplaceDirectory: async () => null,
  onDeleteExtension: async () => {},
  onSetExtensionEnabled: async () => {},
};

async function flushScheduledFocus(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      queueMicrotask(() => resolve());
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("MarketplaceView search focus", () => {
  test("focuses the search field when the page mounts", async () => {
    const { getByPlaceholderText } = render(
      <StrictMode>
        <MarketplaceView {...viewProps} />
      </StrictMode>,
    );

    await flushScheduledFocus();

    expect(document.activeElement).toBe(getByPlaceholderText("Search extensions"));
  });

  test("does not pull focus back when the page updates in place", async () => {
    const { getByPlaceholderText, getByRole, rerender } = render(
      <MarketplaceView {...viewProps} />,
    );

    await flushScheduledFocus();
    expect(document.activeElement).toBe(getByPlaceholderText("Search extensions"));

    const addButton = getByRole("button", { name: "Add" });
    addButton.focus();
    rerender(
      <MarketplaceView
        {...viewProps}
        snapshot={{ marketplaceSources: [], marketplaceCatalogAll: [] }}
      />,
    );
    await flushScheduledFocus();

    expect(document.activeElement).toBe(addButton);
  });

  test("moves the header host atomically between the in-flow anchor and overlay slots on pin transitions", async () => {
    const { container, getByPlaceholderText } = render(<MarketplaceView {...viewProps} />);
    await flushScheduledFocus();

    const searchInput = getByPlaceholderText("Search extensions");
    const scrollArea = container.querySelector('[data-slot="scroll-area"]');
    const inFlowSlot = container.querySelector(".spirit-marketplace-header-anchor") as
      | (HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void })
      | null;
    const overlaySlot = container.querySelector(".spirit-marketplace-header-overlay") as
      | (HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void })
      | null;

    expect(scrollArea).not.toBeNull();
    expect(inFlowSlot).not.toBeNull();
    expect(overlaySlot).not.toBeNull();
    expect(inFlowSlot?.contains(searchInput)).toBe(true);
    expect(scrollArea?.contains(searchInput)).toBe(true);

    const overlayMoveBefore = vi.fn((node: Node, child: Node | null) => {
      overlaySlot!.insertBefore(node, child);
    });
    const inFlowMoveBefore = vi.fn((node: Node, child: Node | null) => {
      inFlowSlot!.insertBefore(node, child);
    });
    overlaySlot!.moveBefore = overlayMoveBefore;
    inFlowSlot!.moveBefore = inFlowMoveBefore;

    act(() => {
      lastIntersectionCallback?.([{ isIntersecting: false }]);
    });

    expect(overlayMoveBefore).toHaveBeenCalledTimes(1);
    expect(overlaySlot?.contains(searchInput)).toBe(true);
    expect(scrollArea?.contains(searchInput)).toBe(false);
    expect(getByPlaceholderText("Search extensions")).toBe(searchInput);

    act(() => {
      lastIntersectionCallback?.([{ isIntersecting: true }]);
    });

    expect(inFlowMoveBefore).toHaveBeenCalledTimes(1);
    expect(inFlowSlot?.contains(searchInput)).toBe(true);
    expect(scrollArea?.contains(searchInput)).toBe(true);
    expect(getByPlaceholderText("Search extensions")).toBe(searchInput);
  });

  test("clips the scrolling list under the header without waiting for pin state", async () => {
    const entry = {
      id: "built-in/sample",
      sourceId: "built-in",
      sourceName: "built-in",
      name: "sample",
      displayName: "Sample",
      description: "Sample description",
      version: "1.0.0",
      reviewStatus: "verified" as const,
      artifactKind: "local" as const,
      supportedHosts: ["desktop" as const],
      installed: false,
      updateAvailable: false,
    };
    const snapshot = {
      marketplaceSources: [
        {
          id: "built-in",
          name: "built-in",
          displayName: "Built-in",
          kind: "local" as const,
          locator: "built-in",
          internal: true,
        },
      ],
      marketplaceCatalogs: { "built-in": [entry] },
      marketplaceCatalogAll: [entry],
    };
    const { container, getByPlaceholderText, getByRole, getByText } = render(
      <MarketplaceView {...viewProps} snapshot={snapshot} />,
    );
    await flushScheduledFocus();

    const searchInput = getByPlaceholderText("Search extensions");
    const inFlowSlot = container.querySelector(".spirit-marketplace-header-anchor");
    const dockClip = container.querySelector<HTMLElement>(".spirit-dock-clip");
    const scrollArea = container.querySelector<HTMLElement>('[data-slot="scroll-area"]');

    // Never pinned: the clip is in place from the first render, right after the header slot.
    expect(scrollArea?.style.clipPath).toBe("");
    expect(dockClip).not.toBeNull();
    expect(inFlowSlot?.nextElementSibling).toBe(dockClip);
    expect(dockClip?.childElementCount).toBe(1);
    expect(dockClip?.contains(searchInput)).toBe(false);
    expect(dockClip?.contains(getByRole("tablist"))).toBe(true);
    expect(dockClip?.contains(getByText("Sample"))).toBe(true);

    // Empty states center against the viewport, so they stay outside the clip.
    fireEvent.change(searchInput, { target: { value: "no such extension" } });
    const emptyTitle = getByText(/No results/);
    expect(dockClip?.contains(emptyTitle)).toBe(false);
    expect(scrollArea?.contains(emptyTitle)).toBe(true);
    expect(dockClip?.contains(getByRole("tablist"))).toBe(true);
  });
});
