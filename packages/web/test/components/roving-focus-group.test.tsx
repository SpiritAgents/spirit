/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useRef, useState } from "react";
import { expect, test, vi } from "vitest";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  RovingFocusAction,
  RovingFocusGrid,
  RovingFocusGroup,
  RovingFocusItem,
  useVirtualRovingFocus,
} from "@/components/ui/roving-focus-group";

async function flushRovingFocus() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function LinearFixture({ showBeta = true }: { showBeta?: boolean }) {
  return (
    <RovingFocusGroup orientation="vertical" defaultCurrentTabStopId="alpha">
      <RovingFocusItem asChild tabStopId="alpha">
        <button type="button">Alpha</button>
      </RovingFocusItem>
      <RovingFocusAction tabStopId="alpha">
        <button type="button">Alpha Action</button>
      </RovingFocusAction>
      {showBeta ? (
        <>
          <RovingFocusItem asChild tabStopId="beta">
            <button type="button">Beta</button>
          </RovingFocusItem>
          <RovingFocusAction tabStopId="beta">
            <button type="button">Beta Action</button>
          </RovingFocusAction>
        </>
      ) : null}
      <RovingFocusItem asChild tabStopId="gamma" focusable={false}>
        <button type="button">Gamma</button>
      </RovingFocusItem>
    </RovingFocusGroup>
  );
}

test("linear groups keep one row and its actions in the Tab path and skip disabled items", async () => {
  const { container, rerender } = render(<LinearFixture />);
  const alpha = screen.getByRole("button", { name: "Alpha" });
  const beta = screen.getByRole("button", { name: "Beta" });
  const alphaAction = screen.getByRole("button", { name: "Alpha Action" });
  const betaAction = screen.getByRole("button", { name: "Beta Action" });

  expect(alpha.tabIndex).toBe(0);
  expect(beta.tabIndex).toBe(-1);
  expect(alphaAction.tabIndex).toBe(0);
  expect(betaAction.tabIndex).toBe(-1);

  fireEvent.keyDown(alpha, { key: "ArrowDown" });
  await flushRovingFocus();
  expect(document.activeElement).toBe(beta);
  expect(alphaAction.tabIndex).toBe(-1);
  expect(betaAction.tabIndex).toBe(0);

  fireEvent.keyDown(beta, { key: "ArrowDown" });
  await flushRovingFocus();
  expect(document.activeElement).toBe(beta);

  fireEvent.keyDown(beta, { key: "Home" });
  await flushRovingFocus();
  expect(document.activeElement).toBe(alpha);

  act(() => {
    betaAction.focus();
  });
  expect(betaAction.tabIndex).toBe(0);
  rerender(<LinearFixture showBeta={false} />);
  act(() => {
    (container.firstElementChild as HTMLElement).focus();
  });
  expect(document.activeElement).toBe(alpha);
  expect(alphaAction.tabIndex).toBe(0);
});

test("the selected item wins when entering a group", () => {
  const { container } = render(
    <RovingFocusGroup orientation="horizontal">
      <RovingFocusItem asChild tabStopId="alpha">
        <button type="button">Alpha</button>
      </RovingFocusItem>
      <RovingFocusItem asChild tabStopId="beta" active>
        <button type="button">Beta</button>
      </RovingFocusItem>
    </RovingFocusGroup>,
  );
  const group = container.firstElementChild as HTMLElement;
  act(() => group.focus());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Beta" }));
});

test("actions forward composed trigger props and refs", async () => {
  const actionRef = createRef<HTMLElement>();
  const onFocus = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <RovingFocusGroup defaultCurrentTabStopId="alpha">
        <RovingFocusItem asChild tabStopId="alpha">
          <button type="button">Alpha</button>
        </RovingFocusItem>
        <Tooltip>
          <TooltipTrigger asChild>
            <RovingFocusAction ref={actionRef} tabStopId="alpha" onFocus={onFocus}>
              <button type="button">Action</button>
            </RovingFocusAction>
          </TooltipTrigger>
          <TooltipContent>Action details</TooltipContent>
        </Tooltip>
      </RovingFocusGroup>
    </TooltipProvider>,
  );
  const action = screen.getByRole("button", { name: "Action" });
  expect(actionRef.current).toBe(action);
  expect(action.getAttribute("data-slot")).toBe("tooltip-trigger");

  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => action.focus());
  expect(onFocus).toHaveBeenCalledOnce();
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 350);
    });
  });
  expect(screen.getByRole("tooltip").textContent).toBe("Action details");
});

