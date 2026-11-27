# Exa for Spirit

A native, built-in Spirit Extension for Desktop. The `@spiritagent/exa` source
package connects Spirit to Exa's official MCP server at `https://mcp.exa.ai/mcp`
and owns its optional OAuth authorization. Extension version: **1.0.0**. Author:
**Spirit**. Website: **spirit.dev**. Contact: **hi@spirit.dev**.

## Architecture

- The extension contributes a single MCP server. It has no tabs, link handlers, or
  Automation triggers; Exa search and fetch tools reach the agent through the MCP
  contribution.
- `mcp.json` marks the `Authorization` header as an optional secret reference
  (`${extension-secret?:oauthCredentials:accessToken}`). Before authorization,
  the host omits the header so Exa connects keyless out of the box. Once
  authorized, the host attaches the Bearer token automatically; disconnecting
  returns to keyless mode without reinstalling the extension.
- Authorization uses the OAuth 2.0 authorization code flow with PKCE S256. The
  client identifies itself with Spirit's Client ID Metadata Document,
  `https://spirit.dev/oauth/client-metadata.json`, published by `apps/site`. That
  URL is the extension author's identity; it is not a host capability offered to
  other extensions. Exa shows the consent screen as Spirit by spirit.dev.
- The extension backend receives the authorization response itself on an
  ephemeral `127.0.0.1` port, registered portless as `http://127.0.0.1/callback`.
  Unrelated requests whose `state` does not match are rejected without ending the
  wait. Exa does not advertise RFC 9207 `authorization_response_iss_parameter_supported`,
  so an omitted `iss` parameter is accepted; when `iss` is present, it must equal
  `https://auth.exa.ai` or the callback is rejected with HTTP 400 and fails the
  authorization attempt. The listener closes on completion, issuer mismatch,
  denial, cancellation, extension disposal, or a ten-minute timeout.
- Requests use the `mcp:tools` scope and the `https://mcp.exa.ai/mcp` resource
  indicator. The access token, refresh token, access token expiry, and bounded
  refresh lead window are committed together in the declared `oauthCredentials`
  Secret slot and never reach the extension page.
- Access tokens refresh in the background ahead of expiry using a bounded lead
  window (capped at ten minutes and scaled to one-fifth of `expires_in` so
  short-lived tokens never loop immediately). Each refresh runs inside the atomic
  Secret update so concurrent extension-host processes never race on the same
  refresh token, and the Secret notification propagates the new token to the MCP
  contribution. If a refresh response returns a new non-empty `refresh_token`, it
  is stored; if omitted, the existing refresh token is retained. A rejected
  refresh grant (HTTP 401 or HTTP 400 with `invalid_grant`) retires the
  credential; transient failures keep it and retry with bounded backoff.
- Disconnecting deletes the local credential under the atomic Secret lock first,
  then attempts RFC 7009 revocation for both the refresh and access tokens at
  `https://auth.exa.ai/api/oauth/revoke`. Revocation failures are logged without
  restoring the credential.

## Build and Test

Run `pnpm --filter @spiritagent/exa build` and
`pnpm --filter @spiritagent/exa test` from the repository root. Build first:
artifact tests also load the real output, not just source modules.

`dist/extension` is the self-contained artifact assembled into the built-in
marketplace by `@spiritagent/extensions`. It includes this README, the MIT
license, and the padded Exa logomark icon.

Tests inject the token transport and play the browser against the real loopback
listener; they do not require an Exa account.

## License

MIT — see [LICENSE](LICENSE). The Exa logomark identifies the integration and is used unmodified, as published at https://exa.ai/brand; **Spirit** is the extension author, not the owner of Exa. Exa and the Exa logo are trademarks of Exa Labs, Inc.
