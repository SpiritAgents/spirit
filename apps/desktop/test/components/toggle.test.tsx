/** @vitest-environment jsdom */

import "./setup";

import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

describe("Toggle", () => {
  test("pressed toggle carries the on state and the selected text-highlight class", () => {
    const { getByRole } = render(<Toggle pressed>Built-in</Toggle>);
    const button = getByRole("button", { name: "Built-in" });
    expect(button.getAttribute("data-state")).toBe("on");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    // The selected text highlight must come from the on state, not hover.
    expect(button.className).toContain("data-[state=on]:text-sidebar-foreground");
  });

  test("unpressed toggle renders data-state off", () => {
    const { getByRole } = render(<Toggle>Personal</Toggle>);
    expect(getByRole("button", { name: "Personal" }).getAttribute("data-state")).toBe("off");
  });
});

describe("ToggleGroup", () => {
  test("only the selected item carries the on state", () => {
    const { getByRole } = render(
      <ToggleGroup type="single" value="a">
        <ToggleGroupItem value="a">Alpha</ToggleGroupItem>
        <ToggleGroupItem value="b">Beta</ToggleGroupItem>
      </ToggleGroup>,
    );
    // type="single" items render with role="radio" (aria-checked semantics).
    expect(getByRole("radio", { name: "Alpha" }).getAttribute("data-state")).toBe("on");
    expect(getByRole("radio", { name: "Beta" }).getAttribute("data-state")).toBe("off");
  });
});
