/** @vitest-environment jsdom */

import "./setup";

import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { DiffCodeScrollView } from "../../src/components/diff-code-scroll-view";

test("follow-tail scrolls to the bottom on the first highlighted render", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => 500,
  });

  try {
    const { container } = render(
      <DiffCodeScrollView
        lines={[{ kind: "normal", content: "const answer = 42;" }]}
        languageId="typescript"
        followTail
      />,
    );
    const viewport = container.querySelector("[data-radix-scroll-area-viewport]");
    expect(viewport).not.toBeNull();
    expect((viewport as HTMLElement).scrollTop).toBe(500);
  } finally {
    vi.unstubAllGlobals();
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
    }
  }
});
