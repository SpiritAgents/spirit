# Notion for Spirit

A native, built-in Spirit Extension for Desktop. The `@spiritagent/notion` source
package connects Spirit to Notion's official MCP server at
`https://mcp.notion.com/mcp` and owns its authorization. Extension version:
**1.0.0**. Author: **Spirit**. Website: **spirit.dev**. Contact:
**hi@spirit.dev**.

## Architecture

- The extension contributes a single MCP server. It has no tabs, link handlers, or
  Automation triggers; Notion tools reach the agent through the MCP contribution.
- Authorization uses the OAuth authorization code flow with PKCE S256. The client
  identifies itself with Spirit's Client ID Metadata Document,
  `https://spirit.dev/oauth/client-metadata.json`, published by `apps/site`. That
  URL is the extension author's identity; it is not a host capability offered to
  other extensions.
- The extension backend receives the authorization response itself on an
  ephemeral `127.0.0.1` port, registered portless as `http://127.0.0.1/callback`.
  Only the response carrying the pending `state` settles the request, and RFC 9207
  issuer verification requires `iss=https://mcp.notion.com`. The listener closes
  on completion, denial, issuer mismatch, cancellation, extension disposal, or a
  ten-minute timeout.
- Requests use the `default` scope and the `https://mcp.notion.com/mcp` resource
  indicator. The access token, refresh token, and access token expiry are
  committed together in the declared `oauthCredentials` Secret slot and never
  reach the extension page. Notion MCP does not issue OIDC ID tokens, so the
  connected view reads "Connected to Notion".
- Access tokens refresh in the background ten minutes before expiry. Each refresh
  runs inside the atomic Secret update, so concurrent extension-host processes
  never spend the same rotating refresh token, and the Secret notification
  propagates the new token to the MCP contribution. If a refresh response omits
  `refresh_token`, the existing refresh token is retained. A refresh grant
  rejected with HTTP 401 or HTTP 400 `invalid_grant` retires the credential;
  transient failures keep it and retry with bounded backoff.
- Disconnecting deletes the local credential first inside the atomic Secret lock,
  then attempts RFC 7009 revocation for the refresh and access tokens, logging
  revocation failures without restoring the credential.

## Build and Test

Run `pnpm --filter @spiritagent/notion build` and
`pnpm --filter @spiritagent/notion test` from the repository root. Build first:
artifact tests also load the real output, not just source modules.

`dist/extension` is the self-contained artifact assembled into the built-in
marketplace by `@spiritagent/extensions`. It includes this README, the MIT
license, and the padded Notion logo icon.

Tests inject the token transport and play the browser against the real loopback
listener; they do not require a Notion account.

## License

MIT — see [LICENSE](LICENSE). The Notion logo identifies the integration and is
used unmodified from Notion's official media kit; **Spirit** is the extension
author, not the owner of Notion.

Notion and the Notion logo are trademarks or registered trademarks of Notion
Labs, Inc.
