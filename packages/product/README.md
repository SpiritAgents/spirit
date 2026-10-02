# Product

`product.json` at the repository root is the only editable source of product
identity. Build scripts validate it using this package's schema and generate
static JavaScript, TypeScript declarations, and Rust code from the same result.
The runtime export has no dependencies, filesystem access, or environment lookup.

`SPIRIT_PRODUCT_QUALITY=stable|dev` selects the build; the default is `stable`.
Development entry points explicitly select `dev`. Release version channels do
not select product quality. Changing an environment variable after a build
does not change its product.

```sh
pnpm exec turbo run build --filter=@spiritagent/product
SPIRIT_PRODUCT_QUALITY=dev pnpm exec turbo run build --filter=@spiritagent/server
```

Cargo invokes the same generator during a native build. For cross containers
without Node, generate first on the build host and pass
`SPIRIT_PRODUCT_ARTIFACT_DIR` pointing to that output. Cargo verifies the quality,
source-input fingerprint, and Rust artifact hash before including it. Relative
artifact directories resolve from the repository root. `Cross.toml` forwards
both product environment variables into cross containers. Desktop release jobs
use native Linux ARM runners for their C++ native modules.

Consumers import `product` and `PRODUCT_BUILD_ID` from `@spiritagent/product`.
Hosts own path resolution; this package only supplies directory names.
Generated files under `dist/` are not editable sources.

Daemon health includes the baked build identity. Clients reject missing or
different identities before using daemon capabilities; discovery does not
silently spawn a replacement after a product mismatch.

Desktop packaging loads `apps/desktop/electron-builder.config.mjs` over its
platform-only YAML settings. Both the packaged app and the development app
bundle declare the baked URL scheme. CLI packaging deploys the complete server
production dependency graph rather than copying selected workspace packages.
For offline packaging, pass `--node-runtime-dir <distribution>` and
`--node-version <version>` to `scripts/release/bundle-cli.mjs`, together with
`--offline`. `--binary` and `--output-dir` select controlled local inputs and
outputs. `--ignore-scripts` is available when the target's native binaries
already ship prebuilt; it must not replace building missing native modules.
Publishing jobs consume the validated product artifact without installing
dependencies in the credential-bearing publishing job.

Site documentation and bundled resources keep a single source at their original
`.mdx`, `.md`, or `.json` path. `pnpm product:content` renders Site content into
`apps/site/.generated/product/docs` and bundled resources into
`packages/host-internal/dist/resources/built-in`. These outputs are ignored by
Git; Site compilation and host packaging consume only the rendered resources.
The Site development command watches the documentation sources and regenerates
changed content.

Documents read directly on GitHub (READMEs, contribution, privacy, and security
guidance) are maintained directly as Markdown, without duplicate templates.
They intentionally retain literal product names and links and are not rewritten
when product identity changes. `pnpm product:content:check` checks only generated
Site and bundled resources. Neither command reads or validates the separately
generated Site installers.

Templates use explicit `{{product.name}}`, `{{product.websiteOrigin}}`, and
other field references. `product.stable` and `product.dev` references describe
both builds in the same document. Optional `html`, `mdx`, `json`, and `host`
filters adapt values to their output context. Quote frontmatter placeholders
as YAML strings; the generator resolves their values structurally before MDX
compilation, so rendered pages and processed Markdown receive the same text.
Generation does not add banners or reformat unrelated content.

## Verification and Scope

`pnpm product:verify` uses controlled directories under the checkout's `tmp/`,
not existing user data. It runs Schema/codegen tests, native Rust value probes,
non-installer template checks, a source-literal audit, release URL checks, and
two-quality integration tests. Build server dependencies and Desktop TypeScript
first; the runner does not install dependencies or rebuild native modules.
The daemon tests bind loopback only. External network restrictions should also
be enforced by the execution environment rather than relying on package-manager
offline flags alone.

The integration test runs both the repository manifest and a changed manifest
with independent origins, directory names, and protocols. Real host consumers
load generated product modules in isolated processes. It verifies user roots,
workspace rules/skills/MCP/hooks/tasks, daemon registry/token separation,
cross-quality rejection, Electron private paths, and persistence/reload of
config, chats, transcripts, rewind, TODOs, extension settings, marketplaces,
automations, and dreams. Old platform roots contain decoys; filesystem probes
count attempted reads and writes, including attempts swallowed by a consumer.
No credential lookup, model request, hook command, or automation is executed.

The source audit intentionally retains external technical identities:
repository and package names, executables, environment variables, app/bundle
identifiers, Keyring service/account names, commit attribution, CSS/IPC/storage
keys, and logo assets. Historical examples, test fixtures, comments, and
generated documents are not additional editable product sources. Package
descriptions are product-neutral; packaged Desktop metadata uses the product.

The implementation was also exercised from a fresh local source export with
offline dependency restoration and no pre-existing build outputs: server,
ACP, Site, CLI, and Desktop renderer/TypeScript built successfully. A changed
root manifest propagated to thirty production Site HTML pages/client chunks,
Desktop renderer/package metadata, and a real CLI/daemon startup. The existing
CLI staging tree ran with source dependency fallback blocked and reconnected
to the same daemon. macOS ARM64 Desktop directory layout was checked using
the installed Electron distribution and an existing icon.

**Not verified locally:** other native platforms/architectures, cross containers,
remote CI/publication, signing/notarization, OS protocol registration, and the
complete Desktop native-rebuild/ASAR path. Installer verification was explicitly
excluded. Archive extraction testing was also excluded; after that restriction,
no archive command was used. Directory-layout checks do not certify archives.

The default-root change contains no automatic old-data discovery, migration,
fallback, or dual write. Any explicitly authorized personal copy is a separate
operation, not application behavior. Electron private data and OS credentials
are not claimed to be quality-isolated.
