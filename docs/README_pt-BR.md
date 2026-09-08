<div align="center">

# Spirit

Um agente de IA de código aberto feito para multiplicar sua produtividade.

[Aplicativo Desktop](#desktop) · [Site](#site) · [CLI](#cli) · [Server](#server) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [Desenvolvimento](#desenvolvimento)

> Este projeto está em desenvolvimento ativo. Comportamento e APIs podem mudar entre releases.

[English](../README.md)

<img width="1552" height="1032" alt="Spirit Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

</div>

## Visão geral

Spirit é um **agente de codificação orientado a ferramentas** que roda contra a raiz de um projeto real. O mesmo runtime alimenta um workspace Desktop nativo e uma interface de terminal. A lógica compartilhada fica em pacotes TypeScript; os hosts adicionam execução, descoberta e UI específicas da plataforma.

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

[`packages/agent-core`](../packages/agent-core) é a **única fonte da semântica do agente** neste repositório. Os hosts a consomem.

### Runtime e modos

- **Turn machine** — saída do assistente em streaming, rodadas de ferramentas, compactação e rastreamento de uso de contexto.
- **Modos Agent / Plan / Ask / Debug** — acesso total a ferramentas, fluxos só de planejamento, Q&A somente leitura sem ferramentas de edição na camada de contrato ou depuração estruturada com hipóteses de pontos de log.
- **Subagents** — `subagent` delega trabalho focado a execuções filhas com sua própria superfície de ferramentas.
- **Controle de loop** — `finish_task` opcional quando o loop multitarefa está ativo.
- **Histórico compatível com rewind** — formatos de arquivo pensados para rollback e reenvio no host.

### Transportes de modelo

Agent Core roteia inferência por vários transportes atrás de um runtime unificado:

| Transporte            | Provedores típicos                                                        |
| --------------------- | ------------------------------------------------------------------------- |
| **OpenAI-compatible** | OpenAI, DeepSeek, Moonshot, MiniMax, Volcengine, endpoints personalizados |
| **Open Responses**    | OpenAI, SpaceXAI, Vercel AI Gateway, OpenRouter, Alibaba (Bailian)        |
| **Anthropic**         | Claude via Messages API                                                   |

Capacidades nativas do provedor (busca web no Open Responses, busca e interpretador de código Alibaba, etc.) são injetadas pelo campo `tools`.

### Contratos de ferramentas do host

Ferramentas embutidas são definidas uma vez no Agent Core (nome, descrição, JSON Schema). Os hosts executam:

- **Workspace** — `read_file`, `write_file` / `create_file` / `edit_file` / `delete_file`, `apply_patch` (V4A em transportes suportados), `glob`, `grep`, `ls`
- **Shell** — `shell` com aprovação controlada pelo host
- **Web** — `web_fetch`; busca via ferramentas do provedor ou busca do host configurada
- **Delegation** — `subagent`
- **Planning** — `create_plan`, ferramentas TODO de sessão (`todo_list`, `todo_write`)
- **Multimodal** — `generate_image`, `generate_video`
- **Dreams** — `dream_list`, `dream_read`, `dream_record`, `dream_update`, `dream_delete` para resumos de memória do workspace
- **LSP** — diagnósticos do language server após edições

### Montagem do contexto do sistema

Agent Core decide como o modelo vê o contexto do projeto:

- **Rules** — `AGENTS.md`, `.spirit/rule.md` e slots de regras do usuário mesclados em seções system.
- **Skills** — catálogo e injeção de skill ativo; hosts descobrem arquivos no disco.
- **MCP** — cliente Model Context Protocol, registro e ponte tool/resource/prompt.
- **Mode prompts** — limites Agent, Plan, Ask e Debug sem relistar ferramentas no texto system.

### Qualidade e avaliação

- **Suites smoke** — checagens de contrato, runtime e provedor live em `packages/agent-core/src/smoke`.
- **Harness eval** — comparação de cenários para mudanças de prompts ou definições de ferramentas (`pnpm run eval:compare` na raiz).

`@spiritagent/agent-core` é publicado no npm; [`packages/host-internal`](../packages/host-internal) contém descoberta compartilhada do host, extensões, helpers de workspace e orquestração LSP para Desktop.

## Desktop

O [aplicativo Desktop](../apps/desktop) é o host gráfico principal: superfície IDE ligada ao workspace com agente conversacional.

- **Painéis acoplados** — explorador de arquivos com editor Monaco, terminal embutido (Electron), alterações e histórico Git, navegador in-app para servidores de dev locais.
- **Sessões** — histórico multi-conversa, fluxos worktree por sessão, aprovação de ferramentas, visualizador de subagentes, questionários estruturados, uso de contexto e rewind.
- **Configuração** — provedores de modelos e chaves API, Skills e Rules, servidores MCP, extensões, Dreams (beta), LSP, temas e idioma da UI (inglês / chinês simplificado / português do Brasil, etc.).
- **Plataformas** — Electron no Windows, macOS e Linux; host web opcional com pareamento remoto.

Veja [apps/desktop/README.md](../apps/desktop/README.md) para desenvolvimento específico do Desktop.

## Site

O [site de marketing e documentação](../apps/site) é um app Next.js + Fumadocs (`@spiritagent/site`), publicado na Vercel.

```bash
pnpm run dev:site
```

Veja [apps/site/README.md](../apps/site/README.md) para desenvolvimento local e a troca de repositório na Vercel.

## CLI

<img width="1014" height="744" alt="Spirit CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />

A [CLI Rust](../apps/cli) (`spirit`) oferece um host terminal-first com UI Ratatui opcional. Conecta-se ao daemon compartilhado Spirit Server via WebSocket, ideal para scripts, sessões SSH e ambientes mínimos.

```bash
pnpm run dev:cli    # cargo run -p spirit
```

## Server

[`packages/server`](../packages/server) (`@spiritagent/server`, bin `spirit-server` / `spirit serve`) é o **backend daemon compartilhado** dos hosts first-party. CLI e Desktop não embutem mais um runtime no processo: conectam-se ao mesmo daemon via WebSocket (JSON-RPC 2.0) — uma sessão iniciada no terminal é transmitida ao vivo para o Desktop, e vice-versa.

- **Fonte única de verdade** — sessões, eventos de streaming, execução de ferramentas e filas de aprovação vivem no daemon; os clientes apenas renderizam e enviam entradas.
- **Instâncias em porta aleatória** — escuta em `127.0.0.1` com porta atribuída pelo SO e registra em `{spiritDataDir}/server/instances/`; os clientes preferem anexar a uma instância viva, senão sobem uma nova. `spirit-server ps` / `kill` gerenciam as instâncias.
- **Auth Bearer** — token no nível do home em `{spiritDataDir}/server.token` (modo 0600), aceito via cabeçalho `Authorization` ou query `?token=`; `spirit-server rotate-token` o rotaciona para novas conexões.
- **Sem novas dependências** — a camada WebSocket (RFC 6455) é implementada no próprio pacote.

**CLI e Desktop são daemon-only para execução do agente** (veja [Epic #274](https://github.com/SpiritAgents/spirit/issues/274)). Clientes Desktop Web Host recebem snapshots autenticados do host Desktop enquanto a execução do agente permanece no daemon. O acesso remoto (`--hostname 0.0.0.0`) é reservado para uma fase futura e fica desligado por padrão.

## ACP Server

[`packages/acp-server`](../packages/acp-server) é um adaptador fino que expõe Spirit como servidor [Agent Client Protocol](https://agentclientprotocol.com) (ACP) via stdio / ndJSON. Qualquer editor compatível com ACP — como **Zed** ou **JetBrains Junie** — pode conectar Spirit como motor de codificação IA sem integração customizada.

- **Terminal Auth** — `initialize` anuncia auth `type: "terminal"`; clientes executam `spirit-acp --setup` para configuração interativa do provider, depois `authenticate` antes de `session/new`.
- **Superfície do protocolo** — `initialize`, `authenticate`, `logout`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_mode`.
- **Streaming e raciocínio** — `agent_message_chunk` em tempo real e `agent_thought_chunk` para saída de raciocínio do modelo.
- **Ponte de permissões** — aprovação de ferramentas via ACP `request_permission` (allow-once / always-allow / reject).
- **Comandos slash** — Skills de workspace e usuário via `available_commands_update`; `/skill-name` ativa o skill e injeta instruções.
- **Execução local** — ferramentas in-process via `NodeHostToolService` (stdio reservado para ndJSON ACP).

### Início rápido (Zed)

1. Build do servidor: `pnpm run build:acp-server`
2. Adicionar em `settings.json` do Zed (sem chave API em `env`):

```json
"agent_servers": {
  "Spirit": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. Na autenticação, escolher **Run in terminal** → `--setup`: provider, credenciais, modelo.
4. Setup grava no diretório de dados Spirit compartilhado (`config.json` + keyring do SO, igual Desktop/CLI). Depois `authenticate`, depois `session/new`.

Setup manual fora do editor:

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| Variável de ambiente   | Obrigatória | Descrição                                                                  |
| ---------------------- | ----------- | -------------------------------------------------------------------------- |
| `SPIRIT_ACP_WORKSPACE` | Não         | Raiz do workspace (padrão: `cwd` do cliente)                               |
| `SPIRIT_ACP_DATA_DIR`  | Não         | Diretório de dados Spirit (padrão: `%APPDATA%/Spirit` ou `~/.spirit-data`) |

## Desenvolvimento

**Requisitos:** Node.js 24+, pnpm 11+ (ativar via `corepack enable`). Toolchain Rust necessária para build da CLI.

| Comando                    | Descrição                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm install`             | Instalar dependências do workspace (uma vez na raiz)                               |
| `pnpm run dev:desktop`     | Build dos pacotes compartilhados e iniciar Desktop (Vite + Electron)               |
| `pnpm run dev:desktop:web` | Renderer Desktop com host web no navegador                                         |
| `pnpm run dev:site`        | Iniciar o site de marketing/docs (Next.js)                                         |
| `pnpm run dev:cli`         | CLI com TUI                                                                        |
| `pnpm run build`           | Build de produção de agent-core, host-internal, server, acp-server, Desktop e site |
| `pnpm run eval:compare`    | Comparação eval após mudanças no agent-core                                        |

### Estrutura do repositório

```
apps/
  desktop/           Host Electron + React
  site/              Site de marketing e docs (Next.js, Vercel)
  cli/               CLI Rust e TUI
packages/
  agent-core/        Runtime do agente, prompts, definições de ferramentas, transports, MCP, eval
  host-internal/     Descoberta compartilhada do host, ferramentas, extensões, helpers LSP
  server/            Backend daemon compartilhado (WebSocket + JSON-RPC) para CLI / Desktop / Web
  acp-server/        Adaptador de servidor ACP para integração com editores
scripts/             Release, eval e automação do repo
```

## Contribuir

Consulte [CONTRIBUTING.md](../CONTRIBUTING.md) para começar. Para limites de arquitetura, convenções de commit e guia agent-core, leia também [AGENTS.md](../AGENTS.md). Para reportar problemas de segurança, consulte [SECURITY.md](../SECURITY.md).

## Licença

[MIT](../LICENSE)
