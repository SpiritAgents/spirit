/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";
import {
  ModelPickerInspectorPanel,
  modelPickerInspectorNeedsWideLayout,
} from "@/components/model-picker-inspector-panel";
import type { ModelProfileSnapshot, ModelRef, PreviewModelCatalogEntry } from "@/types";

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

type ServiceTierChange = (
  ref: ModelRef,
  tier: ModelServiceTier | undefined,
) => void | Promise<boolean>;

const OPENAI_TIERS = ["auto", "default", "flex", "fast"] as const;
const LIMITED_OPENAI_TIERS = {
  auto: { body: { service_tier: "auto" } },
  default: { body: { service_tier: "default" } },
  flex: { body: { service_tier: "flex" } },
  fast: { body: { service_tier: "fast" }, maxInputTokens: 278528 },
};

function tierModel(overrides: Partial<ModelProfileSnapshot> = {}): ModelProfileSnapshot {
  return {
    name: "gpt-5",
    apiBase: "https://api.openai.com/v1",
    providerId: "openai",
    ref: { providerId: "openai", name: overrides.name ?? "gpt-5" },
    serviceTiers: [...OPENAI_TIERS],
    transportKind: "openai-compatible",
    ...overrides,
  };
}

function renderInspector(
  model: ModelProfileSnapshot,
  options: {
    catalogEntry?: PreviewModelCatalogEntry;
    lastInputTokens?: number;
    onServiceTierChange?: ServiceTierChange;
  } = {},
) {
  const { catalogEntry, lastInputTokens, onServiceTierChange } = options;
  return render(
    <ModelPickerInspectorPanel
      model={model}
      {...(catalogEntry ? { catalogEntry } : {})}
      {...(lastInputTokens !== undefined ? { lastInputTokens } : {})}
      providerLabel="Provider"
      onEffortChange={() => {}}
      {...(onServiceTierChange ? { onServiceTierChange } : {})}
    />,
  );
}

function serviceTierTrigger(): HTMLElement {
  const label = screen.getByText("Service Tier");
  const row = label.parentElement;
  const trigger = row?.querySelector("[role='combobox']");
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("Service Tier select trigger not found");
  }
  return trigger;
}

async function pickServiceTierOption(trigger: HTMLElement, optionName: string) {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name: optionName });
  act(() => option.focus());
  fireEvent.keyDown(option, { key: "Enter" });
}

test("a model with declared tiers shows the select and resolves Default when unset", async () => {
  renderInspector(tierModel(), { onServiceTierChange: vi.fn() });

  const trigger = serviceTierTrigger();
  expect(trigger.textContent).toBe("Default");

  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Auto", "Default", "Flex", "Fast"]);
});

test("an Ultrafast declaration adds the option to the select", async () => {
  renderInspector(tierModel({ serviceTiers: [...OPENAI_TIERS, "ultrafast"] }), {
    onServiceTierChange: vi.fn(),
  });

  fireEvent.keyDown(serviceTierTrigger(), { key: "ArrowDown" });
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    "Auto",
    "Default",
    "Flex",
    "Fast",
    "Ultrafast",
  ]);
});

