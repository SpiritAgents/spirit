/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { AnimatedCollapse, AnimatedCollapseContent } from "@spiritagent/ui/animated-collapse";

beforeEach(() => {
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function collapse(open: boolean) {
  return (
    <AnimatedCollapse open={open}>
      <AnimatedCollapseContent keepMounted>
        <p>Body</p>
      </AnimatedCollapseContent>
    </AnimatedCollapse>
  );
}

function contentOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-slot="animated-collapse-content"]')!;
}

/** React listens for the prefixed event where the DOM has no AnimationEvent, as in jsdom. */
function endAnimation(element: Element) {
  const type = "AnimationEvent" in window ? "animationend" : "webkitAnimationEnd";
  fireEvent(element, new Event(type, { bubbles: true }));
}

const FROM_HEIGHT = "--spirit-collapsible-from-height";
const FROM_OPACITY = "--spirit-collapsible-from-opacity";

test("a toggle animates between the keyframes' own ends and settles when the animation ends", () => {
  const view = render(collapse(false));
  const content = contentOf(view.container);
  expect(content.className).toContain("h-0");

  view.rerender(collapse(true));
  expect(content.className).toContain("animate-spirit-collapsible-down");
  expect(content.style.getPropertyValue(FROM_HEIGHT)).toBe("");
  endAnimation(content);
  // Settled open: the height goes back to layout, nothing of the animation stays behind.
  expect(content.className).not.toContain("animate-spirit-collapsible");

  view.rerender(collapse(false));
  expect(content.className).toContain("animate-spirit-collapsible-up");
  expect(content.style.getPropertyValue(FROM_HEIGHT)).toBe("");
  endAnimation(content);
  expect(content.className).not.toContain("animate-spirit-collapsible");
  expect(content.className).toContain("h-0");
});

test("a toggle that interrupts a running animation starts from where that animation had got to", () => {
  const view = render(collapse(false));
  const content = contentOf(view.container);
  view.rerender(collapse(true));

  // The expand is still running (no animationend) when the collapse arrives. The in-flight
  // values have to be read while the expand animation is still the one applied.
  let classWhileMeasuring = "";
  vi.spyOn(content, "getBoundingClientRect").mockImplementation(() => {
    classWhileMeasuring = content.className;
    return { height: 120 } as DOMRect;
  });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) =>
    element === content ? ({ opacity: "0.4" } as CSSStyleDeclaration) : computed(element, pseudo),
  );

  view.rerender(collapse(false));
  expect(classWhileMeasuring).toContain("animate-spirit-collapsible-down");
  expect(classWhileMeasuring).not.toContain("animate-spirit-collapsible-up");
  expect(content.className).toContain("animate-spirit-collapsible-up");
  expect(content.className).not.toContain("animate-spirit-collapsible-down");
  expect(content.style.getPropertyValue(FROM_HEIGHT)).toBe("120px");
  expect(content.style.getPropertyValue(FROM_OPACITY)).toBe("0.4");

  // Once that animation ends the element is at rest again and the next toggle is a plain one.
  endAnimation(content);
  expect(content.className).toContain("h-0");
  expect(content.style.getPropertyValue(FROM_HEIGHT)).toBe("");
  expect(content.style.getPropertyValue(FROM_OPACITY)).toBe("");
  view.rerender(collapse(true));
  expect(content.className).toContain("animate-spirit-collapsible-down");
  expect(content.style.getPropertyValue(FROM_HEIGHT)).toBe("");
});
