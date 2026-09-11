---
name: create-extension
description: Author a Spirit extension — scaffold, declare capabilities, validate, and publish to a marketplace.
---

Create or update a Spirit extension from the user's request. An extension is a directory with a `.spirit/extension.json` manifest dump next to a pure-npm `package.json`, plus the capability files it declares.

The docs are the contract. When a field shape or API is unclear, fetch the reference instead of guessing:

- Extension reference (manifest, capabilities, `activate` API, validate, publish): https://spirit.dev/en-US/docs/develop/extensions.md
- Bundled MCP servers (`mcp.json`): https://spirit.dev/en-US/docs/customize/mcp.md
- Page index: https://spirit.dev/llms.txt

## Capabilities

Declare only what the extension uses; every declared file must exist and parse.

| Capability                            | Contribution                                                             |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `skills`                              | `skills/<name>/SKILL.md`                                                 |
| `rules`                               | package-root `rule.md`                                                   |
| `mcp`                                 | package-root `mcp.json`                                                  |
| `hooks`                               | package-root `hooks.json` (agent hooks)                                  |
| `tool-definitions` + `tool-execution` | model-callable tools declared in the manifest, implemented by `activate` |
| `system-prompt`                       | system prompt fragment from `activate`                                   |
| `desktop-ui`                          | Desktop CSS, a settings page, and precompiled single-file views          |
| `cli-ui`                              | CLI TUI slot styling from a declarative hooks file                       |

A bundled MCP server may send `spirit/ui/open` during `tools/call` for a view that same extension owns. CLI / headless hosts return `{ kind: "unavailable", reason: "host-has-no-ui" }`.

Declaration-only capabilities (`approval-flow`, `questions-flow`, `settings`, `secret-storage`, `structured-results`) tune runtime behavior; see the reference.

For bundled resource formats, the sibling skills create-skill, create-hook, and create-rule carry the authoring conventions — write the files into the extension's own layout (`skills/<name>/SKILL.md`, extension-root `hooks.json` and `rule.md`), not the managed workspace or user roots.

## Publish target

Unless the user names another marketplace, publish to the built-in Personal marketplace at `<spirit_data_dir>/marketplaces/personal` — if this skill is active from `<spirit_data_dir>/skills/create-extension/SKILL.md`, use that same `<spirit_data_dir>`. Local marketplaces are read in place, so the entry appears right away; after publishing, tell the user to install the extension from the **Extensions** page.

## Workflow

1. Scaffold: `npx create @spiritagent/extension` (wizard; every prompt has a flag, `--yes` skips confirmation). Manual alternative: write `.spirit/extension.json`, `package.json`, and the declared capability files by hand per the reference.
2. Validate: `npx @spiritagent/extension-toolkit check <dir>` until clean — install runs the same validation.
3. Publish: `npx @spiritagent/extension-toolkit publish <dir> <marketplace-dir> [--source local|npm] [--dry-run]` — the default marketplace is the Personal one above; use `pack <dir>` instead when the user wants a shareable ZIP file.
4. Fallback: when a detail is missing or unclear, fetch the reference page; never invent manifest fields.