test("a Default/Priority declaration renders the Priority switch instead of the dropdown", () => {
  const onServiceTierChange = vi.fn<ServiceTierChange>().mockResolvedValue(true);
  const model = tierModel({
    name: "grok-4",
    providerId: "xai",
    ref: { providerId: "xai", name: "grok-4" },
    serviceTiers: ["default", "priority"],
  });
  renderInspector(model, { onServiceTierChange });

  expect(screen.queryByText("Service Tier")).toBeNull();
  const toggle = screen.getByRole("switch", { name: "Priority" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(toggle);
  expect(onServiceTierChange).toHaveBeenCalledWith(
    { providerId: "xai", name: "grok-4" },
    "priority",
  );
});

test("the Priority switch toggles off by clearing the stored preference", () => {
  const onServiceTierChange = vi.fn<ServiceTierChange>().mockResolvedValue(true);
  const model = tierModel({
    name: "x-ai/grok-4",
    providerId: "openrouter",
    ref: { providerId: "openrouter", name: "x-ai/grok-4" },
    serviceTiers: ["default", "priority"],
    serviceTier: "priority",
  });
  renderInspector(model, { onServiceTierChange });

  const toggle = screen.getByRole("switch", { name: "Priority" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(toggle);
  expect(onServiceTierChange).toHaveBeenCalledWith(
    { providerId: "openrouter", name: "x-ai/grok-4" },
    undefined,
  );
});

test("a literal tier map with a single fast tier renders the Fast switch", () => {
  const onServiceTierChange = vi.fn<ServiceTierChange>().mockResolvedValue(true);
  renderInspector(
    tierModel({
      name: "claude-opus-4-8",
      providerId: "anthropic",
      ref: { providerId: "anthropic", name: "claude-opus-4-8" },
      transportKind: "anthropic",
      serviceTiers: { fast: { headers: { "anthropic-beta": "fast-mode-2026-02-01" } } },
    }),
    { onServiceTierChange },
  );

  expect(screen.queryByText("Service Tier")).toBeNull();
  expect(screen.getByText("Fast")).toBeTruthy();
  const toggle = screen.getByRole("switch", { name: "Fast" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(toggle);
  expect(onServiceTierChange).toHaveBeenCalledWith(
    { providerId: "anthropic", name: "claude-opus-4-8" },
    "fast",
  );
});

test("the Fast switch toggling off clears the preference with undefined", () => {
  const onServiceTierChange = vi.fn<ServiceTierChange>().mockResolvedValue(true);
  renderInspector(
    tierModel({
      name: "claude-opus-4-8",
      providerId: "anthropic",
      ref: { providerId: "anthropic", name: "claude-opus-4-8" },
      transportKind: "anthropic",
      serviceTiers: { fast: { headers: { "anthropic-beta": "fast-mode-2026-02-01" } } },
      serviceTier: "fast",
    }),
    { onServiceTierChange },
  );

  const toggle = screen.getByRole("switch", { name: "Fast" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");

  fireEvent.click(toggle);
  expect(onServiceTierChange).toHaveBeenCalledWith(
    { providerId: "anthropic", name: "claude-opus-4-8" },
    undefined,
  );
});

test("a model without declared tiers renders no Service Tier control", () => {
  renderInspector(
    tierModel({ name: "deepseek-chat", providerId: "deepseek", serviceTiers: undefined }),
    { onServiceTierChange: vi.fn() },
  );
  expect(screen.queryByText("Service Tier")).toBeNull();
  expect(screen.queryByText("Fast")).toBeNull();
});

test("the catalog entry's tiers enable the control when the model declares none", async () => {
  const gatewayModel = tierModel({
    name: "my-gateway-model",
    apiBase: "https://gateway.example/v1",
    providerId: "vercel-ai-gateway",
    ref: { providerId: "vercel-ai-gateway", name: "my-gateway-model" },
    serviceTiers: undefined,
  });

  const { unmount } = renderInspector(gatewayModel, { onServiceTierChange: vi.fn() });
  expect(screen.queryByText("Service Tier")).toBeNull();
  unmount();

  renderInspector(gatewayModel, {
    catalogEntry: { id: "my-gateway-model", serviceTiers: ["default", "flex", "fast"] },
    onServiceTierChange: vi.fn(),
  });
  const trigger = serviceTierTrigger();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Default", "Flex", "Fast"]);
});

test("selecting a tier fires the callback with the picked value", async () => {
  const onServiceTierChange = vi.fn<ServiceTierChange>().mockResolvedValue(true);
  const model = tierModel();
  renderInspector(model, { onServiceTierChange });

  await pickServiceTierOption(serviceTierTrigger(), "Fast");
  expect(onServiceTierChange).toHaveBeenCalledWith(model.ref, "fast");
});

test("a failed save rolls the displayed tier back to the stored value", async () => {
  let resolveSave: (ok: boolean) => void = () => {};
  const onServiceTierChange = vi.fn<ServiceTierChange>(
    () =>
      new Promise<boolean>((resolve) => {
        resolveSave = resolve;
      }),
  );
  renderInspector(tierModel(), { onServiceTierChange });

  const trigger = serviceTierTrigger();
  await pickServiceTierOption(trigger, "Fast");
  expect(trigger.textContent).toBe("Fast");

  await act(async () => {
    resolveSave(false);
  });
  expect(trigger.textContent).toBe("Default");
});

test("the displayed tier follows the stored preference", () => {
  renderInspector(tierModel({ serviceTier: "flex" }), { onServiceTierChange: vi.fn() });
  expect(serviceTierTrigger().textContent).toBe("Flex");
});

test("input-limited fast displays Default and is disabled above the limit", async () => {
  renderInspector(tierModel({ serviceTiers: LIMITED_OPENAI_TIERS, serviceTier: "fast" }), {
    onServiceTierChange: vi.fn(),
    lastInputTokens: 278529,
  });

  expect(serviceTierTrigger().textContent).toBe("Default");
  expect(screen.getByText("Fast is unavailable above 272K input tokens.")).toBeTruthy();
  fireEvent.keyDown(serviceTierTrigger(), { key: "ArrowDown" });
  const fastOption = await screen.findByRole("option", { name: "Fast" });
  expect(fastOption.getAttribute("aria-disabled")).toBe("true");
});

test("input-limited fast stays available with unknown usage and at the exact boundary", async () => {
  for (const lastInputTokens of [undefined, 278528]) {
    const { unmount } = renderInspector(
      tierModel({ serviceTiers: LIMITED_OPENAI_TIERS, serviceTier: "fast" }),
      {
        onServiceTierChange: vi.fn(),
        ...(lastInputTokens !== undefined ? { lastInputTokens } : {}),
      },
    );

    expect(serviceTierTrigger().textContent).toBe("Fast");
    expect(screen.queryByText("Fast is unavailable above 272K input tokens.")).toBeNull();
    fireEvent.keyDown(serviceTierTrigger(), { key: "ArrowDown" });
    const fastOption = await screen.findByRole("option", { name: "Fast" });
    expect(fastOption.getAttribute("aria-disabled")).not.toBe("true");
    unmount();
  }
});

test("without the callback the tier controls do not render", () => {
  renderInspector(tierModel());
  expect(screen.queryByText("Service Tier")).toBeNull();

  renderInspector(
    tierModel({
      name: "claude-opus-4-8",
      providerId: "anthropic",
      transportKind: "anthropic",
      serviceTiers: { fast: { headers: { "anthropic-beta": "fast-mode-2026-02-01" } } },
    }),
  );
  expect(screen.queryByText("Fast")).toBeNull();
});

test("modelPickerInspectorNeedsWideLayout includes models with a tier control", () => {
  const gatewayModel = tierModel({
    name: "my-gateway-model",
    apiBase: "https://gateway.example/v1",
    providerId: "vercel-ai-gateway",
    serviceTiers: undefined,
  });
  // Without declared tiers anywhere the row stays narrow.
  expect(modelPickerInspectorNeedsWideLayout(gatewayModel)).toBe(false);
  // The catalog entry's declared tiers enable the tier control and the wide layout.
  expect(
    modelPickerInspectorNeedsWideLayout(gatewayModel, {
      id: "my-gateway-model",
      serviceTiers: ["default", "flex", "fast"],
    }),
  ).toBe(true);
  // A literal fast declaration (Anthropic native Fast) also participates.
  expect(
    modelPickerInspectorNeedsWideLayout(
      tierModel({
        name: "claude-opus-4-8",
        providerId: "anthropic",
        transportKind: "anthropic",
        serviceTiers: { fast: { headers: { "anthropic-beta": "fast-mode-2026-02-01" } } },
      }),
    ),
  ).toBe(true);
  // A model with no declarations and no other detail body stays narrow.
  expect(
    modelPickerInspectorNeedsWideLayout(
      tierModel({ name: "my-local-model", providerId: "custom", serviceTiers: undefined }),
    ),
  ).toBe(false);
});
