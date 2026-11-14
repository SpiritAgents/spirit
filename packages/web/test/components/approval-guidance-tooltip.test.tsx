/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ComposerLabelsProvider } from "@spiritagent/ui/composer";

import { PendingApprovalCard } from "@/components/pending-approval-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import i18n from "@/lib/i18n";
import { desktopComposerLabels } from "@/lib/ui-labels";

const originalHitTest = document.elementFromPoint;

function Fixture() {
  return (
    <TooltipProvider>
      <ComposerLabelsProvider value={desktopComposerLabels(i18n.getFixedT("en"))}>
        <PendingApprovalCard
          pendingApproval={{ toolName: "Run command", prompt: "Approval required" }}
          approvalGuidance="Please adjust the command."
          approveBusy={false}
          onApprovalGuidanceChange={() => {}}
          onSubmitApproval={() => {}}
        />
      </ComposerLabelsProvider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  document.elementFromPoint = vi.fn(() => screen.getByRole("button", { name: "Send Guidance" }));
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
});

test("approval guidance hover keeps Composer labels available in the shared tooltip host", async () => {
  render(<Fixture />);
  const send = screen.getByRole("button", { name: "Send Guidance" });
  fireEvent.pointerMove(send, { pointerType: "mouse", clientX: 20, clientY: 20 });
  fireEvent.pointerOver(send, { pointerType: "mouse", clientX: 20, clientY: 20 });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

  expect(screen.getByRole("tooltip").textContent).toContain("Send");
  expect(document.querySelector("[data-spirit-surface='pending-approval-card']")).toBeTruthy();
});
