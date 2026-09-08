---
name: create-extension
description: Author a Spirit extension — scaffold, declare capabilities, validate, and publish to a marketplace.
---

Create or update a Spirit extension from the user's request. An extension is a directory with a `.spirit/extension.json` manifest dump next to a pure-npm `package.json`, plus the capability files it declares.

The docs are the contract. When a field shape or API is unclear, fetch the reference instead of guessing:

- Extension reference (manifest, capabilities, `activate` API, validate, publish): https://spirit.fast/en-US/docs/develop/extensions.md
- Bundled MCP servers (`mcp.json`): https://spirit.fast/en-US/docs/customize/mcp.md
- Page index: https://spirit.fast/llms.txt

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
| `desktop-ui`                          | Desktop CSS and a settings page                                          |
| `cli-ui`                              | CLI TUI slot styling from a declarative hooks file                       |

Declaration-only capabilities (`approval-flow`, `questions-flow`, `settings`, `secret-storage`, `structured-results`) tune runtime behavior; see the reference.

For bundled resource formats, the sibling skills create-skill, create-hook, and create-rule carry the authoring conventions — write the files into the extension's own layout (`skills/<name>/SKILL.md`, extension-root `hooks.json` and `rule.md`), not the managed workspace or user roots.

## Workflow

1. Scaffold: `npx create @spiritagent/extension` (wizard; every prompt has a flag, `--yes` skips confirmation). Manual alternative: write `.spirit/extension.json`, `package.json`, and the declared capability files by hand per the reference.
2. Validate: `npx @spiritagent/extension-toolkit check <dir>` until clean — install runs the same validation.
3. Publish: `npx @spiritagent/extension-toolkit publish <dir> <marketplace-dir> [--source local|npm] [--dry-run]` merges the entry into a marketplace; `pack <dir>` builds a ZIP for import into a user's Personal marketplace. To self-test, publish into any local directory marketplace and add it with `spirit extension marketplace add <path>`.
4. Fallback: when a detail is missing or unclear, fetch the reference page; never invent manifest fields.
