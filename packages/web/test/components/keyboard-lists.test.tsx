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

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { MarketplaceView } from "@/components/marketplace-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModelsSettingsPanel } from "@/components/settings/models/models-settings-panel";
import { TranslucencyPreferenceToggles } from "@/components/settings/translucency-preference-toggles";
import type { SettingsFormState } from "@/components/settings/types";
import type { DesktopMarketplaceCatalogEntry } from "@/types";

async function flushFocus() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

const modelSettings = {
  activeModel: { providerId: "provider-a", name: "model-a" },
} as SettingsFormState;

const modelSnapshot = {
  config: {
    providers: [
      {
        id: "provider-a",
        label: "Provider A",
        apiBase: "",
        models: [
          { name: "model-a", apiBase: "" },
          { name: "model-b", apiBase: "" },
        ],
      },
    ],
    providerPickerPresets: [{ id: "provider-a", label: "Provider A" }],
    models: [
      {
        providerId: "provider-a",
        ref: { providerId: "provider-a", name: "model-a" },
        name: "model-a",
        apiBase: "",
        capabilities: ["languageModel"],
      },
      {
        providerId: "provider-a",
        ref: { providerId: "provider-a", name: "model-b" },
        name: "model-b",
        apiBase: "",
        capabilities: ["languageModel"],
      },
    ],
    activeModel: { providerId: "provider-a", name: "model-a" },
    modelCatalogHints: [],
  },
};

test("model rows form one vertical keyboard list per provider", async () => {
  render(
    <ModelsSettingsPanel
      settings={modelSettings}
      snapshot={modelSnapshot as never}
      modelsBusy={false}
      modelsPreviewBusy={false}
      onSavePatch={vi.fn()}
      onAddModel={vi.fn()}
      onAddProviderModels={vi.fn()}
      onPreviewModels={vi.fn()}
      onRemoveModel={vi.fn()}
      onDisconnectProvider={vi.fn()}
    />,
  );
  const modelA = screen.getByRole("button", { name: /Model A/ });
  const modelB = screen.getByRole("button", { name: /Model B/ });
  const group = modelA.parentElement as HTMLElement;

  expect(group.dataset.orientation).toBe("vertical");
  expect(modelA.tabIndex).toBe(-1);
  expect(modelB.tabIndex).toBe(-1);
  expect(group.tabIndex).toBe(0);

  act(() => group.focus());
  expect(document.activeElement).toBe(modelA);
  expect(modelA.tabIndex).toBe(0);
  expect(modelB.tabIndex).toBe(-1);

  fireEvent.keyDown(modelA, { key: "ArrowDown" });
  await flushFocus();
  expect(document.activeElement).toBe(modelB);
  expect(modelA.tabIndex).toBe(-1);
  expect(modelB.tabIndex).toBe(0);
});

test("provider and model rows use content-inset dividers", () => {
  render(
    <ModelsSettingsPanel
      settings={modelSettings}
      snapshot={modelSnapshot as never}
      modelsBusy={false}
      modelsPreviewBusy={false}
      onSavePatch={vi.fn()}
      onAddModel={vi.fn()}
      onAddProviderModels={vi.fn()}
      onPreviewModels={vi.fn()}
      onRemoveModel={vi.fn()}
      onDisconnectProvider={vi.fn()}
    />,
  );

  const providerLabel = screen.getByText("Provider A");
  const providerHeader = providerLabel.parentElement?.parentElement as HTMLElement;
  expect(providerHeader.className).toContain("after:left-4");
  expect(providerHeader.className).toContain("sm:after:left-5");
  expect(providerHeader.className).not.toContain("border-b border-border/35");

  const modelList = screen.getByRole("button", { name: /Model A/ }).parentElement as HTMLElement;
  expect(modelList.className).toContain("[&>*:not(:last-child)]:after:left-4");
  expect(modelList.className).toContain("sm:[&>*:not(:last-child)]:after:left-5");
  expect(modelList.className).not.toContain("divide-y");
});

function marketplaceItem(id: string, displayName: string): DesktopMarketplaceCatalogEntry {
  return {
    id: `built-in/${id}`,
    sourceId: "built-in",
    sourceName: "built-in",
    name: id,
    displayName,
    description: `${displayName} description`,
    category: "development",
    version: "1.0.0",
    reviewStatus: "verified",
    artifactKind: "local",
    installed: false,
    updateAvailable: false,
    supportedHosts: ["desktop"],
  };
}

