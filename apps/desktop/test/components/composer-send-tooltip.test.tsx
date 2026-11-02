/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ComposerLabelsProvider, ComposerSurface } from "@spiritagent/ui/composer";
import {
  ModelPickerLabelsProvider,
  ModelPickerRuntimeProvider,
  type ModelPickerModelProfile,
} from "@spiritagent/ui/model-picker";

import { TooltipProvider } from "@/components/ui/tooltip";
import { desktopModelPickerRuntime } from "@/lib/model-picker-runtime";
import { desktopComposerLabels, desktopModelPickerLabels } from "@/lib/ui-labels";
import i18n from "@/lib/i18n";

const model: ModelPickerModelProfile = {
  name: "Reasoning Model",
  providerId: "test-provider",
  ref: { providerId: "test-provider", name: "Reasoning Model" },
  supportedReasoningEfforts: ["low", "high"],
};

const originalHitTest = document.elementFromPoint;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function Fixture() {
  return (
    <TooltipProvider>
      <ModelPickerRuntimeProvider value={desktopModelPickerRuntime}>
        <ModelPickerLabelsProvider value={desktopModelPickerLabels(i18n.getFixedT("en"))}>
          <ComposerLabelsProvider value={desktopComposerLabels(i18n.getFixedT("en"))}>
            <ComposerSurface
              segments={[]}
              onSegmentsChange={() => {}}
              localFileAttachments={[]}
              placeholder="Message"
              models={[model]}
              activeModel={model.ref}
              agentMode="agent"
              loopEnabled={false}
              canSend
              busy={false}
              onSubmit={() => {}}
              onModelSelect={() => {}}
              onModelReasoningEffortSelect={() => {}}
              onAgentModeChange={() => {}}
            />
          </ComposerLabelsProvider>
        </ModelPickerLabelsProvider>
      </ModelPickerRuntimeProvider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  document.elementFromPoint = vi.fn(() => screen.getByRole("button", { name: "Send" }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
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
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.elementFromPoint = originalHitTest;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

test("send hover keeps Composer labels available in the shared tooltip host", async () => {
  render(<Fixture />);
  const send = screen.getByRole("button", { name: "Send" });
  fireEvent.pointerMove(send, { pointerType: "mouse", clientX: 20, clientY: 20 });
  fireEvent.pointerOver(send, { pointerType: "mouse", clientX: 20, clientY: 20 });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

  expect(screen.getByRole("tooltip").textContent).toContain("Send");
  expect(document.querySelector("[data-spirit-surface='composer-surface']")).toBeTruthy();
});
