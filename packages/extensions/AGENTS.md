# Spirit Extensions Guidelines

`@spiritagent/extensions` owns extension installation, marketplaces, lifecycle, runtime integration, and contribution collection. Domain semantics stay with their owning packages, such as Rules, Skills, MCP, Hooks, and Tasks; this package connects extensions to those systems rather than reimplementing them. Reusable authoring and registry schema tooling belongs to `@spiritagent/extension-toolkit`.

Extensions are plug-and-play, independent, production-quality TypeScript projects. They should own their implementation, tests, README, assets, and other package-local concerns, and must not require extension-specific host branches to install or run. `@spiritagent/github` is the reference built-in extension, not privileged host code.

The extension system is early and should evolve directly. Breaking changes to protocols, manifests, schemas, and persistence are welcome when they produce a cleaner design. Do not add compatibility layers or conservative workarounds merely to preserve older extension formats; migrate the tree and built-in extensions instead. Approach extension-system requests boldly and from first principles.