function mockRect(element: HTMLElement, left: number, top: number, width = 180, height = 40) {
  const rect = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
  element.getBoundingClientRect = () => rect;
  element.getClientRects = () => [rect] as unknown as DOMRectList;
}

test("grid navigation follows visual rows and handles an incomplete final row", async () => {
  render(
    <RovingFocusGrid defaultCurrentTabStopId="a">
      {["a", "b", "c", "d", "e"].map((id) => (
        <RovingFocusItem asChild key={id} tabStopId={id}>
          <button type="button">{id.toUpperCase()}</button>
        </RovingFocusItem>
      ))}
    </RovingFocusGrid>,
  );
  const positions: Record<string, [number, number]> = {
    a: [0, 0],
    b: [200, 0],
    c: [0, 50],
    d: [200, 50],
    e: [0, 100],
  };
  for (const [id, [left, top]] of Object.entries(positions)) {
    mockRect(screen.getByRole("button", { name: id.toUpperCase() }), left, top);
  }

  const a = screen.getByRole("button", { name: "A" });
  const c = screen.getByRole("button", { name: "C" });
  const d = screen.getByRole("button", { name: "D" });
  const e = screen.getByRole("button", { name: "E" });
  fireEvent.keyDown(a, { key: "ArrowDown" });
  expect(document.activeElement).toBe(c);
  fireEvent.keyDown(c, { key: "ArrowRight" });
  expect(document.activeElement).toBe(d);
  fireEvent.keyDown(d, { key: "ArrowDown" });
  expect(document.activeElement).toBe(e);
  fireEvent.keyDown(e, { key: "ArrowUp" });
  expect(document.activeElement).toBe(c);
});

function VirtualFixture({ appendBeforeMount = false }: { appendBeforeMount?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(2);
  const [itemIds, setItemIds] = useState<readonly string[]>(["alpha", "beta", "gamma"]);
  const scrollCallsRef = useRef(0);
  const { onKeyDownCapture, onFocusCapture, onBlurCapture } = useVirtualRovingFocus({
    containerRef,
    itemIds,
    scrollToIndex: (index) => {
      scrollCallsRef.current += 1;
      if (appendBeforeMount && scrollCallsRef.current === 1) {
        document.body.focus();
        setItemIds((current) => [...current, "delta"]);
        return;
      }
      setVisibleCount(index + 1);
    },
  });
  return (
    <RovingFocusGroup
      ref={containerRef}
      orientation="vertical"
      defaultCurrentTabStopId="alpha"
      onKeyDownCapture={onKeyDownCapture}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      {itemIds.slice(0, visibleCount).map((id) => (
        <RovingFocusItem asChild key={id} tabStopId={id}>
          <button type="button">{id}</button>
        </RovingFocusItem>
      ))}
      <output data-testid="scroll-calls">{scrollCallsRef.current}</output>
    </RovingFocusGroup>
  );
}

test("virtual navigation mounts the target row before focusing it", async () => {
  render(<VirtualFixture />);
  const beta = screen.getByRole("button", { name: "beta" });
  act(() => beta.focus());
  fireEvent.keyDown(beta, { key: "ArrowDown" });
  await flushRovingFocus();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "gamma" }));
});

test("virtual navigation re-locates a pending row when loading more changes the item list", async () => {
  render(<VirtualFixture appendBeforeMount />);
  const beta = screen.getByRole("button", { name: "beta" });
  act(() => beta.focus());
  fireEvent.keyDown(beta, { key: "ArrowDown" });
  await flushRovingFocus();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "gamma" }));
  expect(screen.getByTestId("scroll-calls").textContent).toBe("2");
});

test("virtual navigation clears pending focus after mounting the target", async () => {
  const { rerender } = render(<VirtualFixture />);
  const beta = screen.getByRole("button", { name: "beta" });
  act(() => beta.focus());
  fireEvent.keyDown(beta, { key: "ArrowDown" });
  await flushRovingFocus();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "gamma" }));

  act(() => {
    (document.activeElement as HTMLElement).blur();
  });
  expect(document.activeElement).toBe(document.body);
  rerender(<VirtualFixture />);
  expect(document.activeElement).toBe(document.body);
  expect(screen.getByTestId("scroll-calls").textContent).toBe("1");
});
