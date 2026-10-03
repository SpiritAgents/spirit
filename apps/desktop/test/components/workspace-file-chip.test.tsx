/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { WorkspaceFileChip } from "@/components/composer-lexical/chips/workspace-file-chip";
import {
  ComposerChipNavigateContext,
  type ComposerChipNavigateContextValue,
} from "@/contexts/composer-chip-navigate-context";

// jsdom does not implement PointerEvent; MouseEvent accepts the same init keys
// (button / clientX / clientY), so aliasing it keeps fireEvent.pointerDown usable.
if (!("PointerEvent" in window)) {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent;
}

function renderFileChip(navigable: boolean) {
  const isNavigable = vi.fn(() => navigable);
  const navigate = vi.fn();
  const value: ComposerChipNavigateContextValue = { isNavigable, navigate };
  const utils = render(
    <ComposerChipNavigateContext.Provider value={value}>
      <WorkspaceFileChip path="src/README.md" />
    </ComposerChipNavigateContext.Provider>,
  );
  const chip = utils.container.querySelector<HTMLElement>("[data-spirit-chip]");
  const iconSlot = utils.container.querySelector<HTMLElement>("[data-chip-icon-slot]");
  const label = utils.container.querySelector<HTMLElement>("[data-chip-label]");
  if (!chip || !iconSlot || !label) {
    throw new Error("chip markup incomplete");
  }
  return { chip, iconSlot, label, isNavigable, navigate };
}

describe("WorkspaceFileChip navigation", () => {
  test("the whole chip is one navigable unit: icon and label both navigate to the chip target", () => {
    const { chip, iconSlot, label, isNavigable, navigate } = renderFileChip(true);

    expect(chip.hasAttribute("data-chip-navigable")).toBe(true);
    expect(isNavigable).toHaveBeenCalledWith({ kind: "workspaceFile", path: "src/README.md" });

    fireEvent.pointerDown(iconSlot, { button: 0, clientX: 12, clientY: 8 });
    fireEvent.click(iconSlot, { clientX: 12, clientY: 8 });
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      kind: "workspaceFile",
      path: "src/README.md",
    });

    navigate.mockClear();
    fireEvent.pointerDown(label, { button: 0, clientX: 40, clientY: 8 });
    fireEvent.click(label, { clientX: 40, clientY: 8 });
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      kind: "workspaceFile",
      path: "src/README.md",
    });
  });

  test("stays inert when the target is not navigable", () => {
    const { chip, label, navigate } = renderFileChip(false);

    expect(chip.hasAttribute("data-chip-navigable")).toBe(false);
    fireEvent.pointerDown(label, { button: 0, clientX: 40, clientY: 8 });
    fireEvent.click(label, { clientX: 40, clientY: 8 });
    expect(navigate).not.toHaveBeenCalled();
  });
});
