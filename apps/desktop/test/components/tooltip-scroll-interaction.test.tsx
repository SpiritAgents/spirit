/** @vitest-environment jsdom */

import "./setup";

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  Tooltip,
  TooltipContent,
  TooltipItem,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  FilteredOverlayMenu,
  FilteredOverlayMenuTrigger,
} from "@/components/ui/filtered-overlay-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clearTooltipItemInteractionSlots } from "@/hooks/tooltip-item-interaction-store";

const items = [{ id: "alpha" }, { id: "beta" }];
let hit: Element | null;
let hitTest: ReturnType<typeof vi.fn>;
const originalHitTest = document.elementFromPoint;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function Fixture({ delay = 0, showAlpha = true }: { delay?: number; showAlpha?: boolean }) {
  return (
    <TooltipProvider>
      <div data-testid="viewport" style={{ height: 40, overflowY: "auto" }}>
        <Tooltip getItemId={(item: (typeof items)[number]) => item.id} delayDuration={delay}>
          <Tooltip.Zone>
            {items
              .filter((item) => showAlpha || item.id !== "alpha")
              .map((item) => (
                <TooltipItem key={item.id} item={item}>
                  <button data-testid={item.id} type="button">
                    {item.id}
                  </button>
                </TooltipItem>
              ))}
            <div data-testid="gap">Group Label</div>
          </Tooltip.Zone>
          <TooltipContent>
            {(item) => (
              <div data-testid="detail">
                {(item as (typeof items)[number]).id}
                <button type="button">Detail Action</button>
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

function MenuFixture({
  onDetailChange,
  alphaHasDetail = true,
}: {
  onDetailChange?: (value: string) => void;
  alphaHasDetail?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <TooltipProvider>
      <FilteredOverlayMenu
        open={open}
        onOpenChange={setOpen}
        filterValue=""
        onFilterChange={() => {}}
        filterPlaceholder="Search Items"
        trigger={
          <FilteredOverlayMenuTrigger>
            <span>Items</span>
          </FilteredOverlayMenuTrigger>
        }
      >
        <Tooltip getItemId={(item: (typeof items)[number]) => item.id} delayDuration={0}>
          <Tooltip.Zone>
            {items.map((item) => (
              <TooltipItem
                key={item.id}
                item={item.id === "alpha" && !alphaHasDetail ? null : item}
              >
                <DropdownMenuItem data-testid={item.id}>{item.id}</DropdownMenuItem>
              </TooltipItem>
            ))}
          </Tooltip.Zone>
          <TooltipContent>
            {(item) => (
              <div data-testid="detail">
                {(item as (typeof items)[number]).id}
                {onDetailChange && (
                  <Select defaultValue="standard" onValueChange={onDetailChange}>
                    <SelectTrigger aria-label="Detail Mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="extended">Extended</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </FilteredOverlayMenu>
    </TooltipProvider>
  );
}

async function advance(milliseconds = 32) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function moveTo(element: Element) {
  hit = element;
  fireEvent.pointerMove(element, { pointerType: "mouse", clientX: 20, clientY: 20 });
  fireEvent.pointerOver(element, { pointerType: "mouse", clientX: 20, clientY: 20 });
}

beforeEach(() => {
  vi.useFakeTimers();
  hit = null;
  hitTest = vi.fn(() => hit);
  document.elementFromPoint = hitTest;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  clearTooltipItemInteractionSlots();
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
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.elementFromPoint = originalHitTest;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  clearTooltipItemInteractionSlots();
});

test("scroll retargets an open detail without new pointer boundary events", async () => {
  render(<Fixture />);
  moveTo(screen.getByTestId("alpha"));
  await advance();
  expect(screen.getByTestId("detail").textContent).toContain("alpha");

  hit = screen.getByTestId("beta");
  hitTest.mockClear();
  fireEvent.scroll(screen.getByTestId("viewport"));
  fireEvent.scroll(screen.getByTestId("viewport"));
  await advance();

  expect(screen.getByTestId("detail").textContent).toContain("beta");
  expect(hitTest).toHaveBeenCalledTimes(1);
});

test("opening and switching details preserves the original row DOM", async () => {
  render(<Fixture />);
  const alpha = screen.getByTestId("alpha");
  const beta = screen.getByTestId("beta");
  alpha.focus();
  moveTo(alpha);
  await advance();
  expect(screen.getByTestId("alpha")).toBe(alpha);
  expect(document.activeElement).toBe(alpha);

  hit = beta;
  fireEvent.scroll(screen.getByTestId("viewport"));
  await advance();
  expect(screen.getByTestId("beta")).toBe(beta);
  expect(screen.getByTestId("alpha")).toBe(alpha);
});

test("scrolling onto a group label closes the previous detail", async () => {
  render(<Fixture />);
  moveTo(screen.getByTestId("alpha"));
  await advance();

  hit = screen.getByTestId("gap");
  fireEvent.scroll(screen.getByTestId("viewport"));
  await advance(300);

  expect(screen.queryByTestId("detail")).toBeNull();
});

test("scrolling within the same item does not restart its opening delay", async () => {
  render(<Fixture delay={100} />);
  moveTo(screen.getByTestId("alpha"));
  await advance(64);
  fireEvent.scroll(screen.getByTestId("viewport"));
  await advance(64);
  expect(screen.getByTestId("detail").textContent).toContain("alpha");
});

test("scroll replaces a pending opening target without showing the old detail", async () => {
  render(<Fixture delay={100} />);
  moveTo(screen.getByTestId("alpha"));
  await advance(64);
  hit = screen.getByTestId("beta");
  fireEvent.scroll(screen.getByTestId("viewport"));
  await advance(64);
  expect(screen.queryByTestId("detail")).toBeNull();
  await advance(64);
  expect(screen.getByTestId("detail").textContent).toContain("beta");
});

test("the detail remains open while its contents scroll or receive keyboard input", async () => {
  render(<Fixture />);
  moveTo(screen.getByTestId("alpha"));
  await advance();
  const detailButton = screen.getByRole("button", { name: "Detail Action" });
  moveTo(detailButton);
  await advance();
  fireEvent.scroll(screen.getByTestId("detail"));
  fireEvent.keyDown(detailButton, { key: "ArrowDown" });
  await advance(300);
  expect(screen.getByTestId("detail").textContent).toContain("alpha");
});

test("a portaled select remains part of its detail during scrolling", async () => {
  render(<Fixture />);
  moveTo(screen.getByTestId("alpha"));
  await advance();
  const select = document.createElement("div");
  select.setAttribute("data-slot", "select-content");
  document.body.append(select);
  try {
    moveTo(select);
    fireEvent.scroll(select);
    await advance(300);
    expect(screen.getByTestId("detail").textContent).toContain("alpha");
  } finally {
    select.remove();
  }
});

test("keyboard scrolling retains focus until an actual pointer input takes over", async () => {
  render(<MenuFixture />);
  await advance();
  moveTo(screen.getByTestId("alpha"));
  await advance();
  expect(document.activeElement).toBe(screen.getByTestId("alpha"));

  fireEvent.keyDown(screen.getByTestId("alpha"), { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByTestId("beta"));
  hit = screen.getByTestId("alpha");
  const viewport = document.querySelector("[data-radix-scroll-area-viewport]")!;
  fireEvent.scroll(viewport);
  // A browser may send a boundary event after keyboard scrolling at the old coordinates.
  fireEvent.pointerOver(hit, { pointerType: "mouse", clientX: 20, clientY: 20 });
  await advance(300);
  expect(document.activeElement).toBe(screen.getByTestId("beta"));
  expect(screen.queryByTestId("detail")).toBeNull();

  fireEvent.wheel(hit, { clientX: 20, clientY: 20, deltaY: 20 });
  fireEvent.scroll(viewport);
  await advance();
  expect(document.activeElement).toBe(screen.getByTestId("alpha"));
  expect(screen.getByTestId("detail").textContent).toContain("alpha");
});

test("scroll updates menu focus and removes the previous pointer highlight", async () => {
  render(<MenuFixture />);
  await advance();
  const alpha = screen.getByTestId("alpha");
  const beta = screen.getByTestId("beta");
  moveTo(alpha);
  await advance();
  hit = beta;
  fireEvent.scroll(document.querySelector("[data-radix-scroll-area-viewport]")!);
  await advance();
  expect(document.activeElement).toBe(beta);
  expect(screen.getByTestId("alpha")).toBe(alpha);
  expect(alpha.className).not.toContain("!bg-overlay-hover");
  expect(beta.className).toContain("!bg-overlay-hover");
  expect(screen.getByTestId("detail").textContent).toContain("beta");
});

test("menu rows without detail content keep their normal pointer focus highlight", async () => {
  render(<MenuFixture alphaHasDetail={false} />);
  await advance();
  const row = screen.getByTestId("alpha");
  moveTo(row);
  await advance();
  expect(document.activeElement).toBe(row);
  expect(row.className).toContain("focus:bg-overlay-hover");
  expect(screen.queryByTestId("detail")).toBeNull();
});

test("touch scrolling does not open hover content", async () => {
  render(<Fixture />);
  hit = screen.getByTestId("alpha");
  fireEvent.pointerOver(hit, { pointerType: "touch", clientX: 20, clientY: 20 });
  fireEvent.scroll(screen.getByTestId("viewport"));
  await advance(300);
  expect(screen.queryByTestId("detail")).toBeNull();
});

test("plain triggers keep their child and forwarded ref stable while opening", async () => {
  const ref = vi.fn();
  render(
    <TooltipProvider>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild ref={ref}>
          <button data-testid="plain" type="button">
            Plain Trigger
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div data-testid="detail">Plain Detail</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
  const trigger = screen.getByTestId("plain");
  ref.mockClear();
  moveTo(trigger);
  await advance();
  expect(screen.getByTestId("plain")).toBe(trigger);
  expect(ref).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-describedby")).toBe(
    document.querySelector('[role="tooltip"]')?.id,
  );
});

test("choosing an option inside a detail keeps both the detail and model menu open", async () => {
  const onDetailChange = vi.fn();
  render(<MenuFixture onDetailChange={onDetailChange} />);
  await advance();
  moveTo(screen.getByTestId("alpha"));
  await advance();
  const trigger = screen.getByRole("combobox", { name: "Detail Mode" });
  moveTo(trigger);
  await advance();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await advance();
  const option = screen.getByRole("option", { name: "Extended" });
  act(() => option.focus());
  fireEvent.keyDown(option, { key: "Enter" });
  await advance(300);
  expect(onDetailChange).toHaveBeenCalledWith("extended");
  expect(screen.getByRole("menu")).toBeTruthy();
  expect(screen.getByTestId("detail").textContent).toContain("alpha");
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("click-dismissed content stays closed until the pointer leaves its trigger zone", async () => {
  const { rerender } = render(<Fixture />);
  moveTo(screen.getByTestId("alpha"));
  await advance();
  fireEvent.pointerDown(screen.getByTestId("alpha"), {
    pointerType: "mouse",
    clientX: 20,
    clientY: 20,
  });
  // Updating timing must not unregister the still-mounted trigger zone.
  rerender(<Fixture delay={10} />);
  fireEvent.scroll(screen.getByTestId("viewport"));
  await advance(300);
  expect(screen.queryByTestId("detail")).toBeNull();

  moveTo(document.body);
  await advance();
  moveTo(screen.getByTestId("alpha"));
  await advance();
  expect(screen.getByTestId("detail").textContent).toContain("alpha");
});

test("removing the source row closes its hovered detail", async () => {
  const { rerender } = render(<Fixture />);
  moveTo(screen.getByTestId("alpha"));
  await advance();
  const detailButton = screen.getByRole("button", { name: "Detail Action" });
  moveTo(detailButton);
  await advance();
  fireEvent.keyDown(detailButton, { key: "ArrowDown" });
  rerender(<Fixture showAlpha={false} />);
  await advance(300);
  expect(screen.queryByTestId("detail")).toBeNull();
});

test("an opening timer waits for the pending scroll hit-test before showing content", async () => {
  render(<Fixture delay={100} />);
  moveTo(screen.getByTestId("alpha"));
  await advance(16);
  await advance(99);
  hit = screen.getByTestId("beta");
  fireEvent.scroll(screen.getByTestId("viewport"));
  await advance(1);
  expect(screen.queryByTestId("detail")).toBeNull();
  await advance(150);
  expect(screen.getByTestId("detail").textContent).toContain("beta");
});
