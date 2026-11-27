/**
 * Spirit's Client ID Metadata Document, published by apps/site. The URL is the extension author's
 * OAuth identity, so it is not exposed to other extensions as a host capability.
 */
export const EXA_OAUTH_CLIENT_ID = "https://spirit.dev/oauth/client-metadata.json";

export const EXA_OAUTH_AUTHORIZATION_URL = "https://auth.exa.ai/oauth/authorize";
export const EXA_OAUTH_TOKEN_URL = "https://auth.exa.ai/api/oauth/token";
export const EXA_OAUTH_REVOCATION_URL = "https://auth.exa.ai/api/oauth/revoke";

export const EXA_OAUTH_ISSUER = "https://auth.exa.ai";

/** Exa MCP OAuth scope advertised by https://mcp.exa.ai/.well-known/oauth-protected-resource. */
export const EXA_OAUTH_SCOPE = "mcp:tools";

/** RFC 8707 resource indicator; must match the MCP protected resource metadata exactly. */
export const EXA_MCP_RESOURCE = "https://mcp.exa.ai/mcp";

/** Registered without a port; Exa accepts the runtime loopback port (RFC 8252 section 7.3). */
export const EXA_OAUTH_REDIRECT_HOST = "127.0.0.1";
export const EXA_OAUTH_REDIRECT_PATH = "/callback";
