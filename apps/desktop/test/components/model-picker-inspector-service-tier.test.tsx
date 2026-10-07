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

function tierModel(overrides: Partial<ModelProfileSnapshot> = {}): ModelProfileSnapshot {
  return {
    name: "gpt-5",
    apiBase: "https://api.openai.com/v1",
    reasoningEffort: "default",
    provider: "openai",
    transportKind: "openai-compatible",
    ...overrides,
  };
}

function renderInspector(
  model: ModelProfileSnapshot,
  options: {
    catalogEntry?: PreviewModelCatalogEntry;
    onServiceTierChange?: ServiceTierChange;
  } = {},
) {
  const { catalogEntry, onServiceTierChange } = options;
  return render(
    <ModelPickerInspectorPanel
      model={model}
      {...(catalogEntry ? { catalogEntry } : {})}
      providerLabel="Provider"
      onReasoningEffortChange={() => {}}
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

test("OpenAI models show a Service Tier select with Auto/Default/Flex/Fast and resolve Auto by default", async () => {
  renderInspector(tierModel(), { onServiceTierChange: vi.fn() });

  const trigger = serviceTierTrigger();
  expect(trigger.textContent).toBe("Auto");

  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Auto", "Default", "Flex", "Fast"]);
});

test("gpt-6-astra additionally offers Ultrafast", async () => {
  renderInspector(tierModel({ name: "gpt-6-astra" }), { onServiceTierChange: vi.fn() });

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

test("xAI models offer Default/Priority and resolve Default by default", async () => {
  renderInspector(tierModel({ name: "grok-4", provider: "xai" }), {
    onServiceTierChange: vi.fn(),
  });

  const trigger = serviceTierTrigger();
  expect(trigger.textContent).toBe("Default");

  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Default", "Priority"]);
});

test("Vertex AI hides the control on regional endpoints and shows it on the global endpoint", async () => {
  const { unmount } = renderInspector(
    tierModel({
      name: "gemini-2.5-pro",
      provider: "google-vertex-ai",
      vertexLocation: "us-central1",
    }),
    { onServiceTierChange: vi.fn() },
  );
  expect(screen.queryByText("Service Tier")).toBeNull();
  unmount();

  renderInspector(
    tierModel({
      name: "gemini-2.5-pro",
      provider: "google-vertex-ai",
      vertexLocation: "global",
    }),
    { onServiceTierChange: vi.fn() },
  );
  const trigger = serviceTierTrigger();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Default", "Flex", "Priority"]);
});

test("providers outside the matrix render no Service Tier control", () => {
  renderInspector(tierModel({ name: "deepseek-chat", provider: "deepseek" }), {
    onServiceTierChange: vi.fn(),
  });
  expect(screen.queryByText("Service Tier")).toBeNull();
  expect(screen.queryByText("Fast Mode")).toBeNull();
});

test("a Vercel route uses the catalog upstreamProvider fact when the profile lacks one", async () => {
  const vercelModel = tierModel({
    name: "my-gateway-model",
    apiBase: "https://gateway.example/v1",
    provider: "vercel-ai-gateway",
  });

  const { unmount } = renderInspector(vercelModel, { onServiceTierChange: vi.fn() });
  expect(screen.queryByText("Service Tier")).toBeNull();
  unmount();

  renderInspector(vercelModel, {
    catalogEntry: { id: "my-gateway-model", upstreamProvider: "openai" },
    onServiceTierChange: vi.fn(),
  });
  const trigger = serviceTierTrigger();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Default", "Flex", "Fast"]);
});

test("Anthropic Opus 4.8 shows the Fast switch instead of the Service Tier dropdown", () => {
  const onServiceTierChange = vi.fn<ServiceTierChange>().mockResolvedValue(true);
  renderInspector(
    tierModel({
      name: "claude-opus-4-8",
      provider: "anthropic",
      transportKind: "anthropic",
    }),
    { onServiceTierChange },
  );

  expect(screen.queryByText("Service Tier")).toBeNull();
  expect(screen.getByText("Fast Mode")).toBeTruthy();
  const toggle = screen.getByRole("switch", { name: "Fast Mode" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(toggle);
  expect(onServiceTierChange).toHaveBeenCalledWith(
    { groupId: "", name: "claude-opus-4-8" },
    "fast",
  );
});

test("Anthropic Fast toggle off clears the preference with undefined", () => {
  const onServiceTierChange = vi.fn<ServiceTierChange>().mockResolvedValue(true);
  renderInspector(
    tierModel({
      name: "claude-opus-4-8",
      provider: "anthropic",
      transportKind: "anthropic",
      serviceTier: "fast",
    }),
    { onServiceTierChange },
  );

  const toggle = screen.getByRole("switch", { name: "Fast Mode" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");

  fireEvent.click(toggle);
  expect(onServiceTierChange).toHaveBeenCalledWith(
    { groupId: "", name: "claude-opus-4-8" },
    undefined,
  );
});

test("Anthropic Sonnet renders neither the Fast switch nor the Service Tier dropdown", () => {
  renderInspector(
    tierModel({
      name: "claude-sonnet-4-5",
      provider: "anthropic",
      transportKind: "anthropic",
    }),
    { onServiceTierChange: vi.fn() },
  );

  expect(screen.queryByText("Fast Mode")).toBeNull();
  expect(screen.queryByText("Service Tier")).toBeNull();
});

test("selecting a tier fires the callback with the picked value", async () => {
  const onServiceTierChange = vi.fn<ServiceTierChange>().mockResolvedValue(true);
  renderInspector(tierModel(), { onServiceTierChange });

  await pickServiceTierOption(serviceTierTrigger(), "Fast");
  expect(onServiceTierChange).toHaveBeenCalledWith({ groupId: "", name: "gpt-5" }, "fast");
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
  expect(trigger.textContent).toBe("Auto");
});

test("the displayed tier follows the stored preference", () => {
  renderInspector(tierModel({ serviceTier: "flex" }), { onServiceTierChange: vi.fn() });
  expect(serviceTierTrigger().textContent).toBe("Flex");
});

test("without the callback the tier controls do not render", () => {
  renderInspector(tierModel());
  expect(screen.queryByText("Service Tier")).toBeNull();

  renderInspector(
    tierModel({ name: "claude-opus-4-8", provider: "anthropic", transportKind: "anthropic" }),
  );
  expect(screen.queryByText("Fast Mode")).toBeNull();
});

test("modelPickerInspectorNeedsWideLayout includes models with a tier control", () => {
  const vercelModel = tierModel({
    name: "my-gateway-model",
    apiBase: "https://gateway.example/v1",
    provider: "vercel-ai-gateway",
  });
  // Without an upstream identity the route exposes no tier options and stays narrow.
  expect(modelPickerInspectorNeedsWideLayout(vercelModel)).toBe(false);
  // The catalog upstream fact enables the tier control and the wide layout.
  expect(
    modelPickerInspectorNeedsWideLayout(vercelModel, {
      id: "my-gateway-model",
      upstreamProvider: "openai",
    }),
  ).toBe(true);
  // Anthropic native Fast also participates.
  expect(
    modelPickerInspectorNeedsWideLayout(
      tierModel({ name: "claude-opus-4-8", provider: "anthropic", transportKind: "anthropic" }),
    ),
  ).toBe(true);
  // A provider outside the matrix with no other detail body stays narrow.
  expect(
    modelPickerInspectorNeedsWideLayout(tierModel({ name: "my-local-model", provider: "custom" })),
  ).toBe(false);
});
