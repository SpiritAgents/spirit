/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ExtensionTabHost } from "@/components/extension-tab-host";

const tab = {
  id: "instance-1",
  kind: "extension" as const,
  extensionId: "personal/demo",
  contributionId: "notes",
  instanceId: "instance-1",
  scope: { kind: "window-shared" as const },
};
const contribution = {
  id: "notes",
  name: "Notes",
  path: "notes.html",
  icon: { type: "spirit" as const, name: "globe" },
  defaultScope: "window-shared" as const,
};

test("extension tab uses a scripts-only sandbox and keeps its instance identity", () => {
  const { container } = render(<ExtensionTabHost tab={tab} contribution={contribution} active />);
  const iframe = container.querySelector("iframe");
  expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe?.src).toContain("/tab/personal%2Fdemo/notes/instance-1/index.html");
  expect(container.firstElementChild?.getAttribute("data-extension-tab-instance")).toBe(
    "instance-1",
  );
});

test("load failure exposes an explicit retryable error", () => {
  vi.useFakeTimers();
  try {
    const { container } = render(
      <ExtensionTabHost tab={tab} contribution={contribution} active={false} />,
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(
      screen.getByText("Could not load Notes. Check the extension package and try again."),
    ).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByText("Retry"));
    });
    expect(
      container
        .querySelector("[data-extension-tab-state]")
        ?.getAttribute("data-extension-tab-state"),
    ).toBe("loading");
  } finally {
    vi.useRealTimers();
  }
});

test("a successful load clears the loading timeout", () => {
  vi.useFakeTimers();
  try {
    const { container } = render(<ExtensionTabHost tab={tab} contribution={contribution} active />);
    fireEvent.load(container.querySelector("iframe")!);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(
      container
        .querySelector("[data-extension-tab-state]")
        ?.getAttribute("data-extension-tab-state"),
    ).toBe("ready");
  } finally {
    vi.useRealTimers();
  }
});
