/** @vitest-environment jsdom */

import "./setup";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  ModelPickerLabelsProvider,
  ModelPickerMenu,
  ModelPickerRuntimeProvider,
  type ModelPickerLabels,
  type ModelPickerModelProfile,
  type ModelPickerRuntime,
  type ModelPickerMenuProps,
} from "@spiritagent/ui/model-picker";
import { TooltipProvider } from "@/components/ui/tooltip";
import { clearTooltipItemInteractionSlots } from "@/hooks/tooltip-item-interaction-store";
import { desktopModelPickerRuntime } from "@/lib/model-picker-runtime";
import { desktopModelPickerLabels } from "@/lib/ui-labels";
import i18n from "@/lib/i18n";

const originalHitTest = document.elementFromPoint;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
let hit: Element | null;

const reasoningModel: ModelPickerModelProfile = {
  name: "Reasoning Model",
  providerId: "test-provider",
  ref: { providerId: "test-provider", name: "Reasoning Model" },
  supportedReasoningEfforts: ["low", "high", "max"],
};
const outputModel: ModelPickerModelProfile = {
  name: "Output Model",
  providerId: "test-provider",
  ref: { providerId: "test-provider", name: "Output Model" },
  effortSemantics: "output",
  supportedEfforts: ["low", "medium", "high"],
  effort: "high",
};

function Fixture({
  model = reasoningModel,
  labels = desktopModelPickerLabels(i18n.getFixedT("en")),
  runtime = desktopModelPickerRuntime,
  ...props
}: Partial<ModelPickerMenuProps> & {
  model?: ModelPickerModelProfile;
  labels?: ModelPickerLabels;
  runtime?: ModelPickerRuntime;
}) {
  return (
    <TooltipProvider>
      <ModelPickerRuntimeProvider value={runtime}>
        <ModelPickerLabelsProvider value={labels}>
          <ModelPickerMenu
            models={[model]}
            activeModelRef={model.ref}
            onModelSelect={() => {}}
            open
            {...props}
          />
        </ModelPickerLabelsProvider>
      </ModelPickerRuntimeProvider>
    </TooltipProvider>
  );
}

async function advance() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32);
  });
}

async function hoverModel(name: string) {
  const row = screen.getByRole("menuitem", { name });
  hit = row;
  fireEvent.pointerMove(row, { pointerType: "mouse", clientX: 20, clientY: 20 });
  fireEvent.pointerOver(row, { pointerType: "mouse", clientX: 20, clientY: 20 });
  await advance();
  return screen.getByRole("tooltip");
}

beforeEach(() => {
  vi.useFakeTimers();
  hit = null;
  document.elementFromPoint = vi.fn(() => hit);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  clearTooltipItemInteractionSlots();
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "mouse";
      }
    },
  );
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
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.elementFromPoint = originalHitTest;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  clearTooltipItemInteractionSlots();
});

test.each([
  { model: reasoningModel, label: "Reasoning Effort", selection: "Default" },
  { model: outputModel, label: "Effort", selection: "High" },
])(
  "hover renders $label under Desktop's outer tooltip provider",
  async ({ model, label, selection }) => {
    render(<Fixture model={model} />);

    const detail = await hoverModel(model.name);

    expect(within(detail).getByText(label, { selector: "label" })).toBeTruthy();
    expect(within(detail).getByRole("combobox").textContent).toBe(selection);
    expect(document.querySelector("[data-model-picker-root]")).toBeTruthy();
  },
);

test("hovering an unconfigured-effort model also keeps the application mounted", async () => {
  const model = { ...reasoningModel, supportedReasoningEfforts: undefined };
  render(<Fixture model={model} />);

  const detail = await hoverModel(model.name);

  expect(within(detail).getByText(model.name)).toBeTruthy();
  expect(within(detail).queryByRole("combobox")).toBeNull();
  expect(document.querySelector("[data-model-picker-root]")).toBeTruthy();
});

test("hovered effort controls send the selected value and model ref", async () => {
  const onEffort = vi.fn();
  const onModel = vi.fn();
  render(<Fixture onModelReasoningEffortSelect={onEffort} onModelSelect={onModel} />);
  const detail = await hoverModel(reasoningModel.name);

  fireEvent.keyDown(within(detail).getByRole("combobox"), { key: "ArrowDown" });
  await advance();
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Default",
    "Low",
    "High",
    "Max",
  ]);
  const high = screen.getByRole("option", { name: "High" });
  act(() => high.focus());
  fireEvent.keyDown(high, { key: "Enter" });
  await advance();

  expect(onEffort).toHaveBeenCalledWith(reasoningModel.ref, "high");
  expect(onModel).toHaveBeenCalledWith(reasoningModel.ref);
});

test("an open inspector uses the picker's runtime and follows updated localized labels", async () => {
  const resolveThinking = vi.fn().mockReturnValue("off");
  const runtime = { ...desktopModelPickerRuntime, resolveThinkingSwitchState: resolveThinking };
  const { rerender } = render(<Fixture runtime={runtime} />);
  await hoverModel(reasoningModel.name);
  expect(resolveThinking).toHaveBeenCalled();

  rerender(
    <Fixture runtime={runtime} labels={desktopModelPickerLabels(i18n.getFixedT("zh-CN"))} />,
  );
  await advance();

  const label = desktopModelPickerLabels(i18n.getFixedT("zh-CN")).reasoningEffort;
  expect(within(screen.getByRole("tooltip")).getByText(label, { selector: "label" })).toBeTruthy();
  expect(
    document.querySelector("[data-model-picker-root] button")?.getAttribute("aria-label"),
  ).toBe(desktopModelPickerLabels(i18n.getFixedT("zh-CN")).selectModel);
});
