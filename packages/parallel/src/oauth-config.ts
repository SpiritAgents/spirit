/**
 * Spirit's Client ID Metadata Document, published by apps/site. The URL is the extension author's
 * OAuth identity, so it is not exposed to other extensions as a host capability.
 */
export const PARALLEL_OAUTH_CLIENT_ID = "https://spirit.dev/oauth/client-metadata.json";

export const PARALLEL_OAUTH_AUTHORIZATION_URL =
  "https://platform.parallel.ai/getServiceKeys/authorize";
export const PARALLEL_OAUTH_TOKEN_URL = "https://platform.parallel.ai/getServiceKeys/token";
export const PARALLEL_OAUTH_REVOCATION_URL =
  "https://platform.parallel.ai/getServiceKeys/token/revoke";

export const PARALLEL_OAUTH_ISSUER = "https://platform.parallel.ai/getServiceKeys";

/** Parallel OAuth scope for MCP service keys. */
export const PARALLEL_OAUTH_SCOPE = "*";

/**
 * RFC 8707 resource indicator advertised by
 * https://mcp.parallel.ai/.well-known/oauth-protected-resource/mcp?login.
 */
export const PARALLEL_MCP_RESOURCE = "https://mcp.parallel.ai/mcp?login";

/** Registered without a port; Parallel accepts the runtime loopback port (RFC 8252 section 7.3). */
export const PARALLEL_OAUTH_REDIRECT_HOST = "127.0.0.1";
export const PARALLEL_OAUTH_REDIRECT_PATH = "/callback";
