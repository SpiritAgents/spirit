/**
 * Spirit's Client ID Metadata Document, published by apps/site. The URL is the extension author's
 * OAuth identity, so it is not exposed to other extensions as a host capability.
 */
export const VERCEL_OAUTH_CLIENT_ID = "https://spirit.dev/oauth/client-metadata.json";

export const VERCEL_OAUTH_AUTHORIZATION_URL = "https://vercel.com/oauth/authorize";
export const VERCEL_OAUTH_TOKEN_URL = "https://api.vercel.com/login/oauth/token";
export const VERCEL_OAUTH_REVOCATION_URL = "https://api.vercel.com/login/oauth/token/revoke";

export const VERCEL_OAUTH_ISSUER = "https://vercel.com";

/**
 * The MCP resource metadata lists only openid. profile adds preferred_username to the ID token for
 * the account label, and offline_access is what makes Vercel issue a refresh token.
 */
export const VERCEL_OAUTH_SCOPE = "openid profile offline_access";

/** RFC 8707 resource indicator; must match the MCP protected resource metadata exactly. */
export const VERCEL_MCP_RESOURCE = "https://mcp.vercel.com/";

/** Registered without a port; Vercel accepts the runtime loopback port (RFC 8252 section 7.3). */
export const VERCEL_OAUTH_REDIRECT_HOST = "127.0.0.1";
export const VERCEL_OAUTH_REDIRECT_PATH = "/callback";
