---
applyTo: "**/*"
---

# Spirit Capability And Host Boundaries

## Purpose

Spirit has one Agent capability library and a set of focused TypeScript host
domain packages. Desktop, CLI, Web, and ACP must compose those implementations
instead of maintaining parallel domain behavior.

The shared behavior baseline is the TypeScript implementation used by Desktop.
Rust retains command parsing, terminal presentation and interaction, signal
handling, and daemon process startup. Platform-specific native behavior stays
in the corresponding platform adapter.

## Agent Core

`packages/agent-core` is the only package allowed to own model semantics:

- System prompts and the assembly of Rules, Skills, Agent modes, Extensions,
  Dreams, and basic-info sections
- Full text for an explicitly activated Skill in the `<active_skill>` user
  message meta
- Built-in tool names, descriptions, JSON Schemas, and model-visible output
  semantics
- MCP protocol handling and MCP tool, resource, and prompt semantics
- Agent runtime, turn orchestration, streaming, tool rounds, and transports
- Provider tool and file-upload declarations
- The write-time materialization zone: `provider-presets`, `model-catalog`,
  and `model-knowledge`

It does not scan workspaces or user directories, access keyrings, persist Host
metadata, execute local tools, or contain Electron, React, TUI, or CLI forms.

Provider presets and model knowledge are consumed when configuration or a
catalog is written. Runtime request paths are declaration-driven: they must
not branch on provider or vendor identity.

## Host Domain Packages

| Package           | Ownership                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `api`             | Runtime-neutral DTOs, Host commands, events, snapshots, tool payloads, approval and work-location contracts                               |
| `config`          | `config.json` schema, atomic I/O and locking, data paths, Provider/Model management, catalog cache, credentials, and transport resolution |
| `i18n`            | Canonical locale resources, language matching, Host translations, and generated CLI resources                                             |
| `github`          | OAuth, credential storage, API/GraphQL, pull requests, repository operations, and polling                                                 |
| `lsp`             | Language-server processes, workspace caches, diagnostics, and lifecycle                                                                   |
| `code-completion` | Completion services, context, edit journal, apply/validate, and browser-safe Monaco adapters                                              |
| `instructions`    | Rules, Skills, and Plans: discovery, parsing, ordering, activation, state, and contributed instruction data                               |
| `tasks`           | Task discovery, schema, merging, variables, trust, execution, and task process pools                                                      |
| `mcp`             | File-backed MCP configuration, CRUD, and workspace service registries                                                                     |
| `hooks`           | Hook configuration, workspace capability trust, matching, execution, and output handling                                                  |
| `permissions`     | Permission rules, shell and path analysis, approval interpretation, and file approval previews                                            |
| `process`         | Shell selection, subprocess execution, supervision, environment, and exit behavior                                                        |
| `tools`           | Built-in tool parsing, authorization, execution, search, web fetch, output archives, and generated-resource support                       |
| `workspace`       | Git, worktrees, files, references, ignore handling, media, apply-diff, and rewind file restoration                                        |
| `sessions`        | Runtime and Workbench session persistence, transcripts, leases, background tasks, TODOs, fork/rewind, and event projection                |
| `automations`     | Automation and Dream definitions, persistence, scheduling, retention, progress, and logs                                                  |
| `extensions`      | Extension installation, marketplace, process/UI runtime, and contribution collection                                                      |

Domain packages implement Host contracts; they do not redefine model-visible
contracts from `agent-core`.

### Dependency Rules

- `sessions` receives its daemon connector through injection. It does not
  import the server client.
- `tools` receives TODO and Dream stores through narrow ports. Output archives
  stay in `tools`, preventing a session/tool cycle.
- `instructions`, `mcp`, and `hooks` receive extension contributions as data.
  They do not import `extensions`.
- `mcp` calls `agent-core` for protocol behavior. It does not implement a
  second MCP stack.
- `extensions` collects contributions but does not own Tasks, Rules, Skills,
  MCP configuration, or Hooks.
- `server` must not import `workbench`, `http`, or `web`.
- Domain Node entry points must not import Electron or React. React is limited
  to declared browser presentation entry points such as `sessions/src/lib`
  and the extension UI kit.
- Do not import a package through its own package name from inside that
  package. Use direct relative modules so package-root exports cannot create
  initialization cycles.

Run `node scripts/check-domain-boundaries.mjs` after changing package imports
or manifests. The domain dependency graph must remain acyclic.

## Composition And Clients

### Server

`packages/server` is the single Agent Runtime daemon. It owns live sessions,
turns, approvals, client authentication, WebSocket/JSON-RPC transport, and the
instance registry. It composes domain services for local typed RPC clients.

Daemon RPC names and HTTP command names are compatibility contracts. Domain
errors use `DomainError { code, params?, message }`; JSON-RPC carries the stable
domain error in `error.data.domainError`. Unknown system errors remain system
errors.

### Workbench, HTTP, And Web

- `packages/workbench` is the Workbench composition root. It creates and
  connects domain services; it is not a second Agent Runtime.
- `packages/http` provides HTTP, authentication, NDJSON, static SPA, and
  connection lifecycle adapters without owning product state.
- `packages/web` is the shared renderer and static application. It uses `api`
  and explicitly approved browser-safe domain subpaths. Node builtins,
  keyrings, filesystem services, and process execution must not enter the
  renderer bundle.

### Desktop

`apps/desktop` is an Electron native shell: windows, preload, menus,
notifications, PTY, native files, and platform adapters. It consumes the same
Workbench and Web implementations as the standalone Host.

### Rust CLI

`apps/cli` is a daemon client and terminal frontend. It must use typed RPC for
Provider/Model configuration, MCP writes, Skill activation, stored sessions,
fork/rewind, and other shared domain behavior. Do not add Rust business-logic
fallbacks or direct Node helper implementations when the daemon is
unavailable: retain automatic discovery/startup and report startup failure.

CLI-only interaction, display projection, argument precedence, and daemon
startup remain Rust responsibilities.

### ACP

`packages/acp-server` is a separate stdio/ndJSON adapter. It shares Agent Core
and Host domain implementations with the daemon without sharing transport
code.

## Configuration, Secrets, And Localization

`config.json` remains the only user configuration document. Writers merge
their owned section into the latest locked document and preserve unknown
sections. Credentials keep the existing keyring account and access-group
formats. Secrets must not enter snapshots, broadcasts, logs, or domain-error
parameters.

`packages/i18n` owns canonical translations. CLI YAML is generated at build
time into an ignored target directory; do not create a second hand-maintained
locale tree. Model-visible prompts and tool output are not localized.

## Change Rules

1. Put new behavior in its named domain package, not in an app or an unrelated
   convenience barrel.
2. Keep model-visible semantics in `agent-core`; changing substantial prompt
   or tool behavior requires the eval process in `AGENTS.md`.
3. Share cross-platform behavior through TypeScript domain services and typed
   daemon RPC. Keep only genuinely platform-specific behavior in adapters.
4. Preserve existing configuration, chat schema v2, credential, RPC, and HTTP
   formats unless a change explicitly targets them.
5. Add focused contract tests for the owning domain and client adapter. Run
   boundary checks, relevant builds/tests, and `cargo test -p spirit` when the
   CLI contract changes.
