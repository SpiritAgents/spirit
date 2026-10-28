/** @vitest-environment jsdom */

import "./setup";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ModelPickerInspectorPanel } from "@/components/model-picker-inspector-panel";
import type { ModelProfileSnapshot } from "@/types";

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

function effortModel(overrides: Partial<ModelProfileSnapshot>): ModelProfileSnapshot {
  const name = overrides.name ?? "test-model";
  return {
    name,
    apiBase: "https://provider.example/v1",
    providerId: "provider",
    ref: { providerId: "provider", name },
    ...overrides,
  };
}

function renderInspector(model: ModelProfileSnapshot, withThinkingSwitch = false) {
  return render(
    <ModelPickerInspectorPanel
      model={model}
      providerLabel="Provider"
      onEffortChange={() => {}}
      {...(withThinkingSwitch ? { onThinkingEnabledChange: () => {} } : {})}
    />,
  );
}

test("output-effort models use Effort with the same Default label as other models", () => {
  renderInspector(
    effortModel({
      name: "claude-opus-4.8",
      effortSemantics: "output",
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    }),
  );

  expect(screen.getByText("Effort", { selector: "label" })).toBeTruthy();
  expect(screen.queryByText("Reasoning Effort", { selector: "label" })).toBeNull();
  expect(screen.getByRole("combobox").textContent).toBe("Default");
});

test("reasoning-effort models keep their existing label and selection", () => {
  renderInspector(
    effortModel({
      name: "gpt-5.5",
      reasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high"],
    }),
  );

  expect(screen.getByText("Reasoning Effort", { selector: "label" })).toBeTruthy();
  expect(screen.queryByText("Effort", { selector: "label" })).toBeNull();
  expect(screen.getByRole("combobox").textContent).toBe("High");
});

test("budget-only Claude hides effort while Opus 4.5 shows effort and the budget switch", () => {
  const budgetSwitch = {
    defaultState: "off" as const,
    on: { body: { thinking: { type: "enabled", budget_tokens: 12000 } } },
    off: "omit" as const,
  };
  const { unmount } = renderInspector(
    effortModel({
      name: "claude-sonnet-4.5",
      effortSemantics: "output",
      supportedEfforts: [],
      supportsThinkingSwitch: true,
      thinkingSwitch: budgetSwitch,
    }),
    true,
  );
  expect(screen.queryByText("Effort", { selector: "label" })).toBeNull();
  expect(screen.getByRole("switch", { name: "Thinking" })).toBeTruthy();
  unmount();

  renderInspector(
    effortModel({
      name: "claude-opus-4.5",
      effortSemantics: "output",
      supportedEfforts: ["low", "medium", "high"],
      defaultEffort: "high",
      supportsThinkingSwitch: true,
      thinkingSwitch: budgetSwitch,
    }),
    true,
  );
  expect(screen.getByText("Effort", { selector: "label" })).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Thinking" })).toBeTruthy();
});
