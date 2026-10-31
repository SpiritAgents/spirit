/** @vitest-environment jsdom */

import "./setup";

import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { ActionPickerRow } from "@/components/action-picker-row";
import type { ActionPaletteItem } from "@/lib/action-palette";

const TASK_MENU_ITEM: ActionPaletteItem = {
  id: "action:run-task",
  kind: "task-menu",
  group: "workspace",
  labelKey: "actionPalette.runTask",
};

function taskOption(overrides: Partial<Extract<ActionPaletteItem, { kind: "task-option" }>> = {}) {
  const item: ActionPaletteItem = {
    id: "action:task:/repo/.spirit/tasks.json#build",
    kind: "task-option",
    taskKey: "/repo/.spirit/tasks.json#build",
    label: "build",
    ...overrides,
  };
  return item;
}

function textColumnOf(container: HTMLElement): Element | null | undefined {
  // The outer two-line row carries items-start; the text column is its only min-w-0 child.
  return container.querySelector(".items-start")?.querySelector(".min-w-0.flex-1");
}

function autoMarginElementsOf(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("[class~='ml-auto']")];
}

test("the task menu root row keeps exactly one auto-margin element and right-aligns its chevron", () => {
  const { container } = render(<ActionPickerRow item={TASK_MENU_ITEM} />);
  const auto = autoMarginElementsOf(container);
  expect(auto.length).toBe(1);
  // No current value: the auto-margin meta wrapper renders empty and still pushes the
  // chevron to the row end, and the chevron itself carries no margin class.
  expect(auto[0]?.textContent).toBe("");
  const chevron = container.querySelector(".items-center > svg:last-of-type");
  expect(chevron).not.toBeNull();
  expect(chevron?.classList.contains("ml-auto")).toBe(false);
});

test("a parent row with a current value holds it in the single auto-margin element", () => {
  const themeMenu: ActionPaletteItem = {
    id: "action:theme-menu",
    kind: "theme-menu",
    group: "appearance",
    labelKey: "actionPalette.theme",
  };
  const { container } = render(<ActionPickerRow item={themeMenu} currentValueLabel="System" />);
  const auto = autoMarginElementsOf(container);
  expect(auto.length).toBe(1);
  expect(auto[0]?.textContent).toBe("System");
});

test("a task row with icon.id renders the icon on the first line and the detail on the second", () => {
  const { container } = render(
    <ActionPickerRow item={taskOption({ iconId: "check", detail: "Builds everything" })} />,
  );
  const icon = container.querySelector("svg");
  expect(icon).not.toBeNull();
  expect(icon?.classList.contains("mt-0.5")).toBe(true);

  const textColumn = textColumnOf(container);
  expect(textColumn?.children.length).toBe(2);
  expect(textColumn?.children[0]?.textContent).toBe("build");
  const detail = textColumn?.children[1];
  expect(detail?.textContent).toBe("Builds everything");
  expect(detail?.classList.contains("text-muted-foreground")).toBe(true);
  expect(detail?.classList.contains("truncate")).toBe(true);
});

test("a task row without icon.id renders no icon at all", () => {
  const { container } = render(
    <ActionPickerRow item={taskOption({ detail: "Builds everything" })} />,
  );
  expect(container.querySelector("svg")).toBeNull();
  expect(container.textContent).toContain("build");
  expect(container.textContent).toContain("Builds everything");
});

test("a task row without detail renders a single line", () => {
  const { container } = render(<ActionPickerRow item={taskOption({ iconId: "check" })} />);
  const textColumn = textColumnOf(container);
  expect(textColumn?.children.length).toBe(1);
  expect(textColumn?.children[0]?.textContent).toBe("build");
});
