import type {
  SpiritExtensionContext,
  SpiritDesktopActionContext,
  SpiritDesktopOpenLinkContext,
  SpiritDesktopPageRequestContext,
  SpiritDesktopViewSession,
} from "@spiritagent/extension-toolkit/desktop-ui";
import type { AutomationTriggerProvider } from "@spiritagent/automations/trigger-provider";
import { GITHUB_OAUTH_CLIENT_ID } from "./oauth-config.js";
import { requestGitHubDeviceCode, pollGitHubDeviceToken } from "./device-flow.js";
import { fetchGitHubUserLogin, GitHubOAuthError } from "./oauth.js";
import { withGitHubRequest } from "./github-fetch.js";
import {
  createGitHubCredentialManager,
  GITHUB_CREDENTIAL_SLOT,
  InvalidGitHubCredentialsError,
  type GitHubCredentials,
} from "./credentials.js";
import { createGitHubRefreshScheduler } from "./refresh-scheduler.js";
import { createGitHubService } from "./service.js";
import { parseGitHubPullRequestUrl } from "./pull-request-url.js";
import { createGitHubAutomationProvider } from "./extension-automation.js";

export { GITHUB_CREDENTIAL_SLOT };
export type { GitHubCredentials };
export type GitHubAuthorizationState =
  | { phase: "loading" }
  | { phase: "challenge"; userCode: string; verificationUri: string }
  | { phase: "connected"; login: string }
  | { phase: "error"; message: string; unavailable?: boolean; canDisconnect?: boolean };

export interface GitHubExtensionDependencies {
  fetch?: typeof fetch;
  clientId?: string;
  openExternal?: (url: string) => Promise<void>;
  readOrigin?: (root: string) => Promise<string | null>;
  startBackgroundRefresh?: boolean;
  now?: () => number;
}

