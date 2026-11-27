/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";

import { resources } from "../locales.js";
import { WorkspacePrChecksView } from "./components/workspace-pr-checks-view.js";
import { WorkspacePrCommitsView } from "./components/workspace-pr-commits-view.js";
import type { GitHubPullRequestCheck, GitHubPullRequestCommit } from "../types.js";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const i18n = i18next.createInstance();
void i18n.init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

const AVATAR = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const commits: GitHubPullRequestCommit[] = [1, 2].map((index) => ({
  sha: `sha-${index}`,
  subject: `Commit ${index}`,
  authorLogin: "author",
  avatarUrl: AVATAR,
  createdAt: "2026-01-01T00:00:00Z",
}));
const checks: GitHubPullRequestCheck[] = [1, 2].map((index) => ({
  id: `check-${index}`,
  name: `Check ${index}`,
  state: "success",
  startedAt: "2026-01-01T00:00:00Z",
}));

function renderInShell(children: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <div data-workspace-tools-split>{children}</div>
    </I18nextProvider>,
  );
}

/** The list whose children are the rows: dividers must be rules of those rows. */
function expectRowRules(container: HTMLElement, rowText: string, trailing: boolean) {
  const shell = container.querySelector("[data-workspace-tools-split]")!;
  const viewport = container.querySelector("[data-radix-scroll-area-viewport]")!;
  const list = container.querySelector(".spirit-row-rules")!;
  expect(viewport.contains(list)).toBe(true);
  expect(Array.from(list.children).some((row) => row.textContent?.includes(rowText))).toBe(true);
  expect(list.hasAttribute("data-trailing-rule")).toBe(trailing);
  // Nothing is drawn into the panel shell, outside the scroller.
  expect(Array.from(shell.children)).toEqual([shell.firstElementChild]);
}

test("commit rows are divided by in-flow rules", () => {
  const view = renderInShell(<WorkspacePrCommitsView commits={commits} />);
  expectRowRules(view.container, "Commit 1", true);
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <div data-workspace-tools-split>
        <WorkspacePrCommitsView commits={commits} hasMore />
      </div>
    </I18nextProvider>,
  );
  expectRowRules(view.container, "Commit 1", false);
});

test("check rows are divided by in-flow rules", () => {
  const view = renderInShell(<WorkspacePrChecksView checks={checks} />);
  expectRowRules(view.container, "Check 1", true);
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <div data-workspace-tools-split>
        <WorkspacePrChecksView checks={checks} hasMore onLoadMore={() => {}} />
      </div>
    </I18nextProvider>,
  );
  expectRowRules(view.container, "Check 1", false);
});
