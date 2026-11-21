import type {
  SpiritDesktopActionContext,
  SpiritDesktopViewSession,
  SpiritExtensionContext,
} from "@spiritagent/extension-toolkit/desktop-ui";

import {
  CLOUDFLARE_CREDENTIAL_SLOT,
  createCloudflareCredentialManager,
  type CloudflareCredentials,
} from "./credentials.js";
import {
  cloudflareAuthorizationUrl,
  CloudflareOAuthError,
  createCloudflareAuthorizationRequest,
  exchangeCloudflareAuthorizationCode,
  listenForCloudflareAuthorizationCode,
  revokeCloudflareToken,
} from "./oauth.js";
import { createCloudflareRefreshScheduler } from "./refresh-scheduler.js";

export { CLOUDFLARE_CREDENTIAL_SLOT };

/** Abandoned browser sessions must not hold the loopback port forever. */
export const CLOUDFLARE_AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000;

export type CloudflareAuthorizationState =
  | { phase: "loading" }
  | { phase: "waiting"; authorizationUrl: string }
  | { phase: "connected" }
  | { phase: "error"; message: string; canDisconnect?: boolean };

export interface CloudflareExtensionDependencies {
  fetch?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
  startBackgroundRefresh?: boolean;
  now?: () => number;
  authorizationTimeoutMs?: number;
}

export function createCloudflareExtension(
  context: SpiritExtensionContext,
  dependencies: CloudflareExtensionDependencies = {},
) {
  let authorization: Promise<unknown> | undefined;
  let pendingView: SpiritDesktopViewSession | undefined;
  let pendingController: AbortController | undefined;
  const transport = dependencies.fetch ?? globalThis.fetch;
  // Disabling or removing the extension cancels every Cloudflare request it started.
  const fetchForLifetime: typeof fetch = (input, init) =>
    transport(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([context.signal, init.signal]) : context.signal,
    });
  const credentialManager = createCloudflareCredentialManager({
    secrets: context.secrets,
    fetch: fetchForLifetime,
    now: dependencies.now,
  });
  const refreshScheduler = createCloudflareRefreshScheduler({
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

  async function revoke(credentials: CloudflareCredentials) {
    // Local removal is the authoritative disconnect; failed revocations are logged without
    // restoring the local credential.
    for (const [token, hint] of [
      [credentials.refreshToken, "refresh_token"],
      [credentials.accessToken, "access_token"],
    ] as const) {
      try {
        await revokeCloudflareToken({ fetch: fetchForLifetime, token, hint });
      } catch {
        context.log(`Cloudflare ${hint} revocation failed; the local credential was removed.`);
      }
    }
  }

  async function authorize(action: SpiritDesktopActionContext): Promise<unknown> {
    action.signal.throwIfAborted();
    let credentials: CloudflareCredentials | undefined;
    let credentialError: Error | undefined;
    try {
      credentials = await credentialManager.read();
    } catch (error) {
      if (action.signal.aborted || context.signal.aborted) {
        throw error;
      }
      if (!(error instanceof CloudflareOAuthError && error.status === 401)) {
        credentialError = error instanceof Error ? error : new Error(String(error));
      }
    }
    action.signal.throwIfAborted();
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(
      dependencies.authorizationTimeoutMs ?? CLOUDFLARE_AUTHORIZATION_TIMEOUT_MS,
    );
    const signal = AbortSignal.any([context.signal, action.signal, controller.signal, timeout]);
    pendingController = controller;
    const view = await action.host.ui.open(
      "authorize",
      (credentialError
        ? { phase: "error", message: credentialError.message, canDisconnect: true }
        : credentials
          ? { phase: "connected" }
          : { phase: "loading" }) satisfies CloudflareAuthorizationState,
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
        const request = createCloudflareAuthorizationRequest();
        const callback = await listenForCloudflareAuthorizationCode({
          state: request.state,
          signal,
        });
        // Prevent an unhandled rejection if openExternal throws or signal aborts before awaiting code.
        void callback.code.catch(() => undefined);
        const authorizationUrl = cloudflareAuthorizationUrl({
          redirectUri: callback.redirectUri,
          state: request.state,
          codeChallenge: request.codeChallenge,
        });
        view.update({ phase: "waiting", authorizationUrl } satisfies CloudflareAuthorizationState);
        await (dependencies.openExternal ?? action.host.openExternal)(authorizationUrl);
        const code = await callback.code;
        const token = await exchangeCloudflareAuthorizationCode({
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
            ? "Cloudflare authorization timed out. Try again."
            : error instanceof Error
              ? error.message
              : String(error),
        } satisfies CloudflareAuthorizationState);
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
  return createCloudflareExtension(context, { startBackgroundRefresh: true });
}
