import { randomUUID } from "node:crypto";
import { findProviderPreset } from "@spiritagent/agent-core/provider-presets";
import type {
  BeginChatGptOAuthRequest,
  BeginChatGptOAuthResponse,
  CompleteChatGptOAuthResponse,
  DesktopSnapshot,
} from "@spiritagent/api/types";
import {
  buildChatGptAuthorizationUrl,
  CHATGPT_OAUTH_AUTHORIZATION_TIMEOUT_MS,
  chatGptCredentialsFromTokenResponse,
  ChatGptOAuthError,
  createChatGptAuthorizationRequest,
  exchangeChatGptAuthorizationCode,
  getOrCreateChatGptExtAgentHostId,
  hasChatGptPlanUsageScope,
  listenForChatGptAuthorizationCallback,
  readStoredChatGptOAuthCredentials,
  resolveChatGptOAuthEndpoints,
  storeChatGptOAuthCredentialsLocked,
  verifyChatGptIdToken,
  type ChatGptAuthorizationCallback,
  type ChatGptAuthorizationRequest,
  type ChatGptOAuthEndpoints,
} from "@spiritagent/config/chatgpt-oauth";

import { addProviderModelsCommand, type HostModelCommandContext } from "./host-model-commands.js";
import { loadPreviewModelsForTransport } from "./model-config.js";
import { spiritDataDir } from "./storage.js";

const DEFAULT_CHATGPT_PROVIDER_ID = "chatgpt";

interface PendingChatGptOAuthSession {
  sessionId: string;
  providerId: string;
  controller: AbortController;
  timeoutSignal: AbortSignal;
  callback: ChatGptAuthorizationCallback;
  request: ChatGptAuthorizationRequest;
  extAgentHostId: string;
  endpoints?: Partial<ChatGptOAuthEndpoints>;
  fetch?: typeof fetch;
}

export interface BeginChatGptOAuthOptions {
  openExternal?: (url: string) => Promise<void>;
  endpoints?: Partial<ChatGptOAuthEndpoints>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface CompleteChatGptOAuthOptions {
  apiBaseOverride?: string;
  now?: () => number;
}

export class ChatGptOAuthConnectManager {
  private readonly pending = new Map<string, PendingChatGptOAuthSession>();

