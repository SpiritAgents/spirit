/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";

import { resources } from "../locales.js";
import { WorkspacePrChangesView } from "./components/workspace-pr-changes-view.js";
import { GitHubLayoutProvider } from "./lib/layout-prefs.js";
import type { GitHubPullRequestChangedFile } from "../types.js";

const observed: Element[] = [];
const intersectionCallbacks: IntersectionObserverCallback[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // jsdom has no scrollIntoView; a test that installs one must not leave it behind.
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
  observed.length = 0;
  intersectionCallbacks.length = 0;
});

const i18n = i18next.createInstance();
void i18n.init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

const changedFile: GitHubPullRequestChangedFile = {
  filename: "src/empty-state.tsx",
  status: "modified",
  additions: 2,
  deletions: 1,
  patch: "@@ -1,1 +1,2 @@\n-old\n+new\n+next",
} as unknown as GitHubPullRequestChangedFile;

/** React listens for the prefixed event where the DOM has no AnimationEvent, as in jsdom. */
function endAnimation(element: Element) {
  const type = "AnimationEvent" in window ? "animationend" : "webkitAnimationEnd";
  fireEvent(element, new Event(type, { bubbles: true }));
}

function renderView(files: GitHubPullRequestChangedFile[], hasMore = false) {
  return (
    <I18nextProvider i18n={i18n}>
      <GitHubLayoutProvider initial={{}} save={async () => {}} onError={() => {}}>
        <div data-workspace-tools-split>
          <WorkspacePrChangesView files={files} hasMore={hasMore} />
        </div>
      </GitHubLayoutProvider>
    </I18nextProvider>
  );
}

test("attaches the container-width observer when the file list appears after mount", async () => {
  const view = render(renderView([]));
  expect(view.container.querySelector("aside")).toBeNull();

  view.rerender(renderView([changedFile]));

  const treeAside = view.container.querySelector("aside");
  expect(treeAside).not.toBeNull();
  const splitContainer = treeAside!.parentElement!;
  await waitFor(() => {
    expect(observed).toContain(splitContainer);
  });
});

test("an expanded file keeps one in-flow sticky header and clips its diff without pin state", () => {
  const otherFile = { ...changedFile, filename: "src/other.tsx" };
  const view = render(renderView([changedFile, otherFile]));
  const shell = view.container.querySelector("[data-workspace-tools-split]")!;
  const viewport = view.container.querySelector<HTMLElement>(
    "[data-radix-scroll-area-viewport]:has([data-pr-changed-file])",
  )!;
  const sections = Array.from(view.container.querySelectorAll("[data-pr-changed-file]"));
  const headerOf = (section: Element) => section.querySelector("button[aria-expanded]")!;
  const shellChildren = shell.childElementCount;

  fireEvent.click(headerOf(sections[0]!));

  // The header never leaves the scroll content, and nothing observes where it is: a pin
  // state committed after the compositor has scrolled is what let diff lines show through
  // it, left a stale copy docked, and docked the wrong file's header.
  const expectInFlowHeaders = () => {
    const headers = Array.from(view.container.querySelectorAll("button[aria-expanded]"));
    expect(headers).toHaveLength(2);
    expect(headers.every((header) => viewport.contains(header))).toBe(true);
    expect(viewport.closest<HTMLElement>('[data-slot="scroll-area"]')?.style.clipPath).toBe("");
  };
  expectInFlowHeaders();
  act(() => {
    for (const callback of intersectionCallbacks) {
      callback([{ isIntersecting: false } as IntersectionObserverEntry], undefined as never);
    }
  });
  expectInFlowHeaders();

  const header = headerOf(sections[0]!).parentElement!;
  expect(header.classList.contains("spirit-dock-header")).toBe(true);
  expect(header.classList.contains("spirit-rule-b")).toBe(true);
  const clip = header.nextElementSibling!;
  expect(clip.classList.contains("spirit-dock-clip")).toBe(true);
  expect(clip.childElementCount).toBe(1);
  expect(clip.querySelector(".tool-call-diff")).not.toBeNull();
  expect(headerOf(sections[0]!).getAttribute("aria-expanded")).toBe("true");

  // A collapsed file has nothing to clip and stays an ordinary row.
  const collapsedHeader = headerOf(sections[1]!).parentElement!;
  expect(collapsedHeader.classList.contains("spirit-dock-header")).toBe(false);
  expect(collapsedHeader.nextElementSibling?.classList.contains("spirit-dock-clip")).toBe(false);

  // Dividers are rules of the rows themselves, never elements drawn into the panel shell.
  const list = sections[0]!.parentElement!;
  expect(list.classList.contains("spirit-row-rules")).toBe(true);
  expect(list.hasAttribute("data-trailing-rule")).toBe(true);
  expect(shell.childElementCount).toBe(shellChildren);

  view.rerender(renderView([changedFile, otherFile], true));
  expect(list.hasAttribute("data-trailing-rule")).toBe(false);
});

