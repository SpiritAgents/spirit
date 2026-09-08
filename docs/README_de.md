<div align="center">

# Spirit

Ein Open-Source-KI-Agent, der Ihre Produktivität vervielfacht.

[Desktop-App](#desktop) · [Site](#site) · [CLI](#cli) · [Server](#server) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [Entwicklung](#entwicklung)

> Dieses Projekt befindet sich in aktiver Entwicklung. Verhalten und APIs können sich zwischen Releases ändern.

[English](../README.md)

<img width="1552" height="1032" alt="Spirit Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

</div>

## Überblick

Spirit ist ein **werkzeugnutzender Coding-Agent**, der gegen eine echte Projektwurzel arbeitet. Dieselbe Runtime treibt einen nativen Desktop-Workspace und eine Terminal-UI an. Gemeinsame Logik liegt in TypeScript-Paketen; Hosts fügen plattformspezifische Ausführung, Discovery und UI hinzu.

```
┌───────────────────────────────────────────────────────┐
│  Hosts                                                │
│     ┌────────────────────────┐ ┌────────────────┐     │
│     │   Desktop       CLI    │ │   ACP Server   │     │
│     │  (Electron)    (Rust)  │ │ stdio / ndJSON │     │
│     └──────┬────────────┬────┘ └────────┬───────┘     │
│            └────────────┘               │             │
│                  ▼                      │             │
│           packages/server               │             │
│    sessions, streaming, approvals       │             │
│                  │                      │             │
│                  ▼                      │             │
│        packages/host-internal           │             │
│     discovery, tools, workspace  ◀──────┘             │
│                  │                                    │
│                  ▼                                    │
│         packages/agent-core                           │
│   runtime, prompts, tool contracts                    │
└───────────────────────────────────────────────────────┘
```

## Agent Core

[`packages/agent-core`](../packages/agent-core) ist die **einzige Quelle der Agent-Semantik** in diesem Repository. Hosts konsumieren sie.

### Runtime und Modi

- **Turn machine** — Streaming-Ausgabe, Tool-Runden, Kompaktierung und Kontextnutzungs-Tracking.
- **Agent / Plan / Ask / Debug-Modi** — voller Toolzugriff, reine Planungs-Workflows, schreibgeschütztes Q&A ohne Edit-Tools auf Vertragsebene oder strukturiertes Debugging mit Log-Point-Hypothesen.
- **Subagents** — `subagent` delegiert fokussierte Arbeit an Kindläufe mit eigener Tool-Oberfläche.
- **Schleifensteuerung** — optionales `finish_task` bei aktiviertem Multitask-Loop.
- **Rewind-freundliche Historie** — Nachrichtenarchive für Host-seitiges Rollback und erneutes Senden.

### Modell-Transports

Agent Core leitet Inferenz über mehrere Transports hinter einer Runtime:

| Transport             | Typische Anbieter                                                             |
| --------------------- | ----------------------------------------------------------------------------- |
| **OpenAI-compatible** | OpenAI, DeepSeek, Moonshot, MiniMax, Volcengine, benutzerdefinierte Endpunkte |
| **Open Responses**    | OpenAI, SpaceXAI, Vercel AI Gateway, OpenRouter, Alibaba (Bailian)            |
| **Anthropic**         | Claude über Messages API                                                      |

Anbieter-native Fähigkeiten (z. B. Websuche bei Open Responses, Alibaba-Suche und Code-Interpreter) werden über das `tools`-Feld injiziert.

### Host-Tool-Verträge

Eingebaute Tools werden einmal in Agent Core definiert (Name, Beschreibung, JSON Schema). Hosts führen aus:

- **Workspace** — `read_file`, `write_file` / `create_file` / `edit_file` / `delete_file`, `apply_patch` (V4A auf unterstützten Transports), `glob`, `grep`, `ls`
- **Shell** — `shell` mit hostgesteuerter Freigabe
- **Web** — `web_fetch`; Suche über Anbieter-Tools oder konfigurierte Host-Suche
- **Delegation** — `subagent`
- **Planning** — `create_plan`, Session-TODO-Tools (`todo_list`, `todo_write`)
- **Multimodal** — `generate_image`, `generate_video`
- **Dreams** — `dream_list`, `dream_read`, `dream_record`, `dream_update`, `dream_delete` für Workspace-Gedächtniszusammenfassungen
- **LSP** — Language-Server-Diagnosen nach Bearbeitungen

### Systemkontext-Assembly

Agent Core bestimmt, wie das Modell den Projektkontext sieht:

- **Rules** — `AGENTS.md`, `.spirit/rule.md` und Benutzerregel-Slots in Systemabschnitten.
- **Skills** — Katalog und aktive Skill-Injektion; Hosts entdecken Dateien auf der Festplatte.
- **MCP** — Model Context Protocol Client, Registry und Tool/Resource/Prompt-Brücke.
- **Mode prompts** — Agent-, Plan-, Ask- und Debug-Grenzen ohne Tool-Wiederholung im Systemtext.

### Qualität und Evaluation

- **Smoke-Suites** — Vertrags-, Runtime- und Live-Anbieter-Checks unter `packages/agent-core/src/smoke`.
- **Eval-Harness** — Szenariovergleich für Prompt- oder Tool-Definitionsänderungen (`pnpm run eval:compare` im Repo-Root).

`@spiritagent/agent-core` wird auf npm veröffentlicht; [`packages/host-internal`](../packages/host-internal) enthält gemeinsame Host-Discovery, Extensions, Workspace-Helfer und LSP-Orchestrierung für Desktop.

## Desktop

Die [Desktop-App](../apps/desktop) ist der primäre grafische Host: eine workspace-gebundene IDE-Oberfläche mit konversationellem Agent.

- **Andockpanels** — Datei-Explorer mit Monaco-Editor, eingebettetes Terminal (Electron), Git-Änderungen und Historie, In-App-Browser für lokale Dev-Server.
- **Sessions** — Mehrfach-Konversationshistorie, Worktree-pro-Session-Workflows, Tool-Freigabe, Subagent-Viewer, strukturierte Fragebögen, Kontextnutzung und Rewind.
- **Konfiguration** — Modellanbieter und API-Schlüssel, Skills und Rules, MCP-Server, Extensions, Dreams (beta), LSP, Themes und UI-Sprache (Englisch / Vereinfachtes Chinesisch / Deutsch u. a.).
- **Plattformen** — Electron auf Windows, macOS und Linux; optionaler Web-Host mit Remote-Pairing.

Siehe [apps/desktop/README.md](../apps/desktop/README.md) für Desktop-spezifische Entwicklung.

## Site

Die [Marketing- und Dokumentationssite](../apps/site) ist eine Next.js- + Fumadocs-App (`@spiritagent/site`) und wird auf Vercel bereitgestellt.

```bash
pnpm run dev:site
```

Lokale Entwicklung und der Vercel-Repo-Wechsel stehen in [apps/site/README.md](../apps/site/README.md).

## CLI

<img width="1014" height="744" alt="Spirit CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />

Die [Rust CLI](../apps/cli) (`spirit`) bietet einen terminal-first Host mit optionaler Ratatui-UI. Sie verbindet sich per WebSocket mit dem gemeinsamen Spirit-Server-Daemon und eignet sich für Skripte, SSH-Sitzungen und Minimalumgebungen.

```bash
pnpm run dev:cli    # cargo run -p spirit
```

## Server

[`packages/server`](../packages/server) (`@spiritagent/server`, Bin `spirit-server` / `spirit serve`) ist das **gemeinsame Daemon-Backend** für die First-Party-Hosts. CLI und Desktop betten die Runtime nicht mehr im Prozess ein, sondern verbinden sich per WebSocket (JSON-RPC 2.0) mit demselben Daemon — eine im Terminal gestartete Sitzung streamt live in die Desktop-App und umgekehrt.

- **Single Source of Truth** — Sitzungen, Streaming-Events, Tool-Ausführung und Freigabe-Warteschlangen laufen im Daemon; Clients rendern nur und senden Eingaben.
- **Instanzen auf Zufallsports** — bindet an `127.0.0.1` mit einem vom OS zugewiesenen Port und registriert sich unter `{spiritDataDir}/server/instances/`; Clients hängen sich bevorzugt an eine laufende Instanz oder starten eine neue. `spirit-server ps` / `kill` verwalten Instanzen.
- **Bearer-Auth** — Home-weites Token unter `{spiritDataDir}/server.token` (Modus 0600), akzeptiert per `Authorization`-Header oder `?token=`-Query; `spirit-server rotate-token` rotiert es für neue Verbindungen.
- **Keine neuen Abhängigkeiten** — die WebSocket-Schicht (RFC 6455) ist im Paket implementiert.

**CLI und Desktop sind für die Agent-Ausführung daemon-only** (siehe [Epic #274](https://github.com/SpiritAgents/spirit/issues/274)). Desktop-Web-Host-Clients erhalten authentifizierte Snapshot-Pushes vom Desktop-Host, während die Agent-Ausführung im Daemon bleibt. Fernzugriff (`--hostname 0.0.0.0`) ist einer späteren Phase vorbehalten und standardmäßig aus.

## ACP Server

[`packages/acp-server`](../packages/acp-server) ist ein dünner Adapter, der Spirit als [Agent Client Protocol](https://agentclientprotocol.com) (ACP)-Server über stdio / ndJSON bereitstellt. Jeder ACP-kompatible Editor — z. B. **Zed** oder **JetBrains Junie** — kann Spirit als AI-Coding-Engine nutzen, ohne eigene Integration.

- **Terminal Auth** — `initialize` kündigt `type: "terminal"` an; Clients starten `spirit-acp --setup` für interaktive Provider-Konfiguration, dann `authenticate` vor `session/new`.
- **Protokolloberfläche** — `initialize`, `authenticate`, `logout`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_mode`.
- **Streaming & Thinking** — Echtzeit-`agent_message_chunk` und `agent_thought_chunk` für Modellreasoning.
- **Permission Bridge** — Tool-Freigabe über ACP `request_permission` mit allow-once / always-allow / reject.
- **Slash-Befehle** — Workspace- und User-Skills als `available_commands_update`; `/skill-name` aktiviert den Skill und injiziert Anweisungen.
- **Lokale Ausführung** — Tools laufen in-process via `NodeHostToolService` (stdio bleibt ACP ndJSON vorbehalten).

### Schnellstart (Zed)

1. Server bauen: `pnpm run build:acp-server`
2. In Zed `settings.json` eintragen (kein API-Key in `env`):

```json
"agent_servers": {
  "Spirit": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. Bei Authentifizierung **Run in terminal** wählen → `--setup` startet Provider-, Credential- und Modellauswahl.
4. Setup schreibt ins gemeinsame Spirit-Datenverzeichnis (`config.json` + OS-Keyring — wie Desktop/CLI). Danach `authenticate`, dann `session/new`.

Manuelles Setup außerhalb des Editors:

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| Umgebungsvariable      | Erforderlich | Beschreibung                                                                 |
| ---------------------- | ------------ | ---------------------------------------------------------------------------- |
| `SPIRIT_ACP_WORKSPACE` | Nein         | Workspace-Root (Standard: Client-`cwd`)                                      |
| `SPIRIT_ACP_DATA_DIR`  | Nein         | Spirit-Datenverzeichnis (Standard: `%APPDATA%/Spirit` oder `~/.spirit-data`) |

## Entwicklung

**Anforderungen:** Node.js 24+, pnpm 11+ (über `corepack enable` aktivieren). Rust-Toolchain für CLI-Builds.

| Befehl                     | Beschreibung                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm install`             | Workspace-Abhängigkeiten installieren (einmal im Repo-Root)                          |
| `pnpm run dev:desktop`     | Shared Packages bauen und Desktop starten (Vite + Electron)                          |
| `pnpm run dev:desktop:web` | Desktop-Renderer mit Browser-Web-Host                                                |
| `pnpm run dev:site`        | Marketing-/Dokumentationssite starten (Next.js)                                      |
| `pnpm run dev:cli`         | CLI mit TUI                                                                          |
| `pnpm run build`           | Produktionsbuild von agent-core, host-internal, server, acp-server, Desktop und site |
| `pnpm run eval:compare`    | Eval-Vergleich nach agent-core-Änderungen                                            |

### Repository-Layout

```
apps/
  desktop/           Electron + React Host
  site/              Marketing- und Dokumentationssite (Next.js, Vercel)
  cli/               Rust CLI und TUI
packages/
  agent-core/        Agent-Runtime, Prompts, Tool-Definitionen, Transports, MCP, eval
  host-internal/     Shared Host Discovery, Tools, Extensions, LSP-Helfer
  server/            Gemeinsames Daemon-Backend (WebSocket + JSON-RPC) für CLI / Desktop / Web
  acp-server/        ACP-Server-Adapter für Editor-Integration
scripts/             Release-, Eval- und Repo-Automatisierung
```

## Mitwirken

Einstieg über [CONTRIBUTING.md](../CONTRIBUTING.md). Architekturgrenzen, Commit-Konventionen und agent-core-Richtlinien: [AGENTS.md](../AGENTS.md). Sicherheitsprobleme: [SECURITY.md](../SECURITY.md).

## Lizenz

[MIT](../LICENSE)
