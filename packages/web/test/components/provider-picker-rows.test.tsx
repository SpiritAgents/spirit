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
  } as never;
}

import "./setup";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ModelsSettingsPanel } from "@/components/settings/models/models-settings-panel";
import { ProviderFeaturedSection } from "@/components/settings/models/provider-featured-section";
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
      onDisconnectProvider={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Connect Provider" }));
  expect(screen.getByRole("dialog", { name: "Select Provider" })).toBeTruthy();
  expect(
    screen.getByText("Connect Provider", { selector: "[data-slot=dialog-title]" }),
  ).toBeTruthy();
});

test("provider picker shows one featured heading immediately when opened", () => {
  render(
    <ModelsSettingsPanel
      settings={{ activeModel: emptyModelRef() } as SettingsFormState}
      snapshot={
        {
          config: {
            providers: [],
            providerPickerPresets: [
              { id: "openai", label: "OpenAI", featured: true },
              { id: "mistral", label: "Mistral" },
            ],
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
      onDisconnectProvider={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Connect Provider" }));
  const dialog = screen.getByRole("dialog", { name: "Select Provider" });
  expect(within(dialog).getAllByRole("heading", { name: "Featured" })).toHaveLength(1);
});

test("featured heading stays in the scroll content and pin state only drives the rows fade", () => {
  type ObserverProbe = {
    callback: IntersectionObserverCallback;
    elements: Set<Element>;
  };
  const observers: ObserverProbe[] = [];
  const OriginalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    private readonly probe: ObserverProbe;

    constructor(callback: IntersectionObserverCallback) {
      this.probe = { callback, elements: new Set() };
      observers.push(this.probe);
    }

    observe(element: Element) {
      this.probe.elements.add(element);
    }

    unobserve(element: Element) {
      this.probe.elements.delete(element);
    }

    disconnect() {}
  } as never;

  const emit = (element: Element, isIntersecting: boolean) => {
    const observer = observers.find((probe) => probe.elements.has(element));
    expect(observer).toBeDefined();
    act(() => {
      observer?.callback([{ isIntersecting } as IntersectionObserverEntry], undefined as never);
    });
  };

  try {
    const { container } = render(
      <ProviderFeaturedSection
        label="Featured"
        rows={[{ id: "openai", label: "OpenAI", featured: true }]}
        onSelect={vi.fn()}
      >
        <ProviderPickerRowButton row={{ id: "mistral", label: "Mistral" }} onSelect={vi.fn()} />
      </ProviderFeaturedSection>,
    );
    const heading = screen.getByRole("heading", { name: "Featured" });
    const section = heading.closest("section");
    const sentinel = heading.previousElementSibling;
    const rowsClip = container.querySelector<HTMLElement>(".spirit-dock-clip");
    const scrollArea = container.querySelector<HTMLElement>('[data-slot="scroll-area"]');
    expect(section).not.toBeNull();
    expect(sentinel).not.toBeNull();
    expect(heading.closest("[data-radix-scroll-area-viewport]")).not.toBeNull();
    expect(heading.nextElementSibling).toBe(rowsClip);
    expect(within(rowsClip as HTMLElement).getByRole("button", { name: "OpenAI" })).toBeTruthy();
    expect(rowsClip?.contains(screen.getByRole("button", { name: "Mistral" }))).toBe(false);

    const fadeAlpha = () => rowsClip?.style.getPropertyValue("--list-mask-top-alpha");
    const geometry = () => ({
      headingParent: heading.parentElement,
      heading: heading.className,
      section: section?.className,
      list: section?.parentElement?.className,
      rowsClip: rowsClip?.className,
      scrollAreaClip: scrollArea?.style.clipPath,
    });
    const initialGeometry = geometry();
    expect(initialGeometry.headingParent).toBe(section);
    expect(initialGeometry.scrollAreaClip).toBe("");
    expect(fadeAlpha()).toBe("1");

    emit(sentinel as Element, false);
    expect(fadeAlpha()).toBe("0");
    expect(geometry()).toEqual(initialGeometry);
    expect(screen.getAllByRole("heading", { name: "Featured" })).toEqual([heading]);

    emit(sentinel as Element, true);
    expect(fadeAlpha()).toBe("1");
    expect(geometry()).toEqual(initialGeometry);
  } finally {
    globalThis.IntersectionObserver = OriginalIntersectionObserver;
  }
});

test("settings keeps a connected provider visible when its catalog is empty", () => {
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
      onDisconnectProvider={vi.fn()}
    />,
  );

  expect(screen.getByText("Mistral")).toBeTruthy();
  expect(screen.queryByText("0 models")).toBeNull();
  const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
  expect(disconnectButton.getAttribute("data-variant")).toBe("secondary");
  fireEvent.click(disconnectButton);
  const dialog = screen.getByRole("alertdialog", { name: 'Disconnect "Mistral"?' });
  expect(
    within(dialog).getByText("Its models, configuration, and key will be removed from Spirit."),
  ).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Disconnect" })).toBeTruthy();
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
      onDisconnectProvider={vi.fn()}
    />,
  );

  expect(screen.getByText(/No Shared Endpoints are deployed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  expect(screen.getByRole("dialog", { name: "Connect Modal" })).toBeTruthy();
  expect(screen.getByLabelText("Proxy Token")).toBeTruthy();
});
