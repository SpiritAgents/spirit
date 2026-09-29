/** @vitest-environment jsdom */

import { expect, test, vi } from "vitest";

// The keepalive only installs on hover-capable pointer devices; jsdom reports no match.
window.matchMedia = vi.fn(() => ({ matches: true }));

const { installScrollHoverKeepalive } = await import("@spiritagent/ui/scroll-hover-keepalive");

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

test("installs one hidden node and toggles it once per scroll frame", async () => {
  installScrollHoverKeepalive();
  installScrollHoverKeepalive();

  const nodes = document.querySelectorAll("[data-scroll-hover-keepalive]");
  expect(nodes).toHaveLength(1);
  const node = nodes[0];
  expect(node.style.width).toBe("1px");

  // No scroll events: nothing runs.
  await nextFrame();
  expect(node.style.width).toBe("1px");

  // Two scroll events within the same frame coalesce into a single toggle.
  document.dispatchEvent(new Event("scroll"));
  document.dispatchEvent(new Event("scroll"));
  await nextFrame();
  expect(node.style.width).toBe("0.5px");

  // Non-bubbling scroll events on a descendant still reach the capture listener.
  const scroller = document.createElement("div");
  document.body.appendChild(scroller);
  scroller.dispatchEvent(new Event("scroll"));
  await nextFrame();
  expect(node.style.width).toBe("1px");
});
