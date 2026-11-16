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
import { fetchGitHubUserLogin } from "./oauth.js";
import { withGitHubRequest } from "./github-fetch.js";
import { createGitHubService } from "./service.js";
import { parseGitHubPullRequestUrl } from "./pull-request-url.js";
import { createGitHubAutomationProvider } from "./extension-automation.js";

export const GITHUB_CREDENTIAL_SLOT = "oauthCredentials";
export interface GitHubCredentials {
  accessToken: string;
  login: string;
}
export type GitHubAuthorizationState =
  | { phase: "loading" }
  | { phase: "challenge"; userCode: string; verificationUri: string }
  | { phase: "connected"; login: string }
  | { phase: "error"; message: string; unavailable?: boolean; canDisconnect?: boolean };

class InvalidGitHubCredentialsError extends Error {
  constructor() {
    super("Stored GitHub authorization is invalid. Disconnect and authorize again.");
    this.name = "InvalidGitHubCredentialsError";
  }
}

export interface GitHubExtensionDependencies {
  fetch?: typeof fetch;
  clientId?: string;
  openExternal?: (url: string) => Promise<void>;
  readOrigin?: (root: string) => Promise<string | null>;
}

export function createGitHubExtension(
  context: SpiritExtensionContext,
  dependencies: GitHubExtensionDependencies = {},
) {
  let authorization: Promise<unknown> | undefined;
  let pendingView: SpiritDesktopViewSession | undefined;
  let pendingController: AbortController | undefined;
  const readCredentials = async (): Promise<GitHubCredentials | undefined> => {
    const raw = await context.secrets.get(GITHUB_CREDENTIAL_SLOT);
    if (!raw) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new InvalidGitHubCredentialsError();
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("accessToken" in value) ||
      !("login" in value) ||
      typeof value.accessToken !== "string" ||
      !value.accessToken.trim() ||
      typeof value.login !== "string" ||
      !value.login.trim()
    ) {
      throw new InvalidGitHubCredentialsError();
    }
    return { accessToken: value.accessToken, login: value.login };
  };
  const auth = {
    token: async () => (await readCredentials())?.accessToken,
    status: async () => {
      const credentials = await readCredentials();
      return credentials ? { connected: true, login: credentials.login } : { connected: false };
    },
    clear: () => context.secrets.delete(GITHUB_CREDENTIAL_SLOT),
  };
  const service = createGitHubService(
    auth,
    dependencies.readOrigin ? { readOrigin: dependencies.readOrigin } : {},
  );
  const request = <T>(signal: AbortSignal, run: () => T): T => {
    const lifetime = AbortSignal.any([context.signal, signal]);
    lifetime.throwIfAborted();
    return withGitHubRequest({ fetch: dependencies.fetch, signal: lifetime }, run);
  };

  async function authorize(action: SpiritDesktopActionContext): Promise<unknown> {
    action.signal.throwIfAborted();
    let credentials: GitHubCredentials | undefined;
    let credentialError: InvalidGitHubCredentialsError | undefined;
    try {
      credentials = await readCredentials();
    } catch (error) {
      if (!(error instanceof InvalidGitHubCredentialsError)) throw error;
      credentialError = error;
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
        const clientId = dependencies.clientId ?? GITHUB_OAUTH_CLIENT_ID;
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
          // One Secret write commits the credential and account together; no partial authorization state.
          await action.secrets.set(
            GITHUB_CREDENTIAL_SLOT,
            JSON.stringify({ accessToken: token.access_token, login } satisfies GitHubCredentials),
          );
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
      pendingController?.abort();
      pendingView?.close({ dismissed: true });
    },
  };
}

export function activate(context: SpiritExtensionContext) {
  return createGitHubExtension(context);
}
