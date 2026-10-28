/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  ModelPickerInspectorPanel,
  modelPickerInspectorNeedsWideLayout,
} from "@/components/model-picker-inspector-panel";
import type { ModelProfileSnapshot, ModelRef } from "@/types";

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

type ThinkingEnabledChange = (ref: ModelRef, enabled: boolean) => void | Promise<boolean>;

function thinkingModel(overrides: Partial<ModelProfileSnapshot> = {}): ModelProfileSnapshot {
  return {
    name: "kimi-k2.6",
    apiBase: "https://api.moonshot.cn/v1",
    providerId: "moonshot-ai",
    ref: { providerId: "moonshot-ai", name: overrides.name ?? "kimi-k2.6" },
    supportsThinkingSwitch: true,
    ...overrides,
  };
}

function renderInspector(
  model: ModelProfileSnapshot,
  options: { onThinkingEnabledChange?: ThinkingEnabledChange } = {},
) {
  return render(
    <ModelPickerInspectorPanel
      model={model}
      providerLabel="Provider"
      onEffortChange={() => {}}
      {...(options.onThinkingEnabledChange
        ? { onThinkingEnabledChange: options.onThinkingEnabledChange }
        : {})}
    />,
  );
}

test("a model declaring supportsThinkingSwitch shows the Thinking toggle, on by default", () => {
  renderInspector(thinkingModel(), { onThinkingEnabledChange: vi.fn() });

  const toggle = screen.getByRole("switch", { name: "Thinking" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

test("the stored thinkingEnabled=false state renders the toggle off", () => {
  renderInspector(thinkingModel({ thinkingEnabled: false }), {
    onThinkingEnabledChange: vi.fn(),
  });

  const toggle = screen.getByRole("switch", { name: "Thinking" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
});

test("toggling fires the callback with the next state", () => {
  const onThinkingEnabledChange = vi.fn<ThinkingEnabledChange>().mockResolvedValue(true);
  const model = thinkingModel();
  renderInspector(model, { onThinkingEnabledChange });

  fireEvent.click(screen.getByRole("switch", { name: "Thinking" }));
  expect(onThinkingEnabledChange).toHaveBeenCalledWith(model.ref, false);
});

test("a failed save rolls the displayed state back", async () => {
  let resolveSave: (ok: boolean) => void = () => {};
  const onThinkingEnabledChange = vi.fn<ThinkingEnabledChange>(
    () =>
      new Promise<boolean>((resolve) => {
        resolveSave = resolve;
      }),
  );
  renderInspector(thinkingModel(), { onThinkingEnabledChange });

  const toggle = screen.getByRole("switch", { name: "Thinking" });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("false");

  await act(async () => {
    resolveSave(false);
  });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

test("supportsThinkingType only hides the toggle (thinking is always on)", () => {
  renderInspector(thinkingModel({ supportsThinkingType: "only" }), {
    onThinkingEnabledChange: vi.fn(),
  });
  expect(screen.queryByRole("switch", { name: "Thinking" })).toBeNull();
});

test("without the callback or the declaration the toggle does not render", () => {
  renderInspector(thinkingModel());
  expect(screen.queryByRole("switch", { name: "Thinking" })).toBeNull();

  renderInspector(thinkingModel({ supportsThinkingSwitch: undefined }), {
    onThinkingEnabledChange: vi.fn(),
  });
  expect(screen.queryByRole("switch", { name: "Thinking" })).toBeNull();
});

test("defaultState off drives the initial toggle without a stored preference", () => {
  renderInspector(thinkingModel({ thinkingSwitch: { defaultState: "off", off: "omit" } }), {
    onThinkingEnabledChange: vi.fn(),
  });
  expect(screen.getByRole("switch", { name: "Thinking" }).getAttribute("aria-checked")).toBe(
    "false",
  );
});

test("blocked effort temporarily forces thinking on and restores the saved off preference", () => {
  const onThinkingEnabledChange = vi.fn<ThinkingEnabledChange>();
  const model = thinkingModel({
    name: "claude-opus-5",
    effortSemantics: "output",
    supportedEfforts: ["low", "high", "max"],
    effort: "max",
    thinkingEnabled: false,
    thinkingSwitch: {
      defaultState: "on",
      offBlockedEfforts: ["max"],
      on: { body: { thinking: { type: "adaptive" } } },
      off: { body: { thinking: { type: "disabled" } } },
    },
  });
  const view = renderInspector(model, { onThinkingEnabledChange });
  const toggle = screen.getByRole("switch", { name: "Thinking" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(toggle.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Thinking stays on at the selected effort.")).toBeTruthy();
  expect(model.thinkingEnabled).toBe(false);

  view.rerender(
    <ModelPickerInspectorPanel
      model={{ ...model, effort: "high" }}
      providerLabel="Provider"
      onEffortChange={() => {}}
      onThinkingEnabledChange={onThinkingEnabledChange}
    />,
  );
  const restored = screen.getByRole("switch", { name: "Thinking" });
  expect(restored.getAttribute("aria-checked")).toBe("false");
  expect(restored.hasAttribute("disabled")).toBe(false);
  expect(screen.queryByText("Thinking stays on at the selected effort.")).toBeNull();
});

test("always-on Claude hides the switch and explains the thinking state", () => {
  renderInspector(
    thinkingModel({
      name: "claude-opus-5.5",
      effortSemantics: "output",
      supportsThinkingType: "only",
      supportsThinkingSwitch: false,
    }),
    { onThinkingEnabledChange: vi.fn() },
  );
  expect(screen.queryByRole("switch", { name: "Thinking" })).toBeNull();
  expect(screen.getByText("Thinking is always on for this model.")).toBeTruthy();
});

test("modelPickerInspectorNeedsWideLayout includes models with a thinking switch", () => {
  expect(modelPickerInspectorNeedsWideLayout(thinkingModel())).toBe(true);
  expect(
    modelPickerInspectorNeedsWideLayout(
      thinkingModel({ name: "kimi-k3", supportsThinkingType: "only" }),
    ),
  ).toBe(false);
});
