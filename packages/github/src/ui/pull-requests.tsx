import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import { WorkspaceMarkdownLinkProvider } from "@spiritagent/ui/rendering";
import type { PullRequestChipStatus } from "@spiritagent/ui/composer";
import type {
  SpiritDesktopTabPageApi,
  SpiritDesktopTabPageContext,
} from "@spiritagent/extension-toolkit/desktop-ui";
import type { GitHubService } from "../service.js";
import type { GitHubPullRequestUrlRef } from "../pull-request-url.js";
import { WorkspacePrTab } from "./components/workspace-pr-tab.js";
import { GitHubLayoutProvider } from "./lib/layout-prefs.js";
import { GitHubPageProvider } from "./page-context.js";
import { bridge, createPageI18n } from "./page-runtime.js";
import "./style.css";

function client(page: SpiritDesktopTabPageApi): GitHubService {
  const call = (name: string) => (params?: unknown) => page.request(name, params);
  return Object.fromEntries(
    [
      "getGitHubAuthStatus",
      "getGitHubPullRequestForCurrentBranch",
      "getGitHubPullRequestDetail",
      "getGitHubPullRequestConversation",
      "getGitHubPullRequestFiles",
      "getGitHubPullRequestCommits",
      "getGitHubPullRequestChecks",
      "mergeGitHubPullRequest",
      "markGitHubPullRequestReady",
      "listGitHubPullRequests",
      "getGitHubPullRequestTabCounts",
      "listGitHubAutomationRepositories",
      "searchGitHubAutomationRepositories",
    ].map((name) => [name, call(name)]),
  ) as unknown as GitHubService;
}

function statusIcon(status?: PullRequestChipStatus) {
  const Icon =
    status === "draft"
      ? GitPullRequestDraft
      : status === "closed"
        ? GitPullRequestClosed
        : GitPullRequest;
  const svg = renderToStaticMarkup(
    createElement(Icon, { strokeWidth: 1.75, stroke: "black", width: 24, height: 24 }),
  );
  return {
    type: "image" as const,
    monochrome: true,
    dataUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
  };
}

async function start() {
  const page = bridge.tab;
  const initial = await page.ready();
  const initialLayout = (await page.request("getLayout")) as Record<string, unknown>;
  const i18n = await createPageI18n(initial.locale);
  const api = client(page);
  const getCurrentBranch = () =>
    page.request("getGitHubPullRequestForCurrentBranch") as ReturnType<
      GitHubService["getGitHubPullRequestForCurrentBranch"]
    >;
  function App() {
    const [context, setContext] = useState<SpiritDesktopTabPageContext>(initial);
    const [error, setError] = useState<string>();
    const target = context.initialParams as GitHubPullRequestUrlRef | undefined;
    const owner = target?.owner,
      repo = target?.repo,
      number = target?.number;
    const reveal = useMemo(
      () => (owner && repo && number ? { owner, repo, number } : undefined),
      [owner, repo, number],
    );
    const reportError = useCallback(
      (error: unknown) => setError(error instanceof Error ? error.message : String(error)),
      [],
    );
    const saveLayout = useCallback(
      (patch: Record<string, number>) => page.request("setLayout", patch),
      [],
    );
    const external = useCallback(
      (url: string) => {
        void page.openExternal(url).catch(reportError);
      },
      [reportError],
    );
    const openLink = useCallback(
      (url: string) => {
        void page
          .request("openLink", { url })
          .then((handled) => {
            if (!handled) external(url);
          })
          .catch(reportError);
      },
      [external, reportError],
    );
    useEffect(
      () =>
        page.onContextChange((next) => {
          setContext(next);
          if (i18n.language !== next.locale) void i18n.changeLanguage(next.locale);
        }),
      [],
    );
    useEffect(() => page.mounted(), []);
    useEffect(() => {
      const handleLink = (event: MouseEvent) => {
        if (event.defaultPrevented || !(event.target instanceof Element)) return;
        const link = event.target.closest<HTMLAnchorElement>("a[href]");
        if (!link || link.getAttribute("href")?.startsWith("#")) return;
        event.preventDefault();
        openLink(link.href);
      };
      document.addEventListener("click", handleLink);
      return () => document.removeEventListener("click", handleLink);
    }, [openLink]);
    return (
      <I18nextProvider i18n={i18n}>
        <GitHubPageProvider context={context}>
          <GitHubLayoutProvider initial={initialLayout} save={saveLayout} onError={reportError}>
            <WorkspaceMarkdownLinkProvider
              onLinkClick={(url, event) => {
                event.preventDefault();
                openLink(url);
                return true;
              }}
            >
              <div
                data-workspace-tools-split
                className="relative flex h-full min-h-0 flex-col overflow-hidden"
              >
                {error ? (
                  <p role="alert" className="px-3 pt-2 text-xs text-destructive">
                    {error}
                  </p>
                ) : null}
                <WorkspacePrTab
                  key={`${context.workspaceRoot}:${context.authorizationConfigured}`}
                  {...api}
                  getGitHubPullRequestForCurrentBranch={getCurrentBranch}
                  gitSnapshot={context.workspace}
                  isActive={context.visible}
                  prTabEnabled
                  onAuthorize={() => {
                    void page.openExtensionDetails().catch(reportError);
                  }}
                  onOpenExternal={external}
                  prRevealEnabled={Boolean(reveal)}
                  prRevealNonce={reveal ? (context.navigationRevision ?? 0) + 1 : 0}
                  prRevealRequest={reveal}
                  onPrDiffAddToChat={(attachment) => {
                    void page.addAttachment({ kind: "prDiff", ...attachment }).catch(reportError);
                  }}
                  useTranslucency={context.theme.htmlClassName.includes(
                    "spirit-desktop-translucency",
                  )}
                  onTitleChange={(title) =>
                    page.setChrome({ title: title ?? i18n.t("workspace.prTab") })
                  }
                  onPrStatusChange={(status) => page.setChrome({ icon: statusIcon(status) })}
                  className="min-h-0 flex-1"
                />
              </div>
            </WorkspaceMarkdownLinkProvider>
          </GitHubLayoutProvider>
        </GitHubPageProvider>
      </I18nextProvider>
    );
  }
  createRoot(document.getElementById("root")!, {
    onUncaughtError: (error) => page.fail(error),
  }).render(<App />);
}
void start();
