/**
 * Spirit's Client ID Metadata Document, published by apps/site. The URL is the extension author's
 * OAuth identity, so it is not exposed to other extensions as a host capability.
 */
export const NOTION_OAUTH_CLIENT_ID = "https://spirit.dev/oauth/client-metadata.json";

export const NOTION_OAUTH_AUTHORIZATION_URL = "https://mcp.notion.com/authorize";
export const NOTION_OAUTH_TOKEN_URL = "https://mcp.notion.com/token";
export const NOTION_OAUTH_REVOCATION_URL = "https://mcp.notion.com/token";

/** RFC 9207 issuer identifier advertised by Notion MCP authorization server metadata. */
export const NOTION_OAUTH_ISSUER = "https://mcp.notion.com";

export const NOTION_OAUTH_SCOPE = "default";

/** RFC 8707 resource indicator; must match the MCP protected resource metadata exactly. */
export const NOTION_MCP_RESOURCE = "https://mcp.notion.com/mcp";

/** Registered without a port; Notion accepts the runtime loopback port (RFC 8252 section 7.3). */
export const NOTION_OAUTH_REDIRECT_HOST = "127.0.0.1";
export const NOTION_OAUTH_REDIRECT_PATH = "/callback";
