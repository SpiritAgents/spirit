# Cloudflare for Spirit

A native, built-in Spirit Extension for Desktop. The `@spiritagent/cloudflare` source
package connects Spirit to Cloudflare's official MCP server at `https://mcp.cloudflare.com/mcp`
and owns its authorization. Extension version: **1.0.0**. Author: **Spirit**.
Website: **spirit.dev**. Contact: **hi@spirit.dev**.

## Architecture

- The extension contributes a single MCP server (`lazyTools: false` so its tools are
  exposed directly to the agent without extra discovery round trips). It has no tabs,
  link handlers, or Automation triggers; Cloudflare tools reach the agent through the
  MCP contribution.
- Authorization uses the OAuth authorization code flow with PKCE S256. The client
  identifies itself with Spirit's Client ID Metadata Document,
  `https://spirit.dev/oauth/client-metadata.json`, published by `apps/site`. That
  URL is the extension author's identity; it is not a host capability offered to
  other extensions.
- The extension backend receives the authorization response itself on an
  ephemeral `127.0.0.1` port, registered portless as `http://127.0.0.1/callback`.
  Only the response carrying the pending `state` settles the request, and RFC 9207
  issuer verification requires `iss` to match `https://mcp.cloudflare.com`. The
  listener closes on completion, denial, issuer mismatch, cancellation, extension
  disposal, or a ten-minute timeout.
- Requests use the `offline_access user:read account:read` scope and the
  `https://mcp.cloudflare.com/mcp` resource indicator. The access token, refresh
  token, and access token expiry are committed together in the declared
  `oauthCredentials` Secret slot and never reach the extension page.
- Access tokens refresh in the background ten minutes before expiry inside the
  atomic Secret update, so concurrent extension-host processes never spend the same
  refresh token, and the Secret notification propagates the new token to the MCP
  contribution. If a refresh response omits a new refresh token, the stored refresh
  token is retained. A rejected refresh grant (HTTP `401` or HTTP `400`
  `invalid_grant`) retires the credential; transient failures keep it and retry with
  bounded backoff.
- Disconnecting deletes the local credential first, then attempts revocation of the
  refresh and access tokens. Revocation failures are logged rather than restoring
  the local credential.

## Build and Test

Run `pnpm --filter @spiritagent/cloudflare build` and
`pnpm --filter @spiritagent/cloudflare test` from the repository root. Build first:
artifact tests also load the real output, not just source modules.

`dist/extension` is the self-contained artifact assembled into the built-in
marketplace by `@spiritagent/extensions`. It includes this README, the MIT
license, and the tile icon.

Tests inject the token transport and play the browser against the real loopback
listener; they do not require a Cloudflare account.

## License

MIT — see [LICENSE](LICENSE).
