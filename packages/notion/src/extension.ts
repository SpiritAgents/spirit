import type {
  SpiritDesktopActionContext,
  SpiritDesktopViewSession,
  SpiritExtensionContext,
} from "@spiritagent/extension-toolkit/desktop-ui";

import {
  createNotionCredentialManager,
  InvalidNotionCredentialsError,
  NOTION_CREDENTIAL_SLOT,
  type NotionCredentials,
} from "./credentials.js";
import {
  createNotionAuthorizationRequest,
  exchangeNotionAuthorizationCode,
  listenForNotionAuthorizationCode,
  notionAuthorizationUrl,
  NotionOAuthError,
  revokeNotionToken,
} from "./oauth.js";
import { createNotionRefreshScheduler } from "./refresh-scheduler.js";

export { NOTION_CREDENTIAL_SLOT };

/** Abandoned browser sessions must not hold the loopback port forever. */
export const NOTION_AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000;

export type NotionAuthorizationState =
  | { phase: "loading" }
  | { phase: "waiting"; authorizationUrl: string }
  | { phase: "connected" }
  | { phase: "error"; message: string; canDisconnect?: boolean };

export interface NotionExtensionDependencies {
  fetch?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
  startBackgroundRefresh?: boolean;
  now?: () => number;
  authorizationTimeoutMs?: number;
}

export function createNotionExtension(
  context: SpiritExtensionContext,
  dependencies: NotionExtensionDependencies = {},
) {
  let authorization: Promise<unknown> | undefined;
  let pendingView: SpiritDesktopViewSession | undefined;
  let pendingController: AbortController | undefined;
  const transport = dependencies.fetch ?? globalThis.fetch;
  // Disabling or removing the extension cancels every Notion request it started.
  const fetchForLifetime: typeof fetch = (input, init) =>
    transport(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([context.signal, init.signal]) : context.signal,
    });
  const credentialManager = createNotionCredentialManager({
    secrets: context.secrets,
    fetch: fetchForLifetime,
    now: dependencies.now,
  });
  const refreshScheduler = createNotionRefreshScheduler({
    signal: context.signal,
    read: () => credentialManager.read({ allowValidTokenOnRefreshFailure: false }),
    log: context.log,
    now: dependencies.now,
  });
  if (dependencies.startBackgroundRefresh) refreshScheduler.start();

  async function disconnect() {
    refreshScheduler.clear();
    const removed = await credentialManager.clear();
    if (removed) await revoke(removed);
  }

  async function revoke(credentials: NotionCredentials) {
    // Local removal is the authoritative disconnect; a failed revocation is logged without
    // restoring the credential.
    for (const [token, hint] of [
      [credentials.refreshToken, "refresh_token"],
      [credentials.accessToken, "access_token"],
    ] as const) {
      try {
        await revokeNotionToken({ fetch: fetchForLifetime, token, hint });
      } catch {
        context.log(`Notion ${hint} revocation failed; the local credential was removed.`);
      }
    }
  }

  async function authorize(action: SpiritDesktopActionContext): Promise<unknown> {
    action.signal.throwIfAborted();
    let credentials: NotionCredentials | undefined;
    let credentialError: InvalidNotionCredentialsError | undefined;
    try {
      credentials = await credentialManager.read();
    } catch (error) {
      if (error instanceof InvalidNotionCredentialsError) {
        credentialError = error;
      } else if (!(error instanceof NotionOAuthError && error.status === 401)) {
        throw error;
      }
    }
    action.signal.throwIfAborted();
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(
      dependencies.authorizationTimeoutMs ?? NOTION_AUTHORIZATION_TIMEOUT_MS,
    );
    const signal = AbortSignal.any([context.signal, action.signal, controller.signal, timeout]);
    pendingController = controller;
    const view = await action.host.ui.open(
      "authorize",
      (credentialError
        ? { phase: "error", message: credentialError.message, canDisconnect: true }
        : credentials
          ? { phase: "connected" }
          : { phase: "loading" }) satisfies NotionAuthorizationState,
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
        if (result?.disconnect) await disconnect();
        return { connected: Boolean(credentials) && !result?.disconnect };
      }
      try {
        const request = createNotionAuthorizationRequest();
        const callback = await listenForNotionAuthorizationCode({ state: request.state, signal });
        const authorizationUrl = notionAuthorizationUrl({
          redirectUri: callback.redirectUri,
          state: request.state,
          codeChallenge: request.codeChallenge,
        });
        view.update({ phase: "waiting", authorizationUrl } satisfies NotionAuthorizationState);
        await (dependencies.openExternal ?? action.host.openExternal)(authorizationUrl);
        const code = await callback.code;
        const token = await exchangeNotionAuthorizationCode({
          fetch: transport,
          code,
          redirectUri: callback.redirectUri,
          codeVerifier: request.codeVerifier,
          signal,
        });
        signal.throwIfAborted();
        await credentialManager.store(token);
        if (dependencies.startBackgroundRefresh) refreshScheduler.start();
        view.close({ connected: true });
        return { connected: true };
      } catch (error) {
        if (signal.aborted && !timeout.aborted) return { connected: false };
        view.update({
          phase: "error",
          message: timeout.aborted
            ? "Notion authorization timed out. Try again."
            : error instanceof Error
              ? error.message
              : String(error),
        } satisfies NotionAuthorizationState);
        await view.result;
        return { connected: false };
      }
    } finally {
      controller.abort();
      if (pendingView === view) pendingView = undefined;
      if (pendingController === controller) pendingController = undefined;
    }
  }

  return {
    actions: {
      authorize(action: SpiritDesktopActionContext) {
        authorization ??= authorize(action).finally(() => {
          authorization = undefined;
        });
        return authorization;
      },
    },
    dispose() {
      refreshScheduler.dispose();
      pendingController?.abort();
      pendingView?.close({ dismissed: true });
    },
  };
}

export function activate(context: SpiritExtensionContext) {
  return createNotionExtension(context, { startBackgroundRefresh: true });
}
