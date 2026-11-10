/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { useCommandListWheelHover } from "@/hooks/use-command-list-wheel-hover";

let hit: Element | null;
let hitTest: ReturnType<typeof vi.fn>;
const originalHitTest = document.elementFromPoint;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Fixture() {
  const wheelHoverRef = useCommandListWheelHover();
  return (
    <Command shouldFilter={false} aria-label="Commands">
      <CommandList ref={wheelHoverRef} data-testid="list">
        <CommandItem value="alpha" data-testid="alpha">
          Alpha
        </CommandItem>
        <CommandItem value="beta" data-testid="beta">
          Beta
        </CommandItem>
        <CommandItem value="gamma" data-testid="gamma" disabled>
          Gamma
        </CommandItem>
      </CommandList>
    </Command>
  );
}

function selectedValue() {
  return screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("data-selected") === "true")
    ?.getAttribute("data-testid");
}

async function wheelAt(element: Element, clientX: number, clientY: number) {
  fireEvent.wheel(element, { clientX, clientY });
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

beforeEach(() => {
  hit = null;
  hitTest = vi.fn(() => hit);
  document.elementFromPoint = hitTest;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  document.elementFromPoint = originalHitTest;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  vi.unstubAllGlobals();
});

test("wheel scroll moves the selection to the row under the stationary pointer", async () => {
  render(<Fixture />);
  expect(selectedValue()).toBe("alpha");

  hit = screen.getByTestId("beta");
  await wheelAt(screen.getByTestId("list"), 12, 34);

  expect(hitTest).toHaveBeenCalledWith(12, 34);
  expect(selectedValue()).toBe("beta");
});

test("wheel over a non-item element keeps the current selection", async () => {
  render(<Fixture />);

  hit = screen.getByTestId("list");
  await wheelAt(screen.getByTestId("list"), 12, 34);

  expect(selectedValue()).toBe("alpha");
});

test("wheel over a disabled row keeps the current selection", async () => {
  render(<Fixture />);

  hit = screen.getByTestId("gamma");
  await wheelAt(screen.getByTestId("list"), 12, 34);

  expect(selectedValue()).toBe("alpha");
});

test("unmounting the list detaches the wheel listener", async () => {
  const { unmount } = render(<Fixture />);
  const list = screen.getByTestId("list");
  unmount();

  hit = screen.queryByTestId("beta");
  fireEvent.wheel(list, { clientX: 12, clientY: 34 });
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  expect(hitTest).not.toHaveBeenCalled();
});
