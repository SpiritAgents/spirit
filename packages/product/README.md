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
