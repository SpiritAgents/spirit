/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  };
}

import "./setup";

import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, test } from "vitest";

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
});
