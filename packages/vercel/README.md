# Vercel for Spirit

A native, built-in Spirit Extension for Desktop. The `@spiritagent/vercel` source
package connects Spirit to Vercel's official MCP server at `https://mcp.vercel.com`
and owns its authorization. Extension version: **1.0.0**. Author: **Spirit**.
Website: **spirit.dev**. Contact: **hi@spirit.dev**.

## Architecture

- The extension contributes a single MCP server. It has no tabs, link handlers, or
  Automation triggers; Vercel tools reach the agent through the MCP contribution.
- Authorization uses the OAuth authorization code flow with PKCE S256. The client
  identifies itself with Spirit's Client ID Metadata Document,
  `https://spirit.dev/oauth/client-metadata.json`, published by `apps/site`. That
  URL is the extension author's identity; it is not a host capability offered to
  other extensions. Vercel shows the consent screen as Spirit by spirit.dev.
- The extension backend receives the authorization response itself on an
  ephemeral `127.0.0.1` port, registered portless as `http://127.0.0.1/callback`.
  Only the response carrying the pending `state` completes the request; the
  listener closes on completion, denial, cancellation, extension disposal, or a
  ten-minute timeout. Vercel does not return the `iss` authorization response
  parameter, so it is not required.
- Requests use the `openid profile offline_access` scope and the
  `https://mcp.vercel.com/` resource indicator. The access token, rotating refresh
  token, access token expiry, and account username are committed together in the
  declared `oauthCredentials` Secret slot; only the username reaches the extension
  page.
- The username is the `preferred_username` claim of the ID token returned by the
  authorization code exchange. The token comes directly from Vercel's token
  endpoint over TLS and only labels the connection, so its issuer and audience are
  checked but its signature is not. Refresh responses carry no ID token, so the
  stored username is kept; the ID token itself is never stored. A missing or
  untrusted claim only drops the label, and the view reads "Connected to Vercel".
- Access tokens last one hour and refresh in the background ten minutes before
  expiry. Each refresh runs inside the atomic Secret update, so concurrent
  extension-host processes never spend the same rotating refresh token, and the
  Secret notification propagates the new token to the MCP contribution. A
  rejected refresh grant retires the credential; transient failures keep it and
  retry with bounded backoff.
- Disconnecting deletes the local credential first, then revokes the refresh and
  access tokens. Vercel MCP may keep accepting a revoked access token until it
  expires, so revocation failures are logged rather than restoring the credential.

## Build and Test

Run `pnpm --filter @spiritagent/vercel build` and
`pnpm --filter @spiritagent/vercel test` from the repository root. Build first:
artifact tests also load the real output, not just source modules.

`dist/extension` is the self-contained artifact assembled into the built-in
marketplace by `@spiritagent/extensions`. It includes this README, the MIT
license, and the padded Vercel symbol icon.

Tests inject the token transport and play the browser against the real loopback
listener; they do not require a Vercel account.

## License

MIT — see [LICENSE](LICENSE). The Vercel symbol identifies the integration and is
used unmodified, as published at https://vercel.com/brand; **Spirit** is the
extension author, not the owner of Vercel.

Vercel, the Vercel design, Next.js and related marks, designs and logos are
trademarks or registered trademarks of Vercel, Inc. or its affiliates in the US and
other countries.
