/** @vitest-environment jsdom */
import "./setup";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DelayToolDuration } from "../../src/components/delay-tool-duration";
import type { ToolBlockSnapshot } from "../../src/types";

const preferences = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../src/hooks/use-prefers-reduced-motion", () => ({
  usePrefersReducedMotion: () => preferences.reduced,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
const disconnect = vi.fn();
beforeEach(() => {
  preferences.reduced = false;
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {
        disconnect();
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const tool: ToolBlockSnapshot = {
  toolName: "delay",
  toolCallId: "wait",
  phase: "running",
  headline: "Delaying",
  detailLines: [],
  argsExcerpt: '{"seconds":252}',
  delay: { startedAtUnixMs: 1000, deadlineUnixMs: 253000 },
};

test("counts down from the host deadline and finishes at the actual elapsed time", () => {
  const ui = render(<DelayToolDuration tool={tool} />);
  expect(ui.getByRole("timer").getAttribute("aria-label")).toBe("4m 12s");
  act(() => vi.advanceTimersByTime(1000));
  expect(ui.getByRole("timer").getAttribute("aria-label")).toBe("4m 11s");
  act(() => {
    vi.setSystemTime(61_000);
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(ui.getByRole("timer").getAttribute("aria-label")).toBe("3m 12s");
  ui.rerender(
    <DelayToolDuration
      tool={{ ...tool, phase: "succeeded", delay: { ...tool.delay!, elapsedMs: 252000 } }}
    />,
  );
  act(() => vi.advanceTimersByTime(600));
  expect(ui.getByRole("timer").getAttribute("aria-label")).toBe("4m 12s");
  expect(ui.getByRole("timer").getAttribute("aria-live")).toBe("off");
  ui.unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("crossfades units and releases the outgoing text", () => {
  const ui = render(
    <DelayToolDuration
      tool={{ ...tool, delay: { startedAtUnixMs: 1000, deadlineUnixMs: 61000 } }}
    />,
  );
  expect(ui.getByRole("timer").getAttribute("aria-label")).toBe("1m");
  act(() => vi.advanceTimersByTime(1000));
  expect(ui.getByRole("timer").getAttribute("aria-label")).toBe("59s");
  expect(ui.container.querySelector(".spirit-delay-duration-outgoing")?.textContent).toBe("1m");
  act(() => vi.advanceTimersByTime(240));
  expect(ui.container.querySelector(".spirit-delay-duration-outgoing")).toBeNull();
});

test("unbounded waits reveal elapsed duration once, with no replay on completed remount", () => {
  preferences.reduced = true;
  const waiting: ToolBlockSnapshot = {
    ...tool,
    argsExcerpt: '{"task_id":"task_1"}',
    delay: { startedAtUnixMs: 1000, taskId: "task_1", taskKind: "shell" },
  };
  const ui = render(<DelayToolDuration tool={waiting} />);
  expect(ui.getByRole("timer").getAttribute("aria-label")).toBe("");
  expect(vi.getTimerCount()).toBe(0);
  const completed: ToolBlockSnapshot = {
    ...waiting,
    phase: "succeeded",
    delay: { ...waiting.delay!, elapsedMs: 90000 },
  };
  ui.rerender(<DelayToolDuration tool={completed} />);
  expect(ui.getByRole("timer").getAttribute("aria-label")).toBe("1m 30s");
  expect(vi.getTimerCount()).toBe(0);
  ui.unmount();
  preferences.reduced = false;
  const restored = render(<DelayToolDuration tool={completed} />);
  expect(restored.getByRole("timer").getAttribute("aria-label")).toBe("1m 30s");
  expect(vi.getTimerCount()).toBe(0);
});
