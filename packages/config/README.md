# @spiritagent/config

Canonical Spirit configuration schema and storage. The package provides v1
Provider/Model validation, atomic JSON writes, the cross-process write lock,
and generic section updates for domain packages.

Domain sections remain owned and normalized by their respective packages.

## macOS Keychain Sharing

Signed Desktop, CLI, and private bundled Node runtimes share Spirit-owned credentials through the
`TEAM_ID.dev.spirit.shared` Keychain Access Group. Each runtime reads the group from its own code
signature; unsigned development processes and external keyring services keep the legacy behavior.
The release pipeline adds the entitlement only to Spirit's executable and private Node runtime.

No startup or read-time migration is performed, and legacy items are left untouched. Unsigned
development processes continue to read them through the existing platform keyring path, while
signed production processes read only the shared group.

## License

MIT — see [LICENSE](LICENSE).
