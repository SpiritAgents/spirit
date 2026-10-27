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
import { emptyModelRef } from "@/lib/model-ref";

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
