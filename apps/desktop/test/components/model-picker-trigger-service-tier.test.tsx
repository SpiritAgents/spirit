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

const OPENAI_TIERS = ["auto", "default", "flex", "fast"] as const;

function triggerModel(overrides: Partial<ModelProfileSnapshot> = {}): ModelProfileSnapshot {
  const name = overrides.name ?? "gpt-5";
  const providerId = overrides.providerId ?? "openai";
  return {
    name,
    apiBase: "https://api.openai.com/v1",
    reasoningEffort: "medium",
    providerId,
    ref: { providerId, name },
    supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
    serviceTiers: [...OPENAI_TIERS],
    transportKind: "openai-compatible",
    ...overrides,
  };
}

function modelRefOf(model: ModelProfileSnapshot): ModelRef {
  return model.ref;
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

test("Claude output effort shows Default without sending a selection", () => {
  const trigger = renderPickerTrigger(
    triggerModel({
      name: "claude-opus-4.8",
      providerId: "anthropic",
      reasoningEffort: undefined,
      supportedReasoningEfforts: undefined,
      effortSemantics: "output",
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    }),
  );
  expect(trigger.textContent).toContain("Default");
  expect(trigger.textContent).not.toContain("Default (");
});

test("a selected Claude output effort replaces the default trigger label", () => {
  const trigger = renderPickerTrigger(
    triggerModel({
      name: "claude-opus-4.8",
      providerId: "anthropic",
      reasoningEffort: undefined,
      supportedReasoningEfforts: undefined,
      effortSemantics: "output",
      effort: "xhigh",
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    }),
  );
  expect(trigger.textContent).toContain("Extra High");
  expect(trigger.textContent).not.toContain("Default");
});

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
    triggerModel({
      name: "gpt-6-astra",
      serviceTier: "ultrafast",
      serviceTiers: [...OPENAI_TIERS, "ultrafast"],
    }),
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
          activeModelRef={{ providerId: "openai", name: "gpt-5" }}
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

test("a Priority tier appends the Priority suffix", () => {
  const trigger = renderPickerTrigger(
    triggerModel({
      name: "grok-4",
      providerId: "xai",
      serviceTier: "priority",
      serviceTiers: ["default", "priority"],
    }),
  );
  expect(trigger.textContent).toContain("Priority");
});

test("the suffix resolves declared tiers from the catalog hint when the model lacks them", () => {
  const model = triggerModel({
    name: "my-gateway-model",
    apiBase: "https://gateway.example/v1",
    providerId: "openrouter",
    serviceTier: "fast",
    serviceTiers: undefined,
  });
  const catalogHints: DesktopModelCatalogHint[] = [
    {
      providerId: "openrouter",
      apiBase: "https://gateway.example/v1",
      modelIds: ["my-gateway-model"],
      modelCatalog: [{ id: "my-gateway-model", serviceTiers: ["default", "flex", "fast"] }],
      fetchedAtUnixMs: 1,
    },
  ];

  const withCatalog = renderPickerTrigger(model, catalogHints);
  expect(withCatalog.textContent).toContain("Fast");
});

test("a model without declared tiers anywhere hides the suffix", () => {
  const trigger = renderPickerTrigger(
    triggerModel({
      name: "my-gateway-model",
      apiBase: "https://gateway.example/v1",
      providerId: "openrouter",
      serviceTier: "fast",
      serviceTiers: undefined,
    }),
  );
  expect(trigger.textContent).not.toContain("Fast");
});

test("an Anthropic model with the stored fast tier shows the Fast suffix", () => {
  const trigger = renderPickerTrigger(
    triggerModel({
      name: "claude-opus-4-8",
      providerId: "anthropic",
      transportKind: "anthropic",
      serviceTier: "fast",
      serviceTiers: { fast: { headers: { "anthropic-beta": "fast-mode-2026-02-01" } } },
    }),
  );
  expect(trigger.textContent).toContain("Fast");
});