export function createGitHubExtension(
  context: SpiritExtensionContext,
  dependencies: GitHubExtensionDependencies = {},
) {
  let authorization: Promise<unknown> | undefined;
  let pendingView: SpiritDesktopViewSession | undefined;
  let pendingController: AbortController | undefined;
  const clientId = dependencies.clientId ?? GITHUB_OAUTH_CLIENT_ID;
  const credentialManager = createGitHubCredentialManager({
    secrets: context.secrets,
    clientId,
    now: dependencies.now,
  });
  const readCredentials = () => credentialManager.read();
  const auth = {
    token: () => credentialManager.token(),
    status: () => credentialManager.status(),
    clear: async () => {
      refreshScheduler.clear();
      await credentialManager.clear();
    },
  };
  const service = createGitHubService(
    auth,
    dependencies.readOrigin ? { readOrigin: dependencies.readOrigin } : {},
  );
  const request = <T>(signal: AbortSignal, run: () => T): T => {
    const lifetime = AbortSignal.any([context.signal, signal]);
    lifetime.throwIfAborted();
    return withGitHubRequest(
      {
        fetch: dependencies.fetch,
        signal: lifetime,
        refreshAccessToken: credentialManager.refreshAfterRejected,
      },
      run,
    );
  };
  const refreshScheduler = createGitHubRefreshScheduler({
    signal: context.signal,
    read: () => credentialManager.read({ allowValidTokenOnRefreshFailure: false }),
    runInBackground: (run) =>
      withGitHubRequest(
        {
          fetch: dependencies.fetch,
          signal: context.signal,
          refreshAccessToken: credentialManager.refreshAfterRejected,
        },
        run,
      ),
    log: context.log,
    now: dependencies.now,
  });
  if (dependencies.startBackgroundRefresh) refreshScheduler.start();

  async function authorize(action: SpiritDesktopActionContext): Promise<unknown> {
    action.signal.throwIfAborted();
    let credentials: GitHubCredentials | undefined;
    let credentialError: InvalidGitHubCredentialsError | undefined;
    try {
      credentials = await readCredentials();
    } catch (error) {
      if (error instanceof InvalidGitHubCredentialsError) {
        credentialError = error;
      } else if (!(error instanceof GitHubOAuthError && error.status === 401)) {
        throw error;
      }
    }
    action.signal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([action.signal, controller.signal]);
    pendingController = controller;
    const view = await action.host.ui.open(
      "authorize",
      credentialError
        ? { phase: "error", message: credentialError.message, canDisconnect: true }
        : credentials
          ? { phase: "connected", login: credentials.login }
          : { phase: "loading" },
    );
    pendingView = view;
    void view.result.then(() => controller.abort());
    try {
      if (signal.aborted) {
        view.close({ dismissed: true });
        return { connected: false };
      }
      if (credentials || credentialError) {
        const result = (await view.result) as { disconnect?: boolean } | undefined;
        if (result?.disconnect) await auth.clear();
        return { connected: Boolean(credentials) && !result?.disconnect };
      }
      try {
        if (!clientId) {
          view.update({
            phase: "error",
            message:
              "GitHub authorization is unavailable until the Spirit OAuth App is configured.",
            unavailable: true,
          } satisfies GitHubAuthorizationState);
          await view.result;
          return { connected: false };
        }
        await request(signal, async () => {
          const challenge = await requestGitHubDeviceCode({ clientId, signal });
          signal.throwIfAborted();
          view.update({
            phase: "challenge",
            userCode: challenge.userCode,
            verificationUri: challenge.verificationUri,
          } satisfies GitHubAuthorizationState);
          await (dependencies.openExternal ?? action.host.openExternal)(challenge.verificationUri);
          const token = await pollGitHubDeviceToken({
            deviceCode: challenge.deviceCode,
            expiresIn: challenge.expiresIn,
            intervalSeconds: challenge.intervalSeconds,
            clientId,
            signal,
          });
          const login = await fetchGitHubUserLogin(token.access_token, signal);
          signal.throwIfAborted();
          // One Secret write commits the complete credential and account together.
          await credentialManager.store(token, login);
          if (dependencies.startBackgroundRefresh) refreshScheduler.start();
          view.close({ connected: true });
        });
        return { connected: true };
      } catch (error) {
        if (signal.aborted) return { connected: false };
        view.update({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        } satisfies GitHubAuthorizationState);
        await view.result;
        return { connected: false };
      }
    } finally {
      controller.abort();
      if (pendingView === view) pendingView = undefined;
      if (pendingController === controller) pendingController = undefined;
    }
  }

  const automation = createGitHubAutomationProvider(service, auth);
  const automationTriggers: Record<string, AutomationTriggerProvider> = {
    activity: {
      validate: (input) => request(context.signal, () => automation.validate(input)),
      menu: (input) => request(input.signal, () => automation.menu!(input)),
      poll: (input) => {
        const signal = AbortSignal.any([context.signal, input.signal]);
        return request(signal, () => automation.poll({ ...input, signal }));
      },
    },
  };
  return {
    actions: {
      authorize(action: SpiritDesktopActionContext) {
        authorization ??= authorize(action).finally(() => {
          authorization = undefined;
        });
        return authorization;
      },
    },
    automationTriggers,
    async onTabRequest(input: SpiritDesktopPageRequestContext): Promise<unknown> {
      return request(input.signal, async () => {
        if (input.method === "openLink") {
          const url = (input.params as { url?: unknown })?.url;
          if (typeof url !== "string") throw new Error("A link URL is required.");
          const target = parseGitHubPullRequestUrl(url);
          if (!target) return false;
          await input.host.tabs.open({
            contributionId: "pull-requests",
            reuse: "context",
            initialParams: target,
            preferInstanceId: input.instanceId,
          });
          return true;
        }
        if (input.method === "getLayout") return input.settings.getAll();
        if (input.method === "setLayout") {
          const values = input.params as Record<string, unknown>;
          if (!values || typeof values !== "object")
            throw new Error("Layout preferences are required.");
          const patch: Record<string, number> = {};
          for (const key of ["pr-overview-ratio", "pr-files-width"]) {
            const value = values[key];
            if (value === undefined) continue;
            if (
              typeof value !== "number" ||
              !Number.isFinite(value) ||
              value <= 0 ||
              (key === "pr-overview-ratio" && value >= 1)
            )
              throw new Error("Invalid pull request layout preference.");
            patch[key] = value;
          }
          return input.settings.setAll(patch);
        }
        if (input.method === "getGitHubPullRequestForCurrentBranch")
          return service.getGitHubPullRequestForCurrentBranch(input.context);
        if (!Object.hasOwn(service, input.method))
          throw new Error(`Unknown GitHub page request: ${input.method}`);
        const operation = service[input.method as keyof typeof service] as (
          params?: unknown,
        ) => Promise<unknown>;
        return operation(input.params);
      });
    },
    async onOpenLink(input: SpiritDesktopOpenLinkContext): Promise<boolean> {
      const target = parseGitHubPullRequestUrl(input.url);
      if (!target) return false;
      await input.host.tabs.open({
        contributionId: "pull-requests",
        reuse: "context",
        initialParams: target,
        ...(input.sourceTabId ? { preferInstanceId: input.sourceTabId } : {}),
      });
      return true;
    },
    dispose() {
      refreshScheduler.dispose();
      pendingController?.abort();
      pendingView?.close({ dismissed: true });
    },
  };
}

export function activate(context: SpiritExtensionContext) {
  return createGitHubExtension(context, { startBackgroundRefresh: true });
}
