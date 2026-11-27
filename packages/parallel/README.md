# Parallel for Spirit

A native, built-in Spirit Extension for Desktop. The `@spiritagent/parallel` source
package connects Spirit to Parallel's official MCP server at `https://mcp.parallel.ai/mcp`
and owns its optional OAuth authorization. Extension version: **1.0.0**. Author: **Spirit**.
Website: **spirit.dev**. Contact: **hi@spirit.dev**.

## Architecture

- The extension contributes a single HTTP MCP server. It has no tabs, link handlers, or
  Automation triggers; Parallel tools reach the agent through the MCP contribution.
- `mcp.json` declares `Authorization` using the optional extension secret syntax
  `${extension-secret?:oauthCredentials:accessToken}`. Fresh installs connect keyless
  automatically with no `Authorization` header; authorizing stores the credential in
  `oauthCredentials` and upgrades MCP requests to Bearer authentication automatically,
  while disconnecting falls back cleanly to keyless access.
- Authorization uses the OAuth 2.0 authorization code flow with PKCE S256. The client
  identifies itself with Spirit's Client ID Metadata Document,
  `https://spirit.dev/oauth/client-metadata.json`, published by `apps/site`. That
  URL is the extension author's identity; it is not a host capability offered to
  other extensions.
- The extension backend receives the authorization response itself on an
  ephemeral `127.0.0.1` port, registered portless as `http://127.0.0.1/callback`.
  Unrelated requests whose `state` does not match are rejected without ending the
  wait. Once a response carries the pending `state`, its RFC 9207 `iss` parameter
  must equal `https://platform.parallel.ai/getServiceKeys`; a missing, duplicate,
  or mismatched issuer rejects the callback with HTTP 400 and fails the
  authorization attempt. The listener closes on completion, issuer mismatch,
  denial, cancellation, extension disposal, or a ten-minute timeout.
- Requests use the `*` scope and the `https://mcp.parallel.ai/mcp?login`
  resource indicator. The access token, refresh token, expiry timestamp, and
  scheduled refresh timestamp are committed together in the declared
  `oauthCredentials` Secret slot and never reach the extension page.
- Parallel access tokens are short-lived (10 minutes) and rotate refresh tokens
  on every refresh. Instead of a fixed refresh lead window, the extension computes
  a proportional lead (`min(2 minutes, floor(ttl * 0.2))`, i.e., 2 minutes before
  expiry for a 10-minute token) and stores `accessTokenRefreshAt` alongside
  `accessTokenExpiresAt`. Each refresh runs inside the atomic Secret update so
  concurrent extension-host processes never spend the same rotating refresh token,
  and the Secret notification propagates the new token to the MCP contribution. If
  a refresh response returns a new non-empty `refresh_token`, it is stored; if
  omitted, the existing refresh token is retained. A rejected refresh grant
  (HTTP 401 or HTTP 400 with `invalid_grant`) retires the credential; non-401
  refresh failures keep `refreshToken` for bounded background retries, strip an
  already-expired `accessToken` so the optional MCP Bearer header falls back to
  keyless access instead of sending a dead token, and still open the authorize
  dialog with Disconnect so the user can recover without removing the extension.
- Disconnecting deletes the local credential under the atomic Secret lock first,
  then sends a best-effort `application/x-www-form-urlencoded` POST to
  `https://platform.parallel.ai/getServiceKeys/token/revoke` with
  `refresh_token=<refreshToken>`. Revocation failures are logged without
  restoring the local credential.

## Build and Test

Run `pnpm --filter @spiritagent/parallel build` and
`pnpm --filter @spiritagent/parallel test` from the repository root. Build first:
artifact tests also load the real output, not just source modules.

`dist/extension` is the self-contained artifact assembled into the built-in
marketplace by `@spiritagent/extensions`. It includes this README, the MIT
license, and the temporary text icon.

Tests inject the token transport and play the browser against the real loopback
listener; they do not require a Parallel account.

## License

MIT — see [LICENSE](LICENSE). **Spirit** is the extension author, not the owner
of Parallel. The current icon is a temporary text placeholder and will be
replaced once written brand permission is granted.
