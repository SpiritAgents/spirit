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
source-input fingerprint, and Rust artifact hash before including it.

Consumers import `product` and `PRODUCT_BUILD_ID` from `@spiritagent/product`.
Hosts own path resolution; this package only supplies directory names.
Generated files under `dist/` are not editable sources.

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