test("expanding and collapsing a file animates, and the header keeps its chrome until the diff is gone", () => {
  vi.useFakeTimers();
  const view = render(renderView([changedFile]));
  const section = view.container.querySelector("[data-pr-changed-file]")!;
  const button = section.querySelector("button[aria-expanded]")!;
  const header = button.parentElement!;
  const content = section.querySelector<HTMLElement>('[data-slot="animated-collapse-content"]')!;

  fireEvent.click(button);
  expect(content.className).toContain("animate-spirit-collapsible-down");
  endAnimation(content);
  expect(content.className).not.toContain("animate-spirit-collapsible");

  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  // While the collapse runs the diff is still there, still clipped beneath a sticky header.
  expect(content.className).toContain("animate-spirit-collapsible-up");
  expect(section.querySelector(".tool-call-diff")).not.toBeNull();
  expect(header.classList.contains("spirit-dock-header")).toBe(true);
  expect(header.nextElementSibling?.classList.contains("spirit-dock-clip")).toBe(true);

  endAnimation(content);
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(section.querySelector(".tool-call-diff")).toBeNull();
  expect(header.classList.contains("spirit-dock-header")).toBe(false);
  expect(header.nextElementSibling?.classList.contains("spirit-dock-clip")).toBe(false);
});

test("tree navigation scrolls once the expanding diff has made room for the header to reach the top", () => {
  vi.useFakeTimers({
    toFake: [
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
      "setTimeout",
      "clearTimeout",
    ],
  });
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const otherFile = { ...changedFile, filename: "src/other.tsx" };
  const view = render(renderView([changedFile, otherFile]));
  const viewport = view.container.querySelector<HTMLElement>(
    "[data-radix-scroll-area-viewport]:has([data-pr-changed-file])",
  )!;
  const section = view.container.querySelectorAll<HTMLElement>("[data-pr-changed-file]")[1]!;
  // The file is 300px below the top edge and the list can scroll 100px: its header only
  // gets to the top once its own diff has grown the list by another 200px.
  let scrollHeight = 500;
  Object.defineProperty(viewport, "scrollHeight", { get: () => scrollHeight });
  Object.defineProperty(viewport, "clientHeight", { get: () => 400 });
  vi.spyOn(section, "getBoundingClientRect").mockReturnValue({ top: 300 } as DOMRect);
  const frame = () =>
    act(() => {
      vi.advanceTimersToNextFrame();
    });
  const treeItem = (name: string) =>
    Array.from(view.container.querySelectorAll("aside button")).find(
      (button) => button.textContent?.trim() === name,
    )!;

  fireEvent.click(treeItem("other.tsx"));
  expect(section.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  // Scrolling now would stop at whatever is reachable while the diff is still animating open.
  frame();
  frame();
  expect(scrollIntoView).not.toHaveBeenCalled();
  scrollHeight = 760;
  frame();
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView.mock.contexts[0]).toBe(section);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  frame();
  expect(scrollIntoView).toHaveBeenCalledTimes(1);

  // A file whose diff never makes that much room is scrolled as far as the list goes, once
  // the expand is over.
  scrollHeight = 500;
  fireEvent.click(treeItem("other.tsx"));
  frame();
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
});

test("the extension stylesheet defines the collapse animation the changes view runs", () => {
  // The page has its own stylesheet. It rendered every expand and collapse without any
  // animation while these utilities and keyframes were defined only in the host app's.
  const uiSource = path.resolve(import.meta.dirname, "../../../ui/src");
  const read = (file: string): string =>
    readFileSync(file, "utf8").replace(/@import "([^"]+\.css)";/g, (statement, target: string) => {
      if (target.startsWith("@spiritagent/ui/")) {
        return read(path.join(uiSource, target.slice("@spiritagent/ui/".length)));
      }
      return target.startsWith(".") ? read(path.resolve(path.dirname(file), target)) : statement;
    });
  const css = read(path.resolve(import.meta.dirname, "style.css"));
  for (const name of ["spirit-collapsible-down", "spirit-collapsible-up"]) {
    expect(css).toMatch(new RegExp(`--animate-${name}:\\s*${name} `));
    expect(css).toMatch(new RegExp(`@keyframes ${name}\\s*\\{`));
  }
  expect(css).toMatch(
    /html\.spirit-reduce-motion \[data-slot="animated-collapse-content"\]\s*\{\s*animation-duration: 0s !important;/,
  );
});
