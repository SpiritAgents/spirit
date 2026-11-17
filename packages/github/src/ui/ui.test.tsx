/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { resources } from "@spiritagent/i18n";
import type { ReactNode } from "react";
import type { SpiritDesktopTabPageContext } from "@spiritagent/extension-toolkit/desktop-ui";
import { GitHubAuthorizationView } from "./components/github-authorization-view.js";
import { GitHubSignInPrompt } from "./components/github-sign-in-prompt.js";
import { WorkspacePrTab, type WorkspacePrTabProps } from "./components/workspace-pr-tab.js";
import { GitHubPageProvider } from "./page-context.js";
import { GitHubLayoutProvider } from "./lib/layout-prefs.js";

const i18n = i18next.createInstance();
await i18n.init({ resources, lng: "en", fallbackLng: "en", interpolation: { escapeValue: false } });
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
});
const context: SpiritDesktopTabPageContext = {
  extensionId: "built-in/github",
  contributionId: "pull-requests",
  instanceId: "tab",
  channelId: "channel",
  workspaceRoot: "/workspace",
  workspace: { isRepository: true, branch: "feature" },
  sessionKey: "session",
  scope: { kind: "window-shared" },
  visible: true,
  locale: "en",
  theme: { htmlClassName: "", htmlStyle: "", cssText: "" },
};
function wrap(children: ReactNode) {
  return (
    <I18nextProvider i18n={i18n}>
      <GitHubPageProvider context={context}>
        <GitHubLayoutProvider
          initial={{}}
          save={async () => undefined}
          onError={(error) => {
            throw error;
          }}
        >
          {children}
        </GitHubLayoutProvider>
      </GitHubPageProvider>
    </I18nextProvider>
  );
}

test("native authorization exposes the user code and keeps loading cancellable", () => {
  const close = vi.fn();
  const { container, rerender } = render(
    wrap(
      <GitHubAuthorizationView
        state={{ phase: "loading" }}
        close={close}
        openExternal={async () => {}}
      />,
    ),
  );
  expect(container.firstElementChild?.classList.contains("grid")).toBe(true);
  expect(
    container.querySelector('[data-slot="dialog-footer"]')?.classList.contains("flex-row"),
  ).toBe(true);
  expect(
    container.querySelector('[data-slot="dialog-footer-actions"]')?.classList.contains("flex-row"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledWith({ dismissed: true });
  rerender(
    wrap(
      <GitHubAuthorizationView
        state={{
          phase: "challenge",
          userCode: "TEST-CODE",
          verificationUri: "https://github.com/login/device",
        }}
        close={close}
        openExternal={async () => {}}
      />,
    ),
  );
  expect(screen.getByText("TEST-CODE")).toBeTruthy();
  expect(screen.getByText("TEST-CODE").getAttribute("data-spirit-selectable")).toBe("text");
  expect(screen.getByText("Waiting for authorization")).toBeTruthy();
  expect(screen.getByText("Waiting for authorization").hasAttribute("data-spirit-selectable")).toBe(
    false,
  );
  expect(screen.getByRole("button", { name: "Open GitHub verification page" })).toBeTruthy();
});

test("invalid authorization can be explicitly disconnected in the Native management view", () => {
  const close = vi.fn();
  render(
    wrap(
      <GitHubAuthorizationView
        state={{ phase: "error", message: "Stored authorization is invalid.", canDisconnect: true }}
        close={close}
        openExternal={async () => {}}
      />,
    ),
  );
  expect(screen.getByRole("alert").textContent).toBe("Stored authorization is invalid.");
  expect(screen.getByRole("alert").hasAttribute("data-spirit-selectable")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(close).toHaveBeenCalledWith({ disconnect: true });
});

test("unconfigured OAuth shows a localized error instead of starting another auth path", async () => {
  await act(() => i18n.changeLanguage("zh-CN"));
  render(
    wrap(
      <GitHubAuthorizationView
        state={{ phase: "error", unavailable: true, message: "unused" }}
        close={() => {}}
        openExternal={async () => {}}
      />,
    ),
  );
  expect(screen.getByRole("alert").textContent).toContain("OAuth");
  expect(screen.getByRole("alert").textContent).not.toContain("unused");
  await act(() => i18n.changeLanguage("en"));
});

function prProps(connected = true): WorkspacePrTabProps {
  return {
    gitSnapshot: { isRepository: true, branch: "feature" },
    isActive: true,
    prTabEnabled: true,
    onOpenExternal: vi.fn(),
    onAuthorize: vi.fn(),
    getGitHubAuthStatus: async () => ({ connected }),
    getGitHubPullRequestForCurrentBranch: async () => ({
      repository: { owner: "example", repo: "project" },
      branch: "feature",
      pullRequest: null,
    }),
    listGitHubPullRequests: vi.fn(async () => ({ items: [], totalCount: 0, hasMore: false })),
    getGitHubPullRequestTabCounts: async () => ({ open: 0, closed: 0 }),
    getGitHubPullRequestDetail: vi.fn(),
    getGitHubPullRequestConversation: vi.fn(),
    getGitHubPullRequestFiles: vi.fn(),
    getGitHubPullRequestCommits: vi.fn(),
    getGitHubPullRequestChecks: vi.fn(),
    mergeGitHubPullRequest: vi.fn(),
    markGitHubPullRequestReady: vi.fn(),
  };
}
test("the Native PR list renders its existing tabs and search controls", async () => {
  render(wrap(<WorkspacePrTab {...prProps()} />));
  await waitFor(() => expect(screen.getByRole("tab", { name: /0 Open/ })).toBeTruthy());
  expect(screen.getByRole("tab", { name: /0 Closed/ })).toBeTruthy();
  expect(screen.getByPlaceholderText("Search pull requests")).toBeTruthy();
});
test("an unauthenticated PR page offers the extension authorization entry point", async () => {
  const props = prProps(false);
  render(wrap(<WorkspacePrTab {...props} />));
  const button = await screen.findByRole("button", { name: "Authorize GitHub" });
  expect(button.parentElement?.textContent).toBe("Authorize GitHub to use Pull Requests");
  expect(button.classList.contains("underline")).toBe(true);
  fireEvent.click(button);
  expect(props.onAuthorize).toHaveBeenCalledOnce();
  expect(props.listGitHubPullRequests).not.toHaveBeenCalled();
});

test("the PR authorization hint follows live language changes without changing navigation", async () => {
  const localized = i18next.createInstance();
  await localized.init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
  const onSignIn = vi.fn();
  render(
    <I18nextProvider i18n={localized}>
      <GitHubSignInPrompt onSignIn={onSignIn} />
    </I18nextProvider>,
  );
  expect(screen.getByRole("button", { name: "Authorize GitHub" })).toBeTruthy();
  await act(async () => {
    await localized.changeLanguage("zh-CN");
  });
  const link = screen.getByRole("button", { name: "授权 GitHub" });
  expect(link.parentElement?.textContent).toBe("授权 GitHub 以使用 Pull Request");
  expect(link.classList.contains("underline")).toBe(true);
  fireEvent.click(link);
  expect(onSignIn).toHaveBeenCalledOnce();
});
