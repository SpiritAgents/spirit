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

| Method                                  | Kind         | Purpose                                                                                                                                                                              |
| --------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.create`                        | request      | Create a session (`workspaceRoot`, optional `approvalLevel`); the daemon resolves the model transport from shared config + OS keyring                                                |
| `session.list`                          | request      | Live sessions in this daemon (id, workspace, host kind, busy, approval level)                                                                                                        |
| `session.close`                         | request      | Abort + drop a session                                                                                                                                                               |
| `session.submitUserTurn`                | request      | Start a user turn (`{ accepted: true }` or `{ queued: true }` when busy; the queue drains on idle)                                                                                   |
| `session.startImplementing`             | request      | Switch to Agent mode and submit the core-owned approval prompt for the recorded plan; rejects busy sessions or pending input. Optional `clientTurnId` links the caller's UI message. |
| `session.abort`                         | request      | Abort the current turn                                                                                                                                                               |
| `session.abortShell`                    | request      | Abort a running shell process by tool call id                                                                                                                                        |
| `session.setApprovalLevel`              | request      | `default` / `auto-approval` / `bypass-approval`                                                                                                                                      |
| `session.setMode`                       | request      | Switch agent mode: `agent` / `plan` / `ask` / `debug`                                                                                                                                |
| `session.setLoopEnabled`                | request      | Toggle loop mode                                                                                                                                                                     |
| `session.reset`                         | request      | Abort + clear history                                                                                                                                                                |
| `session.rename`                        | request      | Set a display title (live sessions only)                                                                                                                                             |
| `session.continueAssistantCompletion`   | request      | Continue completion from the history tail                                                                                                                                            |
| `session.compactHistory`                | request      | Run manual history compaction                                                                                                                                                        |
| `session.poll`                          | request      | Pull the current session projection (watchdog / headless clients)                                                                                                                    |
| `session.replyPendingApproval`          | request      | Answer a pending tool approval (`{ kind: 'allow' \| 'deny', … }`)                                                                                                                    |
| `session.replyPendingQuestions`         | request      | Answer a pending structured questionnaire                                                                                                                                            |
| `session.replyWorkspaceCapabilityTrust` | request      | Answer a workspace trust prompt (`allowOnce` / `deny` / `alwaysTrust`; first reply wins)                                                                                             |
| `session.runSessionStart`               | request      | Run the daemon-owned session start hook                                                                                                                                              |
| `session.runSessionEnd`                 | request      | Run the daemon-owned session end hook                                                                                                                                                |
| `runtime.event`                         | notification | One raw agent-core `RuntimeEvent` (`assistant-chunk`, `tool-call-started`, `approval-requested`, …) tagged with `sessionId`; broadcast to every connected client                     |
| `session.userTurnSubmitted`             | notification | Shared user-turn boundary, including a client turn id for origin-client deduplication                                                                                                |
| `session.turnFinished`                  | notification | Terminal state of a turn: `completed` / `failed` / `cancelled`                                                                                                                       |
| `session.snapshot`                      | notification | Session projection pushed at interaction boundaries (approval/questions/turn end)                                                                                                    |
| `session.titleUpdated`                  | notification | LLM-generated display title after the first user turn                                                                                                                                |
| `workspace.trustRequested`              | notification | Hooks ask for workspace capability trust; reply with `session.replyWorkspaceCapabilityTrust`                                                                                         |

Notes for client authors:

- Events are **pushed**, not polled; each session runs a 25ms pump inside the daemon (the Desktop session-pump model) that drives `runtime.poll()` and harvests terminal results, so turns survive transient idle windows inside the turn machine (e.g. the await boundary while an approval resolves).
- `update-pending-assistant-thinking` carries the full accumulated thinking text (same contract as the legacy host bridge) — clients that want deltas must diff locally.
- `session.list` covers **live** sessions only. `session.create` reports `restoredFromDisk` when the daemon recovered persisted runtime history; clients must not overwrite that history with an older local archive. Uninitialized sessions still accept the client's archive.
- Multi-client: every connected client receives every session's events; filter by `sessionId`. When the **last** client disconnects, pending approvals are denied and pending questions skipped so no runtime parks forever.
- Approval and question payloads carry a stable `requestId`. Reply RPCs, including manual-command approval continuations, require the ID from the displayed request, including notification actions and retained forms. IDs route to the owning child even when several children have pending input with the same tool call ID; replayed, replaced, or cancelled requests are rejected instead of consuming another request. Disconnected hosts also settle subsequent child inputs until a client attaches again.

### Background tasks and session lifetime

Shell and Subagent tasks are owned by the session, not its current foreground turn. `session.abort` cancels foreground work; already-backgrounded tasks continue. `session.detach` removes an observer without closing the session. Explicit `session.close`, `session.reset`, and daemon shutdown stop owned work. Model changes replace foreground bindings while running children retain their original model, mode, and workspace services.

Tools may start from streaming previews, but their results are committed only after the assistant tool calls are recorded. A failed stream cancels foreground continuations instead of resuming from an orphan result; already-backgrounded tasks retain their session lifetime.

Notification persistence settles before ownership is released or history is replaced. Cancelling during notification preparation prevents a subsequent model request, and a stopping parent rejects late child-task launches.

The daemon serializes foreground entry points and polls task state independently. A completed background task is delivered once at a safe tool boundary, or starts one continuation when the foreground is idle. Snapshots include `backgroundTasks` and `backgroundTaskNotifications`; runtime events distinguish task changes, terminal notifications, and persistence errors.

Runtime history and Desktop timeline snapshots are persisted alongside task records. A stable internal storage identity keeps transcript and live-output paths unchanged when a provisional conversation acquires its permanent chat path. External conversation paths are lookup keys in `session-storage-index`, not directories to move.

`runtime.event` and `session.userTurnSubmitted` include a monotonic `presentationSequence`. The archive also contains a presentation journal after the latest acknowledged Desktop snapshot. This journal retains public responses independently of model-history compaction; streaming task logs remain in their output files instead of being copied into it. Desktop checkpoints only fully projected, idle boundaries with `session.pushDesktopTimeline({ timeline, presentationSequence })`. Acknowledgment and the matching timeline are persisted together, and stale or invalid cursors are rejected. Reconnecting clients replay the remaining entries in order and discard overlapping live events by sequence without invoking the model.

New sessions start with an empty UI baseline. Desktop and CLI include `desktopMessageTimeline`
when importing an archive, so baseline and model history change atomically; replay replaces the
client's partial local projection instead of appending duplicates. This also lets CLI-only
sessions recover pre-compaction replies from the journal before any Desktop checkpoint exists.

Task completion rows retain their task ID, terminal event ID, source, output preview, and file reference as structured metadata. Shell output stays inspectable after interruption, and Subagent rows retain the original child-session navigation target. Missing output files are reported explicitly.

`tool-execution-ui-updated` publishes the host's delay start time, optional deadline, and resolved task kind before waiting. The final tool result carries the actual elapsed time; cancellation preserves the measured time as well. Desktop renders non-expandable delay cards with localized countdowns, switches to actual elapsed duration at completion, and shows no unbounded counter for task-only waits. Digit and unit transitions respect reduced motion.

Restarting a daemon never resumes old processes or invokes the model automatically. It verifies the previous host's unique local IPC identity and records interrupted tasks using their last persisted elapsed time. Worktree children rebuild workspace-bound instructions, Git information, tools, MCP, LSP, and hooks from the isolated checkout; started worktrees and branches are retained.

## Remote access

Remote access is **off by default**: the daemon binds loopback and requires the home-level token. Passing `--hostname 0.0.0.0` exposes the LAN and is reserved for a future phase with explicit pairing; do not rely on it yet.

## Relationship to acp-server

`@spiritagent/acp-server` stays a separate stdio/ndJSON adapter for ACP editors. Spirit Server is the native hub for first-party clients; the two share `@spiritagent/agent-core` + `@spiritagent/host-internal` but no transport code.

## Requirements

- Node.js 26.13.0

## Related packages

- [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core) — agent runtime and tool contracts.
- [`@spiritagent/host-internal`](https://www.npmjs.com/package/@spiritagent/host-internal) — local tool execution and discovery.
- [`@spiritagent/acp-server`](https://www.npmjs.com/package/@spiritagent/acp-server) — ACP adapter for external editors.

## License

MIT — see the [Spirit repository](https://github.com/SpiritAgents/spirit).
