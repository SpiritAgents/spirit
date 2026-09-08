<div align="center">

# Spirit

Un agent IA open source conçu pour multiplier votre productivité.

[Application Desktop](#desktop) · [Site](#site) · [CLI](#cli) · [Server](#server) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [Développement](#développement)

> Ce projet est en développement actif. Le comportement et les API peuvent changer entre les versions.

[English](../README.md)

<img width="1552" height="1032" alt="Spirit Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

</div>

## Aperçu

Spirit est un **agent de codage orienté outils** qui s’exécute sur une racine de projet réelle. Le même runtime alimente un workspace Desktop natif et une interface terminal. La logique partagée vit dans des packages TypeScript ; les hôtes ajoutent exécution, découverte et UI spécifiques à la plateforme.

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

[`packages/agent-core`](../packages/agent-core) est la **source unique de la sémantique agent** dans ce dépôt. Les hôtes la consomment.

### Runtime et modes

- **Turn machine** — sortie assistant en streaming, rounds d’outils, compaction et suivi d’usage du contexte.
- **Modes Agent / Plan / Ask / Debug** — accès complet aux outils, workflows de planification uniquement, Q&A en lecture seule sans outils d’édition au niveau contrat ou débogage structuré avec hypothèses de points de journalisation.
- **Subagents** — `subagent` délègue des tâches ciblées à des exécutions filles avec leur propre surface d’outils.
- **Contrôle de boucle** — `finish_task` optionnel lorsque la boucle multitâche est activée.
- **Historique rewind-friendly** — formats d’archive conçus pour rollback et resoumission côté hôte.

### Transports modèle

Agent Core route l’inférence via plusieurs transports derrière un runtime unifié :

| Transport             | Fournisseurs typiques                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| **OpenAI-compatible** | OpenAI, DeepSeek, Moonshot, MiniMax, Volcengine, endpoints personnalisés |
| **Open Responses**    | OpenAI, SpaceXAI, Vercel AI Gateway, OpenRouter, Alibaba (Bailian)       |
| **Anthropic**         | Claude via Messages API                                                  |

Les capacités natives (recherche web Open Responses, recherche et interpréteur de code Alibaba, etc.) sont injectées via le champ `tools`.

### Contrats d’outils hôte

Les outils intégrés sont définis une fois dans Agent Core (nom, description, JSON Schema). Les hôtes exécutent :

- **Workspace** — `read_file`, `write_file` / `create_file` / `edit_file` / `delete_file`, `apply_patch` (V4A sur transports supportés), `glob`, `grep`, `ls`
- **Shell** — `shell` avec approbation contrôlée par l’hôte
- **Web** — `web_fetch` ; recherche via outils fournisseur ou recherche hôte configurée
- **Delegation** — `subagent`
- **Planning** — `create_plan`, outils TODO de session (`todo_list`, `todo_write`)
- **Multimodal** — `generate_image`, `generate_video`
- **Dreams** — `dream_list`, `dream_read`, `dream_record`, `dream_update`, `dream_delete` pour résumés de mémoire workspace
- **LSP** — diagnostics language server après éditions

### Assemblage du contexte système

Agent Core détermine comment le modèle voit le contexte projet :

- **Rules** — `AGENTS.md`, `.spirit/rule.md` et emplacements de règles utilisateur fusionnés dans les sections system.
- **Skills** — catalogue et injection de skill actif ; les hôtes découvrent les fichiers sur disque.
- **MCP** — client Model Context Protocol, registre et pont tool/resource/prompt.
- **Mode prompts** — frontières Agent, Plan, Ask et Debug sans relister les outils dans le texte system.

### Qualité et évaluation

- **Suites smoke** — contrats, runtime et checks fournisseur live sous `packages/agent-core/src/smoke`.
- **Harness eval** — comparaison de scénarios pour changements de prompts ou définitions d’outils (`pnpm run eval:compare` à la racine).

`@spiritagent/agent-core` est publié sur npm ; [`packages/host-internal`](../packages/host-internal) contient découverte hôte partagée, extensions, helpers workspace et orchestration LSP pour Desktop.

## Desktop

L’[application Desktop](../apps/desktop) est l’hôte graphique principal : surface IDE liée au workspace avec agent conversationnel.

- **Panneaux dockés** — explorateur de fichiers avec éditeur Monaco, terminal intégré (Electron), changements et historique Git, navigateur in-app pour serveurs de dev locaux.
- **Sessions** — historique multi-conversations, workflows worktree par session, approbation d’outils, viewer subagent, questionnaires structurés, usage du contexte et rewind.
- **Configuration** — fournisseurs de modèles et clés API, Skills et Rules, serveurs MCP, extensions, Dreams (beta), LSP, thèmes et locale UI (anglais / chinois simplifié / français, etc.).
- **Plateformes** — Electron sur Windows, macOS et Linux ; hôte web optionnel avec pairing distant.

Voir [apps/desktop/README.md](../apps/desktop/README.md) pour le développement Desktop.

## Site

Le [site marketing et documentation](../apps/site) est une app Next.js + Fumadocs (`@spiritagent/site`), déployée sur Vercel.

```bash
pnpm run dev:site
```

Voir [apps/site/README.md](../apps/site/README.md) pour le développement local et le basculement Git Vercel.

## CLI

<img width="1014" height="744" alt="Spirit CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />

La [CLI Rust](../apps/cli) (`spirit`) offre un hôte terminal-first avec UI Ratatui optionnelle. Elle se connecte au daemon Spirit Server partagé via WebSocket, idéale pour scripts, sessions SSH et environnements minimaux.

```bash
pnpm run dev:cli    # cargo run -p spirit
```

## Server

[`packages/server`](../packages/server) (`@spiritagent/server`, binaire `spirit-server` / `spirit serve`) est le **backend démon partagé** des hôtes first-party. CLI et Desktop n'embarquent plus de runtime dans leur processus : ils se connectent au même démon via WebSocket (JSON-RPC 2.0) — une session démarrée dans le terminal se diffuse en direct dans Desktop, et inversement.

- **Source de vérité unique** — sessions, événements de streaming, exécution des outils et files d'approbation vivent dans le démon ; les clients se contentent d'afficher et d'envoyer des entrées.
- **Instances sur port aléatoire** — écoute sur `127.0.0.1` avec un port attribué par l'OS et s'enregistre dans `{spiritDataDir}/server/instances/` ; les clients s'attachent de préférence à une instance existante, sinon en démarrent une. `spirit-server ps` / `kill` gèrent les instances.
- **Auth Bearer** — jeton au niveau du home dans `{spiritDataDir}/server.token` (mode 0600), accepté via l'en-tête `Authorization` ou la query `?token=` ; `spirit-server rotate-token` le renouvelle pour les nouvelles connexions.
- **Aucune nouvelle dépendance** — la couche WebSocket (RFC 6455) est implémentée dans le package.

**CLI et Desktop sont daemon-only pour l'exécution de l'agent** (voir [Epic #274](https://github.com/SpiritAgents/spirit/issues/274)). Les clients Desktop Web Host reçoivent des snapshots authentifiés poussés par l'hôte Desktop, l'exécution de l'agent restant dans le daemon. L'accès distant (`--hostname 0.0.0.0`) est réservé à une phase ultérieure et désactivé par défaut.

## ACP Server

[`packages/acp-server`](../packages/acp-server) est un adaptateur léger exposant Spirit comme serveur [Agent Client Protocol](https://agentclientprotocol.com) (ACP) via stdio / ndJSON. Tout éditeur compatible ACP — comme **Zed** ou **JetBrains Junie** — peut connecter Spirit comme moteur de codage IA sans intégration sur mesure.

- **Terminal Auth** — `initialize` annonce une auth `type: "terminal"` ; les clients lancent `spirit-acp --setup` pour configurer le provider, puis `authenticate` avant `session/new`.
- **Surface protocole** — `initialize`, `authenticate`, `logout`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_mode`.
- **Streaming & thinking** — `agent_message_chunk` en temps réel et `agent_thought_chunk` pour le raisonnement du modèle.
- **Pont de permissions** — approbation d’outils via ACP `request_permission` (allow-once / always-allow / reject).
- **Commandes slash** — Skills workspace et utilisateur via `available_commands_update` ; `/skill-name` active le skill et injecte ses instructions.
- **Exécution locale** — outils in-process via `NodeHostToolService` (stdio réservé au ndJSON ACP).

### Démarrage rapide (Zed)

1. Build du serveur : `pnpm run build:acp-server`
2. Ajouter dans `settings.json` de Zed (pas de clé API dans `env`) :

```json
"agent_servers": {
  "Spirit": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. Lors de l’auth, choisir **Run in terminal** → `--setup` : provider, identifiants, modèle.
4. Setup écrit dans le répertoire de données Spirit partagé (`config.json` + keyring OS, comme Desktop/CLI). Puis `authenticate`, puis `session/new`.

Setup manuel hors éditeur :

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| Variable d’environnement | Requis | Description                                                                    |
| ------------------------ | ------ | ------------------------------------------------------------------------------ |
| `SPIRIT_ACP_WORKSPACE`   | Non    | Racine workspace (défaut : `cwd` client)                                       |
| `SPIRIT_ACP_DATA_DIR`    | Non    | Répertoire de données Spirit (défaut : `%APPDATA%/Spirit` ou `~/.spirit-data`) |

## Développement

**Prérequis :** Node.js 24+, pnpm 11+ (activer via `corepack enable`). Toolchain Rust requise pour la CLI.

| Commande                   | Description                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- |
| `pnpm install`             | Installer les dépendances du workspace (une fois à la racine)                   |
| `pnpm run dev:desktop`     | Build des packages partagés et démarrage Desktop (Vite + Electron)              |
| `pnpm run dev:desktop:web` | Renderer Desktop avec hôte web navigateur                                       |
| `pnpm run dev:site`        | Démarrer le site marketing/docs (Next.js)                                       |
| `pnpm run dev:cli`         | CLI avec TUI                                                                    |
| `pnpm run build`           | Build production agent-core, host-internal, server, acp-server, Desktop et site |
| `pnpm run eval:compare`    | Comparaison eval après changements agent-core                                   |

### Structure du dépôt

```
apps/
  desktop/           Hôte Electron + React
  site/              Site marketing et docs (Next.js, Vercel)
  cli/               CLI Rust et TUI
packages/
  agent-core/        Runtime agent, prompts, définitions d’outils, transports, MCP, eval
  host-internal/     Découverte hôte partagée, outils, extensions, helpers LSP
  server/            Backend démon partagé (WebSocket + JSON-RPC) pour CLI / Desktop / Web
  acp-server/        Adaptateur serveur ACP pour intégration éditeur
scripts/             Release, eval et automatisation repo
```

## Contribuer

Consultez [CONTRIBUTING.md](../CONTRIBUTING.md) pour commencer. Pour les frontières d’architecture, conventions de commit et guide agent-core, lisez aussi [AGENTS.md](../AGENTS.md). Pour signaler des problèmes de sécurité, voir [SECURITY.md](../SECURITY.md).

## Licence

[MIT](../LICENSE)
