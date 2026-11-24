export interface DynamicBearerAuthConfig {
  apiKey?: string;
  resolveBearerToken?: () => Promise<string>;
  refreshBearerTokenAfterUnauthorized?: (rejectedToken: string) => Promise<string | undefined>;
}

/**
 * Wraps fetch to inject a fresh Bearer token on every outbound request and retry once after an
 * HTTP 401 when `refreshBearerTokenAfterUnauthorized` returns a replacement token.
 */
export function wrapFetchForDynamicBearerAuth(
  config: DynamicBearerAuthConfig,
  baseFetch: typeof fetch,
): typeof fetch {
  const resolveToken = config.resolveBearerToken;
  if (!resolveToken) {
    return baseFetch;
  }

  return async (input, init) => {
    const token = await resolveToken();
    const firstHeaders = new Headers(init?.headers);
    firstHeaders.set("Authorization", `Bearer ${token}`);
    const response = await baseFetch(input, { ...init, headers: firstHeaders });
    if (response.status !== 401 || !config.refreshBearerTokenAfterUnauthorized) {
      return response;
    }

    const refreshed = await config.refreshBearerTokenAfterUnauthorized(token);
    if (!refreshed || refreshed === token) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("Authorization", `Bearer ${refreshed}`);
    return baseFetch(input, { ...init, headers: retryHeaders });
  };
}

export function resolveDynamicBearerOpenResponsesApiKey(config: DynamicBearerAuthConfig): string {
  const apiKey = config.apiKey?.trim();
  if (apiKey) {
    return apiKey;
  }
  if (config.resolveBearerToken) {
    return "dynamic-bearer-token";
  }
  return "";
}
