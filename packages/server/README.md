# @spiritagent/server

**Spirit Server** — the shared daemon backend for [Spirit](https://github.com/SpiritAgents/spirit). It owns the agent runtime, sessions, streaming, tool execution, and approvals; hosts (CLI, Desktop, Web) attach as thin WebSocket clients instead of embedding a runtime in-process.

## What it provides

- **Daemon lifecycle** — binds `127.0.0.1` on an OS-assigned random port by default; writes `{ port, pid, startedAt, version }` to an instance registry so clients can attach instead of spawning duplicates.
- **WebSocket + JSON-RPC 2.0** — one transport for requests, responses, and server-initiated streaming notifications. No third-party dependencies; the RFC 6455 layer is implemented in-package.
- **Bearer auth** — a home-level token at `{spiritDataDir}/server.token` (mode 0600). Accepted via `Authorization: Bearer …` or a `?token=` query parameter (for browser clients that cannot set headers). `rotate-token` applies to new handshakes without a restart.
- **Instance management** — `ps` lists live instances (stale pids pruned), `kill` SIGTERMs one or all.

## Quick start

```bash
pnpm run build
node dist/src/entry.js            # foreground daemon, random port
node dist/src/entry.js ps         # list instances
node dist/src/entry.js kill       # stop all instances
```

Or via the npm bin / Rust CLI wrapper:

```bash
spirit-server                     # same as `spirit-server serve`
spirit serve                      # Rust CLI spawns the same daemon
```

On startup the daemon logs the bound `ws://` URL, instance id, data dir, and token file path to **stderr**. The token itself is never printed — clients read it from the token file (same user, same home).

## Instance registry

Each daemon writes `{spiritDataDir}/server/instances/{instanceId}.json`:

```json
{
  "instanceId": "…",
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 51234,
  "startedAt": "2026-08-03T09:00:00.000Z",
  "version": "1.0.0-alpha.0"
}
```

Clients resolve a daemon by reading the registry, pruning records whose pid is dead, and attaching to a survivor — otherwise they spawn a new one. The registry lives in the shared Spirit data directory (Stable: `~/.spirit` · Dev: `~/.spirit-dev`; Windows: `%USERPROFILE%\.spirit` / `%USERPROFILE%\.spirit-dev`; override with `SPIRIT_DATA_DIR`).

## Protocol

After the upgrade handshake the server sends a `server.connected` notification (`protocolVersion`, `instanceId`, `version`).

**Server lifecycle**

| Method              | Kind         | Purpose                                                                                          |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `server.initialize` | request      | Client handshake: `clientKind` (`cli` / `desktop` / `web`), optional `clientId`, `workspaceRoot` |
| `server.health`     | request      | Liveness: pid, uptime, version, connection count                                                 |
| `server.connected`  | notification | First frame after a successful upgrade                                                           |

**Sessions and agent flow**

| Method                                  | Kind         | Purpose                                                                                                                                                          |
| --------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.create`                        | request      | Create a session (`workspaceRoot`, optional `approvalLevel`); the daemon resolves the model transport from shared config + OS keyring                            |
| `session.list`                          | request      | Live sessions in this daemon (id, workspace, host kind, busy, approval level)                                                                                    |
| `session.close`                         | request      | Abort + drop a session                                                                                                                                           |
| `session.submitUserTurn`                | request      | Start a user turn (`{ accepted: true }` or `{ queued: true }` when busy; the queue drains on idle)                                                               |
| `session.abort`                         | request      | Abort the current turn                                                                                                                                           |
| `session.abortShell`                    | request      | Abort a running shell process by tool call id                                                                                                                    |
| `session.setApprovalLevel`              | request      | `default` / `auto-approval` / `bypass-approval`                                                                                                                  |
| `session.setMode`                       | request      | Switch agent mode: `agent` / `plan` / `ask` / `debug`                                                                                                            |
| `session.setLoopEnabled`                | request      | Toggle loop mode                                                                                                                                                 |
| `session.reset`                         | request      | Abort + clear history                                                                                                                                            |
| `session.rename`                        | request      | Set a display title (live sessions only)                                                                                                                         |
| `session.continueAssistantCompletion`   | request      | Continue completion from the history tail                                                                                                                        |
| `session.compactHistory`                | request      | Run manual history compaction                                                                                                                                    |
| `session.poll`                          | request      | Pull the current session projection (watchdog / headless clients)                                                                                                |
| `session.replyPendingApproval`          | request      | Answer a pending tool approval (`{ kind: 'allow' \| 'deny', … }`)                                                                                                |
| `session.replyPendingQuestions`         | request      | Answer a pending structured questionnaire                                                                                                                        |
| `session.replyWorkspaceCapabilityTrust` | request      | Answer a workspace trust prompt (`allowOnce` / `deny` / `alwaysTrust`; first reply wins)                                                                         |
| `session.runSessionStart`               | request      | Run the daemon-owned session start hook                                                                                                                          |
| `session.runSessionEnd`                 | request      | Run the daemon-owned session end hook                                                                                                                            |
| `runtime.event`                         | notification | One raw agent-core `RuntimeEvent` (`assistant-chunk`, `tool-call-started`, `approval-requested`, …) tagged with `sessionId`; broadcast to every connected client |
| `session.userTurnSubmitted`             | notification | Shared user-turn boundary, including a client turn id for origin-client deduplication                                                                            |
| `session.turnFinished`                  | notification | Terminal state of a turn: `completed` / `failed` / `cancelled`                                                                                                   |
| `session.snapshot`                      | notification | Session projection pushed at interaction boundaries (approval/questions/turn end)                                                                                |
| `session.titleUpdated`                  | notification | LLM-generated display title after the first user turn                                                                                                            |
| `workspace.trustRequested`              | notification | Hooks ask for workspace capability trust; reply with `session.replyWorkspaceCapabilityTrust`                                                                     |

Notes for client authors:

- Events are **pushed**, not polled; each session runs a 25ms pump inside the daemon (the Desktop session-pump model) that drives `runtime.poll()` and harvests terminal results, so turns survive transient idle windows inside the turn machine (e.g. the await boundary while an approval resolves).
- `update-pending-assistant-thinking` carries the full accumulated thinking text (same contract as the legacy host bridge) — clients that want deltas must diff locally.
- `session.list` covers **live** sessions only. Desktop restores disk chats by creating a live daemon session and sending its archive; the daemon registry itself is not a disk-chat index.
- Multi-client: every connected client receives every session's events; filter by `sessionId`. When the **last** client disconnects, pending approvals are denied and pending questions skipped so no runtime parks forever.

## Remote access

Remote access is **off by default**: the daemon binds loopback and requires the home-level token. Passing `--hostname 0.0.0.0` exposes the LAN and is reserved for a future phase with explicit pairing; do not rely on it yet.

## Relationship to acp-server

`@spiritagent/acp-server` stays a separate stdio/ndJSON adapter for ACP editors. Spirit Server is the native hub for first-party clients; the two share `@spiritagent/agent-core` + `@spiritagent/host-internal` but no transport code.

## Requirements

- Node.js 24+

## Related packages

- [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core) — agent runtime and tool contracts.
- [`@spiritagent/host-internal`](https://www.npmjs.com/package/@spiritagent/host-internal) — local tool execution and discovery.
- [`@spiritagent/acp-server`](https://www.npmjs.com/package/@spiritagent/acp-server) — ACP adapter for external editors.

## License

MIT — see the [Spirit repository](https://github.com/SpiritAgents/spirit).
