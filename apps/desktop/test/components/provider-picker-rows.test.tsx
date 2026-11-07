/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ModelsSettingsPanel } from "@/components/settings/models/models-settings-panel";
import { ProviderPickerRowButton } from "@/components/settings/models/provider-picker-rows";
import type { SettingsFormState } from "@/components/settings/types";
import { emptyModelRef } from "@spiritagent/ui/model-picker";

test("provider picker rows use a fixed sparkle icon for every provider", () => {
  const { container } = render(
    <>
      <ProviderPickerRowButton row={{ id: "provider-a", label: "Provider A" }} onSelect={vi.fn()} />
      <ProviderPickerRowButton row={{ id: "provider-b", label: "Provider B" }} onSelect={vi.fn()} />
    </>,
  );

  const icons = container.querySelectorAll("button svg.lucide-sparkles");
  expect(icons).toHaveLength(2);
  for (const icon of icons) {
    expect(icon.getAttribute("class")).toContain("size-4");
    expect(icon.getAttribute("class")).toContain("shrink-0");
  }
});

test("provider picker keeps a selection-specific accessible name", () => {
  render(
    <ModelsSettingsPanel
      settings={{ activeModel: emptyModelRef() } as SettingsFormState}
      snapshot={null}
      modelsBusy={false}
      modelsPreviewBusy={false}
      onSavePatch={vi.fn()}
      onAddModel={vi.fn()}
      onAddProviderModels={vi.fn()}
      onPreviewModels={vi.fn()}
      onRemoveModel={vi.fn()}
      onRemoveProviderModels={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Connect Provider" }));
  expect(screen.getByRole("dialog", { name: "Select Provider" })).toBeTruthy();
  expect(
    screen.getByText("Connect Provider", { selector: "[data-slot=dialog-title]" }),
  ).toBeTruthy();
});

test("settings keeps a connected provider group visible when its catalog is empty", () => {
  render(
    <ModelsSettingsPanel
      settings={{ activeModel: emptyModelRef() } as SettingsFormState}
      snapshot={
        {
          config: {
            providers: [
              {
                id: "mistral",
                apiBase: "https://api.mistral.ai/v1",
                models: [],
              },
            ],
            providerPickerPresets: [{ id: "mistral", label: "Mistral" }],
            models: [],
            activeModel: emptyModelRef(),
            modelCatalogHints: [],
          },
        } as never
      }
      modelsBusy={false}
      modelsPreviewBusy={false}
      onSavePatch={vi.fn()}
      onAddModel={vi.fn()}
      onAddProviderModels={vi.fn()}
      onPreviewModels={vi.fn()}
      onRemoveModel={vi.fn()}
      onRemoveProviderModels={vi.fn()}
    />,
  );

  expect(screen.getByText("Mistral")).toBeTruthy();
  expect(screen.getByText("0 models")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Delete Group" })).toBeTruthy();
  expect(screen.queryByText("No saved models yet")).toBeNull();
});

test("modal empty state explains deployment and offers reconnect", () => {
  render(
    <ModelsSettingsPanel
      settings={{ activeModel: emptyModelRef() } as SettingsFormState}
      snapshot={
        {
          config: {
            providers: [
              {
                id: "modal",
                apiBase: "https://inference.us-west.modal.direct/v1",
                models: [],
              },
            ],
            providerPickerPresets: [{ id: "modal", label: "Modal" }],
            models: [],
            activeModel: emptyModelRef(),
            modelCatalogHints: [],
          },
        } as never
      }
      modelsBusy={false}
      modelsPreviewBusy={false}
      onSavePatch={vi.fn()}
      onAddModel={vi.fn()}
      onAddProviderModels={vi.fn()}
      onPreviewModels={vi.fn()}
      onRemoveModel={vi.fn()}
      onRemoveProviderModels={vi.fn()}
    />,
  );

  expect(screen.getByText(/No Shared Endpoints are deployed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  expect(screen.getByRole("dialog", { name: "Connect Modal" })).toBeTruthy();
  expect(screen.getByLabelText("Proxy Token")).toBeTruthy();
});