  async begin(
    input: BeginChatGptOAuthRequest = {},
    options: BeginChatGptOAuthOptions = {},
  ): Promise<BeginChatGptOAuthResponse> {
    const providerId = input.providerId?.trim() || DEFAULT_CHATGPT_PROVIDER_ID;
    // Cancel any existing pending authorization session for this provider so retries or repeated
    // clicks do not leak loopback listeners or leave stale flows active.
    for (const [existingId, existingSession] of this.pending) {
      if (existingSession.providerId === providerId) {
        this.cancel(existingId);
      }
    }
    const dataDir = spiritDataDir();
    const extAgentHostId = await getOrCreateChatGptExtAgentHostId(dataDir);
    const existing = readStoredChatGptOAuthCredentials(providerId);
    const authRequest = createChatGptAuthorizationRequest();

    const controller = new AbortController();
    const timeoutSignal = AbortSignal.timeout(
      options.timeoutMs ?? CHATGPT_OAUTH_AUTHORIZATION_TIMEOUT_MS,
    );
    const combinedSignal = AbortSignal.any([controller.signal, timeoutSignal]);
    const callback = await listenForChatGptAuthorizationCallback({
      state: authRequest.state,
      ...(existing?.clientId ? { expectedClientId: existing.clientId } : {}),
      signal: combinedSignal,
    });
    // Prevent unhandled rejections if cancel(), dispose(), or a superseding begin() aborts the
    // loopback listener before complete() awaits callback.result.
    void callback.result.catch(() => undefined);

    const authorizationUrl = buildChatGptAuthorizationUrl({
      redirectUri: callback.redirectUri,
      state: authRequest.state,
      nonce: authRequest.nonce,
      codeChallenge: authRequest.codeChallenge,
      extAgentHostId,
      ...(existing?.clientId ? { clientId: existing.clientId } : {}),
      ...(existing?.idToken ? { idTokenHint: existing.idToken } : {}),
      ...(existing?.email ? { loginHint: existing.email } : {}),
      ...(input.promptConsent ? { promptConsent: true } : {}),
      ...(options.endpoints ? { endpoints: options.endpoints } : {}),
    });

    const sessionId = randomUUID();
    this.pending.set(sessionId, {
      sessionId,
      providerId,
      controller,
      timeoutSignal,
      callback,
      request: authRequest,
      extAgentHostId,
      ...(options.endpoints ? { endpoints: options.endpoints } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });

    if (options.openExternal) {
      try {
        await options.openExternal(authorizationUrl);
      } catch {
        // Non-fatal: the dialog still renders a button to reopen the authorization URL manually.
      }
    }

    return { sessionId, authorizationUrl };
  }

  async complete(
    sessionId: string,
    ctx: HostModelCommandContext,
    options: CompleteChatGptOAuthOptions = {},
  ): Promise<CompleteChatGptOAuthResponse> {
    const session = this.pending.get(sessionId);
    if (!session) {
      return {
        phase: "error",
        code: "session_not_found",
        message: "ChatGPT authorization session was cancelled or expired.",
      };
    }

    try {
      const callbackResult = await session.callback.result;
      const combinedSignal = AbortSignal.any([session.controller.signal, session.timeoutSignal]);
      const tokenResponse = await exchangeChatGptAuthorizationCode({
        clientId: callbackResult.clientId,
        code: callbackResult.code,
        codeVerifier: session.request.codeVerifier,
        redirectUri: session.callback.redirectUri,
        ...(session.endpoints ? { endpoints: session.endpoints } : {}),
        ...(session.fetch ? { fetch: session.fetch } : {}),
        signal: combinedSignal,
      });

      if (!tokenResponse.id_token?.trim()) {
        throw new ChatGptOAuthError("ChatGPT did not return an ID token.", {
          code: "invalid_id_token",
        });
      }

      const claims = await verifyChatGptIdToken({
        idToken: tokenResponse.id_token,
        expectedClientId: callbackResult.clientId,
        expectedNonce: session.request.nonce,
        ...(session.endpoints ? { endpoints: session.endpoints } : {}),
        ...(session.fetch ? { fetch: session.fetch } : {}),
        ...(options.now ? { now: options.now } : {}),
        signal: combinedSignal,
      });

      const grantedScopes = tokenResponse.scope ?? callbackResult.scope;
      if (!hasChatGptPlanUsageScope(grantedScopes)) {
        throw new ChatGptOAuthError(
          "ChatGPT plan usage permission was not granted. Authorize again and enable plan usage.",
          { code: "chatpass_v2_scope_not_authorized", status: 403 },
        );
      }

      const existing = readStoredChatGptOAuthCredentials(session.providerId);
      const credentials = chatGptCredentialsFromTokenResponse({
        response: {
          ...tokenResponse,
          ...(grantedScopes ? { scope: grantedScopes } : {}),
        },
        clientId: callbackResult.clientId,
        extAgentHostId: session.extAgentHostId,
        claims,
        ...(existing ? { previous: existing } : {}),
        now: options.now?.() ?? Date.now(),
      });
      await storeChatGptOAuthCredentialsLocked(session.providerId, credentials);

      const resolvedEndpoints = resolveChatGptOAuthEndpoints(session.endpoints);
      const preset = findProviderPreset(session.providerId) ?? findProviderPreset("chatgpt");
      const presetApiBase = preset?.transports["open-responses"] ?? "https://api.openai.com/v1";
      const apiBase =
        options.apiBaseOverride?.trim() ||
        (resolvedEndpoints.resource !== "https://api.openai.com/v1"
          ? resolvedEndpoints.resource
          : presetApiBase);

      const preview = await loadPreviewModelsForTransport({
        providerId: session.providerId,
        transportKind: "open-responses",
        apiBase,
        apiKey: credentials.accessToken,
        forceRefresh: true,
      });

      if (preview.modelIds.length === 0) {
        throw new ChatGptOAuthError("No eligible ChatGPT models were returned for this account.", {
          code: "subscription_sharing_user_not_eligible",
          status: 403,
        });
      }

      const snapshot = await this.persistConnectedChatGptProvider({
        ctx,
        providerId: session.providerId,
        apiBase,
        modelIds: preview.modelIds,
        ...(preview.modelCatalog ? { modelCatalog: preview.modelCatalog } : {}),
      });

      return {
        phase: "connected",
        ...(credentials.email ? { email: credentials.email } : {}),
        modelCount: preview.modelIds.length,
        snapshot,
      };
    } catch (error) {
      if (session.timeoutSignal.aborted) {
        return {
          phase: "error",
          code: "timeout",
          message: "ChatGPT authorization timed out. Try again.",
        };
      }
      if (session.controller.signal.aborted) {
        return {
          phase: "error",
          code: "cancelled",
          message: "ChatGPT authorization was cancelled.",
        };
      }
      const code = error instanceof ChatGptOAuthError ? error.code : undefined;
      const message = error instanceof Error ? error.message : String(error);
      return {
        phase: "error",
        ...(code ? { code } : {}),
        message,
      };
    } finally {
      this.pending.delete(sessionId);
    }
  }

  private persistConnectedChatGptProvider(input: {
    ctx: HostModelCommandContext;
    providerId: string;
    apiBase: string;
    modelIds: string[];
    modelCatalog?: import("@spiritagent/api/types").PreviewModelCatalogEntry[];
  }): Promise<DesktopSnapshot> {
    return addProviderModelsCommand(input.ctx, {
      provider: "chatgpt",
      providerId: input.providerId,
      transportKind: "open-responses",
      apiBase: input.apiBase,
      apiKey: "",
      credentialKind: "chatgpt-oauth",
      modelIds: input.modelIds,
      ...(input.modelCatalog ? { modelCatalog: input.modelCatalog } : {}),
    });
  }

  cancel(sessionId: string): void {
    const session = this.pending.get(sessionId);
    if (!session) {
      return;
    }
    this.pending.delete(sessionId);
    session.controller.abort();
  }

  dispose(): void {
    for (const session of this.pending.values()) {
      session.controller.abort();
    }
    this.pending.clear();
  }
}
