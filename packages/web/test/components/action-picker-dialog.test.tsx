/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ActionPickerDialog } from "@/components/action-picker-dialog";

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "system", resolvedDark: false, setTheme: vi.fn() }),
}));

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

test("keeps the action picker mounted when a search has no matching commands", () => {
  render(
    <ActionPickerDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} onSavePatch={vi.fn()} />,
  );

  fireEvent.change(screen.getByPlaceholderText("Search commands"), {
    target: { value: "sdjng" },
  });

  expect(screen.getByText("No matching commands")).toBeTruthy();
  expect(screen.getByPlaceholderText("Search commands")).toHaveProperty("value", "sdjng");

  fireEvent.change(screen.getByPlaceholderText("Search commands"), {
    target: { value: "" },
  });

  expect(screen.queryByText("No matching commands")).toBeNull();
  expect(screen.getByRole("option", { name: "New Chat" }).getAttribute("data-selected")).toBe(
    "true",
  );
});
