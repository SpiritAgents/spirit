/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ChipIcon, ChipLabel, ChipShell } from "@/components/composer-lexical/chips/chip-shell";

// jsdom does not implement PointerEvent; MouseEvent accepts the same init keys
// (button / clientX / clientY), so aliasing it keeps fireEvent.pointerDown usable.
if (!("PointerEvent" in window)) {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent;
}

function renderChip({
  navigable = true,
  onNavigate = vi.fn(),
  trailingSpacer,
}: {
  navigable?: boolean;
  onNavigate?: () => void;
  trailingSpacer?: boolean;
} = {}) {
  const utils = render(
    <ChipShell
      className="chip"
      navigable={navigable}
      onNavigate={onNavigate}
      {...(trailingSpacer === undefined ? {} : { trailingSpacer })}
    >
      <ChipIcon>
        <svg data-testid="chip-icon-svg" />
      </ChipIcon>
      <ChipLabel>README.md</ChipLabel>
    </ChipShell>,
  );
  const chip = utils.container.querySelector<HTMLElement>("[data-spirit-chip]");
  const iconSlot = utils.container.querySelector<HTMLElement>("[data-chip-icon-slot]");
  const label = utils.container.querySelector<HTMLElement>("[data-chip-label]");
  if (!chip || !iconSlot || !label) {
    throw new Error("chip markup incomplete");
  }
  return { ...utils, chip, iconSlot, label, onNavigate };
}

function pressAndClick(element: HTMLElement, point: { x: number; y: number }, button = 0) {
  fireEvent.pointerDown(element, { button, clientX: point.x, clientY: point.y });
  fireEvent.click(element, { button, clientX: point.x, clientY: point.y });
}

describe("ChipShell navigation", () => {
  test("a navigable chip carries data-chip-navigable on the shell, not on the label", () => {
    const { chip, label } = renderChip();
    expect(chip.hasAttribute("data-chip-navigable")).toBe(true);
    expect(label.hasAttribute("data-chip-navigable")).toBe(false);
  });

  test("clicking the icon navigates, same as clicking the label", () => {
    const { chip, iconSlot, label, onNavigate } = renderChip();

    pressAndClick(iconSlot, { x: 12, y: 8 });
    expect(onNavigate).toHaveBeenCalledTimes(1);

    onNavigate.mockClear();
    pressAndClick(label, { x: 40, y: 8 });
    expect(onNavigate).toHaveBeenCalledTimes(1);

    onNavigate.mockClear();
    pressAndClick(chip, { x: 2, y: 2 });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  test("a drag beyond the navigate threshold selects instead of navigating", () => {
    const { chip, iconSlot, onNavigate } = renderChip();
    fireEvent.pointerDown(iconSlot, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.click(chip, { clientX: 110, clientY: 100 });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test("a press-release within the threshold still navigates", () => {
    const { label, onNavigate } = renderChip();
    fireEvent.pointerDown(label, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.click(label, { clientX: 101, clientY: 101 });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  test("a click without a preceding primary press does not navigate", () => {
    const { label, onNavigate } = renderChip();
    fireEvent.click(label, { clientX: 10, clientY: 10 });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test("a non-primary-button press does not navigate", () => {
    const { label, onNavigate } = renderChip();
    pressAndClick(label, { x: 10, y: 10 }, 2);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test("a navigable click does not reach host chrome handlers", () => {
    const onParentClick = vi.fn();
    const { container } = render(
      <div onClick={onParentClick}>
        <ChipShell navigable onNavigate={vi.fn()}>
          <ChipLabel>README.md</ChipLabel>
        </ChipShell>
      </div>,
    );
    const label = container.querySelector<HTMLElement>("[data-chip-label]");
    if (!label) {
      throw new Error("chip label missing");
    }
    pressAndClick(label, { x: 5, y: 5 });
    expect(onParentClick).not.toHaveBeenCalled();
  });

  test("a non-navigable chip has no data-chip-navigable, ignores clicks, and lets them bubble", () => {
    const onNavigate = vi.fn();
    const onParentClick = vi.fn();
    const { container } = render(
      <div onClick={onParentClick}>
        <ChipShell navigable={false} onNavigate={onNavigate}>
          <ChipLabel>README.md</ChipLabel>
        </ChipShell>
      </div>,
    );
    const chip = container.querySelector<HTMLElement>("[data-spirit-chip]");
    const label = container.querySelector<HTMLElement>("[data-chip-label]");
    if (!chip || !label) {
      throw new Error("chip markup incomplete");
    }
    expect(chip.hasAttribute("data-chip-navigable")).toBe(false);
    pressAndClick(label, { x: 5, y: 5 });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onParentClick).toHaveBeenCalledTimes(1);
  });

  test("trailingSpacer={false} keeps the U+3000 filler out of message bubbles", () => {
    const { container, unmount } = renderChip();
    expect(container.querySelector("[data-chip-trailing-spacer]")).not.toBeNull();
    unmount();

    const { container: bubbleContainer } = renderChip({ trailingSpacer: false });
    expect(bubbleContainer.querySelector("[data-chip-trailing-spacer]")).toBeNull();
  });
});
