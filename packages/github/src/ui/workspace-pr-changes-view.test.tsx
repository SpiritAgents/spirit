/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";

import { resources } from "../locales.js";
import { WorkspacePrChangesView } from "./components/workspace-pr-changes-view.js";
import { GitHubLayoutProvider } from "./lib/layout-prefs.js";
import type { GitHubPullRequestChangedFile } from "../types.js";

const observed: Element[] = [];

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
  vi.unstubAllGlobals();
  observed.length = 0;
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

function renderView(files: GitHubPullRequestChangedFile[]) {
  return (
    <I18nextProvider i18n={i18n}>
      <GitHubLayoutProvider initial={{}} save={async () => {}} onError={() => {}}>
        <WorkspacePrChangesView files={files} />
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
