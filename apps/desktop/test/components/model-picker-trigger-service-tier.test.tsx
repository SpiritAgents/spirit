/** @vitest-environment jsdom */

import "./setup";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ModelPickerMenu } from "@/components/model-picker-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DesktopModelCatalogHint, ModelProfileSnapshot, ModelRef } from "@/types";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

function triggerModel(overrides: Partial<ModelProfileSnapshot> = {}): ModelProfileSnapshot {
  return {
    name: "gpt-5",
    apiBase: "https://api.openai.com/v1",
    reasoningEffort: "medium",
    provider: "openai",
    transportKind: "openai-compatible",
    ...overrides,
  };
}

function modelRefOf(model: ModelProfileSnapshot): ModelRef {
  return { groupId: "", name: model.name };
}

function renderPickerTrigger(
  model: ModelProfileSnapshot,
  catalogHints?: DesktopModelCatalogHint[],
): HTMLElement {
  render(
    <TooltipProvider>
      <ModelPickerMenu
        models={[model]}
        {...(catalogHints ? { catalogHints } : {})}
        activeModelRef={modelRefOf(model)}
        onModelSelect={() => {}}
      />
    </TooltipProvider>,
  );
  return screen.getByRole("button", { name: "Select Model" });
}

test("a Fast tier appends the Fast suffix to the trigger label", () => {
  const trigger = renderPickerTrigger(triggerModel({ serviceTier: "fast" }));
  expect(trigger.textContent).toContain("Fast");
});

test("a Flex tier appends the Flex suffix to the trigger label", () => {
  const trigger = renderPickerTrigger(triggerModel({ serviceTier: "flex" }));
  expect(trigger.textContent).toContain("Flex");
});

test("an Ultrafast tier appends the Ultrafast suffix after the effort label", () => {
  const trigger = renderPickerTrigger(
    triggerModel({ name: "gpt-6-astra", serviceTier: "ultrafast" }),
  );
  const text = trigger.textContent ?? "";
  expect(text).toContain("Ultrafast");
  expect(text.indexOf("Ultrafast")).toBeGreaterThan(text.indexOf("Medium"));
});

test("Auto, Default, and unset tiers add no trigger suffix", () => {
  for (const serviceTier of ["auto", "default", undefined] as const) {
    const { unmount } = render(
      <TooltipProvider>
        <ModelPickerMenu
          models={[triggerModel(serviceTier === undefined ? {} : { serviceTier })]}
          activeModelRef={{ groupId: "", name: "gpt-5" }}
          onModelSelect={() => {}}
        />
      </TooltipProvider>,
    );
    const text = screen.getByRole("button", { name: "Select Model" }).textContent ?? "";
    expect(text).not.toContain("Fast");
    expect(text).not.toContain("Flex");
    expect(text).not.toContain("Ultrafast");
    unmount();
  }
});

test("a native Priority tier adds no trigger suffix", () => {
  const trigger = renderPickerTrigger(
    triggerModel({ name: "grok-4", provider: "xai", serviceTier: "priority" }),
  );
  expect(trigger.textContent).not.toContain("Priority");
});

test("the suffix resolves the upstream identity from the catalog hint when the profile lacks it", () => {
  const model = triggerModel({
    name: "my-gateway-model",
    apiBase: "https://gateway.example/v1",
    provider: "openrouter",
    serviceTier: "fast",
  });
  const catalogHints: DesktopModelCatalogHint[] = [
    {
      provider: "openrouter",
      transportKind: "openai-compatible",
      apiBase: "https://gateway.example/v1",
      modelIds: ["my-gateway-model"],
      modelCatalog: [{ id: "my-gateway-model", upstreamProvider: "openai" }],
      fetchedAtUnixMs: 1,
    },
  ];

  const withCatalog = renderPickerTrigger(model, catalogHints);
  expect(withCatalog.textContent).toContain("Fast");
});

test("an unknown aggregator upstream identity hides the suffix", () => {
  const trigger = renderPickerTrigger(
    triggerModel({
      name: "my-gateway-model",
      apiBase: "https://gateway.example/v1",
      provider: "openrouter",
      serviceTier: "fast",
    }),
  );
  expect(trigger.textContent).not.toContain("Fast");
});

test("an Anthropic model with the stored fast tier shows the Fast suffix", () => {
  const trigger = renderPickerTrigger(
    triggerModel({
      name: "claude-opus-4-8",
      provider: "anthropic",
      transportKind: "anthropic",
      serviceTier: "fast",
    }),
  );
  expect(trigger.textContent).toContain("Fast");
});
