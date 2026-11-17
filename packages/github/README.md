# GitHub for Spirit

A native, built-in Spirit Extension for Desktop. The single `@spiritagent/github`
source package owns authorization, REST/GraphQL clients, pull request pages, and
repository Automation triggers. Extension version: **1.0.0**. Author: **Spirit**.
Website: **spirit.dev**. Contact: **hi@spirit.dev**.

## Architecture

- The extension backend runs in the extension host and uses Node `fetch`. It does
  not depend on Electron transport, its system proxy/certificate integration, or
  GitHub-specific host commands.
- Authorization uses OAuth Device Flow. The OAuth App identifier is intentionally
  unconfigured; production authorization reports that explicitly until an app is
  supplied. Credentials and account identity are committed together in the
  declared `oauthCredentials` Secret slot, never sent to extension pages.
- Native React pages use Spirit UI, Icons, the canonical translations, and the
  shared Markdown/diff renderer. They communicate through the sandboxed extension
  page API; source dependencies are bundled only when building the artifact.
- PR URL recognition, repository discovery, request cancellation, pagination,
  merge permissions, and Automation checkpoints belong to this package.
- Layout preferences use extension Settings. Disabling/removing the extension
  cancels its work. No legacy credential or configuration migration is performed.

## Build and Test

Run `pnpm --filter @spiritagent/github build` and
`pnpm --filter @spiritagent/github test` from the repository root. Build first:
artifact tests also load the real output, not just source modules.

`dist/extension` is the self-contained artifact assembled into the built-in
marketplace by `@spiritagent/extensions`. The registry entry is the authoritative
Spirit manifest; the artifact's `package.json` is ordinary package metadata.
The artifact includes its README, MIT license, and padded Octocat icon.

Tests inject transport through `createGitHubExtension`; they do not require a
GitHub account. Desktop acceptance uses offline API responses while exercising
real page loading, authorization controls, Secret persistence, and Composer
integration. No fixture or test transport is enabled in production builds.

## License

MIT — see [LICENSE](LICENSE). The GitHub mark identifies the integration;
**Spirit** is the extension author, not the owner of GitHub.
