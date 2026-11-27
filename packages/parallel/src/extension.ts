import type {
  SpiritDesktopActionContext,
  SpiritDesktopViewSession,
  SpiritExtensionContext,
} from "@spiritagent/extension-toolkit/desktop-ui";

import {
  createParallelCredentialManager,
  InvalidParallelCredentialsError,
  PARALLEL_CREDENTIAL_SLOT,
  type ParallelCredentials,
  type StoredParallelCredentials,
} from "./credentials.js";
import {
  createParallelAuthorizationRequest,
  exchangeParallelAuthorizationCode,
  parallelAuthorizationUrl,
  ParallelOAuthError,
  listenForParallelAuthorizationCode,
  revokeParallelToken,
} from "./oauth.js";
import { createParallelRefreshScheduler } from "./refresh-scheduler.js";

export { PARALLEL_CREDENTIAL_SLOT };

/** Abandoned browser sessions must not hold the loopback port forever. */
export const PARALLEL_AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000;

export type ParallelAuthorizationState =
  | { phase: "loading" }
  | { phase: "waiting"; authorizationUrl: string }
  | { phase: "connected" }
  | { phase: "error"; message: string; canDisconnect?: boolean };

export interface ParallelExtensionDependencies {
  fetch?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
  startBackgroundRefresh?: boolean;
  now?: () => number;
  authorizationTimeoutMs?: number;
}

export function createParallelExtension(
  context: SpiritExtensionContext,
  dependencies: ParallelExtensionDependencies = {},
) {
  let authorization: Promise<unknown> | undefined;
  let pendingView: SpiritDesktopViewSession | undefined;
  let pendingController: AbortController | undefined;
  const transport = dependencies.fetch ?? globalThis.fetch;
  // Disabling or removing the extension cancels every Parallel request it started.
  const fetchForLifetime: typeof fetch = (input, init) =>
    transport(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([context.signal, init.signal]) : context.signal,
    });
  const credentialManager = createParallelCredentialManager({
    secrets: context.secrets,
    fetch: fetchForLifetime,
    now: dependencies.now,
  });
  const refreshScheduler = createParallelRefreshScheduler({
    signal: context.signal,
    read: () => credentialManager.read({ allowValidTokenOnRefreshFailure: false }),
    readAccessTokenExpiresAt: () => credentialManager.readAccessTokenExpiresAt(),
    log: context.log,
    now: dependencies.now,
  });
  if (dependencies.startBackgroundRefresh) refreshScheduler.start();

  async function disconnect() {
    refreshScheduler.clear();
    const removed = await credentialManager.clear();
    if (removed) await revoke(removed);
  }

  async function revoke(credentials: Pick<StoredParallelCredentials, "refreshToken">) {
    // Local removal is the authoritative disconnect; failed revocations are logged without
    // restoring the credential.
    try {
      await revokeParallelToken({
        fetch: fetchForLifetime,
        refreshToken: credentials.refreshToken,
      });
    } catch {
      context.log("Parallel refresh_token revocation failed; the local credential was removed.");
    }
  }

  async function authorize(action: SpiritDesktopActionContext): Promise<unknown> {
    action.signal.throwIfAborted();
    let credentials: ParallelCredentials | undefined;
    let credentialError: Error | undefined;
    try {
      credentials = await credentialManager.read();
    } catch (error) {
      action.signal.throwIfAborted();
      if (context.signal.aborted) throw error;
      if (error instanceof InvalidParallelCredentialsError) {
        credentialError = error;
      } else if (!(error instanceof ParallelOAuthError && error.status === 401)) {
        credentialError = error instanceof Error ? error : new Error(String(error));
      }
    }
    action.signal.throwIfAborted();
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(
      dependencies.authorizationTimeoutMs ?? PARALLEL_AUTHORIZATION_TIMEOUT_MS,
    );
    const signal = AbortSignal.any([context.signal, action.signal, controller.signal, timeout]);
    pendingController = controller;
    const view = await action.host.ui.open(
      "authorize",
      (credentialError
        ? { phase: "error", message: credentialError.message, canDisconnect: true }
        : credentials
          ? { phase: "connected" }
          : { phase: "loading" }) satisfies ParallelAuthorizationState,
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
        const request = createParallelAuthorizationRequest();
        const callback = await listenForParallelAuthorizationCode({ state: request.state, signal });
        const authorizationUrl = parallelAuthorizationUrl({
          redirectUri: callback.redirectUri,
          state: request.state,
          codeChallenge: request.codeChallenge,
        });
        view.update({ phase: "waiting", authorizationUrl } satisfies ParallelAuthorizationState);
        await (dependencies.openExternal ?? action.host.openExternal)(authorizationUrl);
        const code = await callback.code;
        const token = await exchangeParallelAuthorizationCode({
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
            ? "Parallel authorization timed out. Try again."
            : error instanceof Error
              ? error.message
              : String(error),
        } satisfies ParallelAuthorizationState);
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
  return createParallelExtension(context, { startBackgroundRefresh: true });
}
