/**
 * Spirit's Client ID Metadata Document, published by apps/site. The URL is the extension author's
 * OAuth identity, so it is not exposed to other extensions as a host capability.
 */
export const CLOUDFLARE_OAUTH_CLIENT_ID = "https://spirit.dev/oauth/client-metadata.json";

export const CLOUDFLARE_OAUTH_AUTHORIZATION_URL = "https://mcp.cloudflare.com/authorize";
export const CLOUDFLARE_OAUTH_TOKEN_URL = "https://mcp.cloudflare.com/token";
export const CLOUDFLARE_OAUTH_REVOCATION_URL = "https://mcp.cloudflare.com/token";

export const CLOUDFLARE_OAUTH_ISSUER = "https://mcp.cloudflare.com";

export const CLOUDFLARE_OAUTH_SCOPE = "offline_access user:read account:read";

/** RFC 8707 resource indicator; matches the Cloudflare MCP protected resource metadata. */
export const CLOUDFLARE_MCP_RESOURCE = "https://mcp.cloudflare.com/mcp";

/** Registered without a port; Cloudflare accepts the runtime loopback port (RFC 8252 section 7.3). */
export const CLOUDFLARE_OAUTH_REDIRECT_HOST = "127.0.0.1";
export const CLOUDFLARE_OAUTH_REDIRECT_PATH = "/callback";
