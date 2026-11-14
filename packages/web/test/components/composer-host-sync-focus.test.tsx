/** @vitest-environment jsdom */

import "./setup";

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  ComposerSurface,
  type DesktopAgentMode,
  type ModelPickerModelProfile,
  type RichSegment,
} from "@spiritagent/ui/composer";

import { TooltipProvider } from "@/components/ui/tooltip";
import { UiTestProviders } from "./ui-test-providers";

const model: ModelPickerModelProfile = {
  name: "Reasoning Model",
  providerId: "test-provider",
  ref: { providerId: "test-provider", name: "Reasoning Model" },
  supportedReasoningEfforts: ["low", "high"],
};

let selectionRect = new DOMRect();

function Fixture({
  agentMode,
  loopEnabled,
  segments = [],
}: {
  agentMode: DesktopAgentMode;
  loopEnabled: boolean;
  segments?: readonly RichSegment[];
}) {
  return (
    <TooltipProvider>
      <UiTestProviders>
        <ComposerSurface
          segments={segments}
          onSegmentsChange={() => {}}
          localFileAttachments={[]}
          placeholder="Message"
          models={[model]}
          activeModel={model.ref}
          agentMode={agentMode}
          loopEnabled={loopEnabled}
          canSend={false}
          busy={false}
          onSubmit={() => {}}
          onModelSelect={() => {}}
          onModelReasoningEffortSelect={() => {}}
          onAgentModeChange={() => {}}
        />
      </UiTestProviders>
    </TooltipProvider>
  );
}

async function flushHostSync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  selectionRect = new DOMRect();
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: () => selectionRect },
    getClientRects: {
      configurable: true,
      value: () => ({ length: 0, item: () => null }) as unknown as DOMRectList,
    },
  });
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([
  { chip: "agent mode", agentMode: "plan" as const, loopEnabled: false },
  { chip: "loop", agentMode: "agent" as const, loopEnabled: true },
])("mounting the $chip chip does not focus the editor", async ({ agentMode, loopEnabled }) => {
  render(<Fixture agentMode={agentMode} loopEnabled={loopEnabled} />);
  await flushHostSync();

  expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Message" }));
});

test("host-driven chip updates preserve focus outside the editor", async () => {
  const { rerender } = render(<Fixture agentMode="agent" loopEnabled={false} />);
  await flushHostSync();

  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();

  rerender(<Fixture agentMode="plan" loopEnabled />);
  await flushHostSync();

  expect(document.activeElement).toBe(outside);
  expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Message" }));
  outside.remove();
});

test("host-driven content updates do not scroll a focused editor into view", async () => {
  const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  const { rerender } = render(
    <Fixture agentMode="plan" loopEnabled={false} segments={[{ kind: "text", value: "Demo" }]} />,
  );
  await flushHostSync();

  const editor = screen.getByRole("textbox", { name: "Message" });
  editor.focus();
  vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 240, height: 100 }),
  );
  selectionRect = DOMRect.fromRect({ x: 0, y: 150, width: 1, height: 16 });

  let scrollTopWrites = 0;
  Object.defineProperty(editor, "scrollTop", {
    configurable: true,
    get: () => 0,
    set: () => {
      scrollTopWrites += 1;
    },
  });

  rerender(<Fixture agentMode="plan" loopEnabled={false} segments={[]} />);
  await flushHostSync();

  expect(scrollTopWrites).toBe(0);
  expect(scrollBy).not.toHaveBeenCalled();
});
