export const CHATGPT_OAUTH_ISSUER = "https://auth.openai.com";
export const CHATGPT_OAUTH_AUTHORIZATION_URL = "https://auth.openai.com/api/accounts/authorize";
export const CHATGPT_OAUTH_TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const CHATGPT_OAUTH_JWKS_URL = "https://auth.openai.com/.well-known/jwks.json";
export const CHATGPT_OAUTH_RESOURCE = "https://api.openai.com/v1";

/** Entrypoint sentinel for first-time dynamic client registration; never saved as an issued client_id. */
export const CHATGPT_OAUTH_DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const CHATGPT_OAUTH_AGENT_NAME_HINT = "Spirit";
export const CHATGPT_OAUTH_REDIRECT_HOST = "127.0.0.1";
export const CHATGPT_OAUTH_REDIRECT_PATH = "/auth/callback";

export const CHATGPT_PLAN_USAGE_SCOPE = "chatgpt.tokens.use.direct";
export const CHATGPT_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  CHATGPT_PLAN_USAGE_SCOPE,
  "resource.invoke",
] as const;

export const CHATGPT_OAUTH_ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
export const CHATGPT_OAUTH_REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const CHATGPT_OAUTH_AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000;

export interface ChatGptOAuthEndpoints {
  issuer: string;
  authorizationUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  resource: string;
}

export const DEFAULT_CHATGPT_OAUTH_ENDPOINTS: ChatGptOAuthEndpoints = {
  issuer: CHATGPT_OAUTH_ISSUER,
  authorizationUrl: CHATGPT_OAUTH_AUTHORIZATION_URL,
  tokenUrl: CHATGPT_OAUTH_TOKEN_URL,
  jwksUrl: CHATGPT_OAUTH_JWKS_URL,
  resource: CHATGPT_OAUTH_RESOURCE,
};

let endpointsOverrideForTests: ChatGptOAuthEndpoints | undefined;
let fetchOverrideForTests: typeof fetch | undefined;

/** @internal Test/E2E hook to route built-in ChatGPT OAuth against a local loopback mock server. */
export function setChatGptOAuthEndpointsForTests(
  endpoints: ChatGptOAuthEndpoints | undefined,
): void {
  endpointsOverrideForTests = endpoints;
}

/** @internal Test/E2E hook to replace the fetch implementation used by ChatGPT OAuth. */
export function setChatGptOAuthFetchForTests(fetchImpl: typeof fetch | undefined): void {
  fetchOverrideForTests = fetchImpl;
}

export function resolveChatGptOAuthEndpoints(
  override?: Partial<ChatGptOAuthEndpoints>,
): ChatGptOAuthEndpoints {
  const base = endpointsOverrideForTests ?? DEFAULT_CHATGPT_OAUTH_ENDPOINTS;
  return {
    issuer: override?.issuer ?? base.issuer,
    authorizationUrl: override?.authorizationUrl ?? base.authorizationUrl,
    tokenUrl: override?.tokenUrl ?? base.tokenUrl,
    jwksUrl: override?.jwksUrl ?? base.jwksUrl,
    resource: override?.resource ?? base.resource,
  };
}

export function resolveChatGptOAuthFetch(override?: typeof fetch): typeof fetch {
  return override ?? fetchOverrideForTests ?? globalThis.fetch;
}
