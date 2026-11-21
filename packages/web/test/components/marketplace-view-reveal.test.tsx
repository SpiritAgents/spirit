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

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { MarketplaceView } from "@/components/marketplace-view";
import type {
  DesktopMarketplaceCatalogEntry,
  DesktopMarketplaceSource,
  DesktopSnapshot,
} from "@/types";

function catalogEntry(name: string, displayName: string): DesktopMarketplaceCatalogEntry {
  return {
    id: `built-in/${name}`,
    sourceId: "built-in",
    sourceName: "built-in",
    name,
    displayName,
    description: `${displayName} description`,
    version: "1.0.0",
    reviewStatus: "verified",
    artifactKind: "local",
    supportedHosts: ["desktop"],
    installed: true,
    updateAvailable: false,
  };
}

const source: DesktopMarketplaceSource = {
  id: "built-in",
  name: "built-in",
  displayName: "Built-in",
  kind: "local",
  locator: "built-in",
  internal: true,
};

const catalog = [catalogEntry("notes", "Notes"), catalogEntry("tasks", "Tasks")];

const snapshot = {
  marketplaceSources: [source],
  marketplaceCatalogs: { "built-in": catalog },
  marketplaceCatalogAll: catalog,
} as unknown as DesktopSnapshot;

const viewProps = {
  snapshot,
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

describe("MarketplaceView reveal requests", () => {
  test("Back leaves a revealed extension's detail page", () => {
    const { getByRole, queryByPlaceholderText } = render(
      <MarketplaceView
        {...viewProps}
        revealRequest={{ extensionId: "built-in/notes", nonce: 1 }}
      />,
    );
    expect(queryByPlaceholderText("Search extensions")).toBeNull();

    fireEvent.click(getByRole("button", { name: "Back" }));

    expect(queryByPlaceholderText("Search extensions")).not.toBeNull();
  });

  test("a new reveal request reopens the same extension", () => {
    const { getByRole, queryByPlaceholderText, rerender } = render(
      <MarketplaceView
        {...viewProps}
        revealRequest={{ extensionId: "built-in/notes", nonce: 1 }}
      />,
    );
    fireEvent.click(getByRole("button", { name: "Back" }));
    expect(queryByPlaceholderText("Search extensions")).not.toBeNull();

    rerender(
      <MarketplaceView
        {...viewProps}
        revealRequest={{ extensionId: "built-in/notes", nonce: 2 }}
      />,
    );

    expect(queryByPlaceholderText("Search extensions")).toBeNull();
    expect(document.body.textContent).toContain("Notes description");
  });
});
