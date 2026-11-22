# Linear for Spirit

A native, built-in Spirit Extension for Desktop. The `@spiritagent/linear` source
package connects Spirit to Linear's official MCP server at `https://mcp.linear.app/mcp`
and owns its authorization. Extension version: **1.0.0**. Author: **Spirit**.
Website: **spirit.dev**. Contact: **hi@spirit.dev**.

## Architecture

- The extension contributes a single MCP server. It has no tabs, link handlers, or
  Automation triggers; Linear tools reach the agent through the MCP contribution.
- Authorization uses the OAuth authorization code flow with PKCE S256. The client
  identifies itself with Spirit's Client ID Metadata Document,
  `https://spirit.dev/oauth/client-metadata.json`, published by `apps/site`. That
  URL is the extension author's identity; it is not a host capability offered to
  other extensions. Linear shows the consent screen as Spirit by spirit.dev.
- The extension backend receives the authorization response itself on an
  ephemeral `127.0.0.1` port, registered portless as `http://127.0.0.1/callback`.
  Unrelated requests whose `state` does not match are rejected without ending the
  wait. Once a response carries the pending `state`, its RFC 9207 `iss` parameter
  must equal `https://mcp.linear.app`; a missing or mismatched issuer rejects the
  callback with HTTP 400 and fails the authorization attempt. The listener closes
  on completion, issuer mismatch, denial, cancellation, extension disposal, or a
  ten-minute timeout.
- Requests use the `read write` scope and the `https://mcp.linear.app/mcp`
  resource indicator. The access token, refresh token, and access token expiry
  are committed together in the declared `oauthCredentials` Secret slot and never
  reach the extension page.
- Access tokens refresh in the background ten minutes before expiry. Each refresh
  runs inside the atomic Secret update so concurrent extension-host processes
  never race on the same refresh token, and the Secret notification propagates
  the new token to the MCP contribution. If a refresh response returns a new
  non-empty `refresh_token`, it is stored; if omitted, the existing refresh token
  is retained. A rejected refresh grant (HTTP 401 or HTTP 400 with
  `invalid_grant`) retires the credential; transient failures keep it and retry
  with bounded backoff.
- Disconnecting deletes the local credential under the atomic Secret lock first,
  then attempts RFC 7009 revocation for both the refresh and access tokens at
  `https://mcp.linear.app/token`. Revocation failures are logged without
  restoring the credential.

## Build and Test

Run `pnpm --filter @spiritagent/linear build` and
`pnpm --filter @spiritagent/linear test` from the repository root. Build first:
artifact tests also load the real output, not just source modules.

`dist/extension` is the self-contained artifact assembled into the built-in
marketplace by `@spiritagent/extensions`. It includes this README, the MIT
license, and the padded Linear symbol icon.

Tests inject the token transport and play the browser against the real loopback
listener; they do not require a Linear account.

## License

MIT — see [LICENSE](LICENSE). The Linear symbol identifies the integration and is
used unmodified, as published at https://linear.app/brand; **Spirit** is the
extension author, not the owner of Linear. Linear and the Linear logo are
trademarks of Linear Orbit, Inc.
