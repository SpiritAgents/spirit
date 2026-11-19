import type {
  SpiritDesktopActionContext,
  SpiritDesktopViewSession,
  SpiritExtensionContext,
} from "@spiritagent/extension-toolkit/desktop-ui";

import {
  createVercelCredentialManager,
  InvalidVercelCredentialsError,
  VERCEL_CREDENTIAL_SLOT,
  type VercelCredentials,
} from "./credentials.js";
import {
  createVercelAuthorizationRequest,
  exchangeVercelAuthorizationCode,
  listenForVercelAuthorizationCode,
  revokeVercelToken,
  vercelAuthorizationUrl,
  VercelOAuthError,
} from "./oauth.js";
import { createVercelRefreshScheduler } from "./refresh-scheduler.js";

export { VERCEL_CREDENTIAL_SLOT };

/** Abandoned browser sessions must not hold the loopback port forever. */
export const VERCEL_AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000;

export type VercelAuthorizationState =
  | { phase: "loading" }
  | { phase: "waiting"; authorizationUrl: string }
  | { phase: "connected"; username?: string }
  | { phase: "error"; message: string; canDisconnect?: boolean };

export interface VercelExtensionDependencies {
  fetch?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
  startBackgroundRefresh?: boolean;
  now?: () => number;
  authorizationTimeoutMs?: number;
}

export function createVercelExtension(
  context: SpiritExtensionContext,
  dependencies: VercelExtensionDependencies = {},
) {
  let authorization: Promise<unknown> | undefined;
  let pendingView: SpiritDesktopViewSession | undefined;
  let pendingController: AbortController | undefined;
  const transport = dependencies.fetch ?? globalThis.fetch;
  // Disabling or removing the extension cancels every Vercel request it started.
  const fetchForLifetime: typeof fetch = (input, init) =>
    transport(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([context.signal, init.signal]) : context.signal,
    });
  const credentialManager = createVercelCredentialManager({
    secrets: context.secrets,
    fetch: fetchForLifetime,
    now: dependencies.now,
  });
  const refreshScheduler = createVercelRefreshScheduler({
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

  async function revoke(credentials: VercelCredentials) {
    // Local removal is the authoritative disconnect; Vercel MCP may still honor the access token
    // until it expires, so a failed revocation is reported without restoring the credential.
    for (const [token, hint] of [
      [credentials.refreshToken, "refresh_token"],
      [credentials.accessToken, "access_token"],
    ] as const) {
      try {
        await revokeVercelToken({ fetch: fetchForLifetime, token, hint });
      } catch {
        context.log(`Vercel ${hint} revocation failed; the local credential was removed.`);
      }
    }
  }

  async function authorize(action: SpiritDesktopActionContext): Promise<unknown> {
    action.signal.throwIfAborted();
    let credentials: VercelCredentials | undefined;
    let credentialError: InvalidVercelCredentialsError | undefined;
    try {
      credentials = await credentialManager.read();
    } catch (error) {
      if (error instanceof InvalidVercelCredentialsError) {
        credentialError = error;
      } else if (!(error instanceof VercelOAuthError && error.status === 401)) {
        throw error;
      }
    }
    action.signal.throwIfAborted();
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(
      dependencies.authorizationTimeoutMs ?? VERCEL_AUTHORIZATION_TIMEOUT_MS,
    );
    const signal = AbortSignal.any([context.signal, action.signal, controller.signal, timeout]);
    pendingController = controller;
    const view = await action.host.ui.open(
      "authorize",
      (credentialError
        ? { phase: "error", message: credentialError.message, canDisconnect: true }
        : credentials
          ? credentials.username
            ? { phase: "connected", username: credentials.username }
            : { phase: "connected" }
          : { phase: "loading" }) satisfies VercelAuthorizationState,
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
        const request = createVercelAuthorizationRequest();
        const callback = await listenForVercelAuthorizationCode({ state: request.state, signal });
        const authorizationUrl = vercelAuthorizationUrl({
          redirectUri: callback.redirectUri,
          state: request.state,
          codeChallenge: request.codeChallenge,
        });
        view.update({ phase: "waiting", authorizationUrl } satisfies VercelAuthorizationState);
        await (dependencies.openExternal ?? action.host.openExternal)(authorizationUrl);
        const code = await callback.code;
        const token = await exchangeVercelAuthorizationCode({
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
            ? "Vercel authorization timed out. Try again."
            : error instanceof Error
              ? error.message
              : String(error),
        } satisfies VercelAuthorizationState);
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
  return createVercelExtension(context, { startBackgroundRefresh: true });
}