const marketplaceViewProps = {
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

function mockRect(element: HTMLElement, left: number, top: number) {
  const rect = {
    x: left,
    y: top,
    left,
    top,
    width: 180,
    height: 40,
    right: left + 180,
    bottom: top + 40,
    toJSON: () => ({}),
  } as DOMRect;
  element.getBoundingClientRect = () => rect;
  element.getClientRects = () => [rect] as unknown as DOMRectList;
}

test("marketplace tabs and visual grid share one row-action Tab path", async () => {
  const items = [
    marketplaceItem("alpha", "Alpha"),
    marketplaceItem("beta", "Beta"),
    marketplaceItem("gamma", "Gamma"),
  ];
  render(
    <MarketplaceView
      {...marketplaceViewProps}
      snapshot={{
        marketplaceSources: [
          {
            id: "built-in",
            name: "built-in",
            displayName: "Built-in",
            kind: "local",
            locator: "/built-in",
            internal: true,
          },
        ],
        marketplaceCatalogs: { "built-in": items },
        marketplaceCatalogAll: items,
      }}
    />,
  );
  await flushFocus();

  const all = screen.getByRole("tab", { name: "All" });
  const builtIn = screen.getByRole("tab", { name: "Built-in" });
  act(() => all.focus());
  fireEvent.keyDown(all, { key: "ArrowRight" });
  await flushFocus();
  expect(document.activeElement).toBe(builtIn);
  expect(all.getAttribute("aria-selected")).toBe("true");
  expect(builtIn.getAttribute("aria-selected")).toBe("false");
  fireEvent.click(builtIn);
  expect(builtIn.getAttribute("aria-selected")).toBe("true");

  const alpha = screen.getByRole("button", { name: /Alpha description/ });
  const beta = screen.getByRole("button", { name: /Beta description/ });
  const gamma = screen.getByRole("button", { name: /Gamma description/ });
  const alphaRow = alpha.parentElement as HTMLElement;
  expect(alphaRow.className).toContain("rounded-lg");
  expect(alphaRow.className).toContain("[data-marketplace-row-primary]:focus-visible");
  expect(alpha.className).not.toContain("focus-visible:ring");
  expect(all.parentElement?.className).toContain("overflow-x-visible");
  mockRect(alpha, 0, 0);
  mockRect(beta, 200, 0);
  mockRect(gamma, 0, 50);
  const grid = alpha.closest("[data-roving-focus-grid]") as HTMLElement;
  act(() => grid.focus());
  expect(document.activeElement).toBe(alpha);

  const installButtons = screen.getAllByRole("button", { name: "Install" });
  expect(installButtons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
  fireEvent.keyDown(alpha, { key: "ArrowDown" });
  expect(document.activeElement).toBe(gamma);
  expect(installButtons.map((button) => button.tabIndex)).toEqual([-1, -1, 0]);
  fireEvent.keyDown(gamma, { key: "ArrowUp" });
  expect(document.activeElement).toBe(alpha);
  fireEvent.keyDown(alpha, { key: "ArrowRight" });
  expect(document.activeElement).toBe(beta);
});

test("radio-style toggles move focus without changing the current value", async () => {
  const onChange = vi.fn();
  render(<TranslucencyPreferenceToggles value="off" onChange={onChange} ariaLabel="Material" />);
  const off = screen.getByRole("radio", { name: "Off" });
  const sidebar = screen.getByRole("radio", { name: "Sidebar" });

  act(() => off.focus());
  fireEvent.keyDown(off, { key: "ArrowRight" });
  await flushFocus();
  expect(document.activeElement).toBe(sidebar);
  expect(onChange).not.toHaveBeenCalled();
  expect(off.getAttribute("aria-checked")).toBe("true");
  expect(sidebar.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(sidebar);
  expect(onChange).toHaveBeenCalledWith("sidebar");
});

test("unsupported install keeps its explanation tooltip keyboard accessible", async () => {
  const item = marketplaceItem("alpha", "Alpha");
  render(
    <TooltipProvider delayDuration={0}>
      <MarketplaceView
        {...marketplaceViewProps}
        snapshot={{
          marketplaceSources: [
            {
              id: "built-in",
              name: "built-in",
              displayName: "Built-in",
              kind: "http-index",
              locator: "https://example.invalid",
            },
          ],
          marketplaceCatalogs: { "built-in": [item] },
          marketplaceCatalogAll: [item],
        }}
      />
    </TooltipProvider>,
  );
  await flushFocus();
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  });
  const install = screen.getByRole("button", { name: "Install" }) as HTMLButtonElement;
  expect(install.disabled).toBe(false);
  expect(install.getAttribute("aria-disabled")).toBe("true");

  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => install.focus());
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 350);
    });
  });
  expect(screen.getByRole("tooltip").textContent).toContain(
    "HTTP marketplaces can't install extensions",
  );
});
