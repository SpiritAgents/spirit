/**
 * Spirit's Client ID Metadata Document, published by apps/site. The URL is the extension author's
 * OAuth identity, so it is not exposed to other extensions as a host capability.
 */
export const LINEAR_OAUTH_CLIENT_ID = "https://spirit.dev/oauth/client-metadata.json";

export const LINEAR_OAUTH_AUTHORIZATION_URL = "https://mcp.linear.app/authorize";
export const LINEAR_OAUTH_TOKEN_URL = "https://mcp.linear.app/token";
export const LINEAR_OAUTH_REVOCATION_URL = "https://mcp.linear.app/token";

export const LINEAR_OAUTH_ISSUER = "https://mcp.linear.app";

/** Linear MCP OAuth scopes advertised by https://mcp.linear.app/.well-known/oauth-protected-resource. */
export const LINEAR_OAUTH_SCOPE = "read write";

/** RFC 8707 resource indicator; must match the MCP protected resource metadata exactly. */
export const LINEAR_MCP_RESOURCE = "https://mcp.linear.app/mcp";

/** Registered without a port; Linear accepts the runtime loopback port (RFC 8252 section 7.3). */
export const LINEAR_OAUTH_REDIRECT_HOST = "127.0.0.1";
export const LINEAR_OAUTH_REDIRECT_PATH = "/callback";
