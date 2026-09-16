<div align="center">

# Spirit

Открытый AI-агент, созданный умножать вашу продуктивность.

[Desktop-приложение](#desktop) · [Site](#site) · [CLI](#cli) · [Server](#server) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [Разработка](#разработка)

> Проект активно развивается. Поведение и API могут меняться между релизами.

[English](../README.md)

<img width="1552" height="1032" alt="Spirit Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

</div>

## Обзор

Spirit — **агент для кодирования с инструментами**, работающий от корня реального проекта. Один и тот же runtime питает нативный Desktop workspace и терминальный UI. Общая логика живёт в TypeScript-пакетах; хосты добавляют платформенное выполнение, discovery и UI.

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

[`packages/agent-core`](../packages/agent-core) — **единственный источник семантики агента** в этом репозитории. Хосты его потребляют.

### Runtime и режимы

- **Turn machine** — потоковый вывод ассистента, раунды инструментов, компактирование и учёт использования контекста.
- **Режимы Agent / Plan / Ask / Debug** — полный доступ к инструментам, только планирование, read-only Q&A без edit-инструментов на уровне контракта или структурированный отладочный анализ с гипотезами точек журналирования.
- **Subagents** — `subagent` делегирует сфокусированную работу дочерним запускам со своей поверхностью инструментов.
- **Управление циклом** — опциональный `finish_task` при включённом multitask-цикле.
- **История с поддержкой rewind** — форматы архива для отката и повторной отправки на стороне хоста.

### Транспорты моделей

Agent Core маршрутизирует inference через несколько транспортов за единым runtime:

| Транспорт             | Типичные провайдеры                                                         |
| --------------------- | --------------------------------------------------------------------------- |
| **OpenAI-compatible** | OpenAI, DeepSeek, Moonshot, MiniMax, Volcengine, пользовательские endpoints |
| **Open Responses**    | OpenAI, SpaceXAI, Vercel AI Gateway, OpenRouter, Alibaba (Bailian)          |
| **Anthropic**         | Claude через Messages API                                                   |

Нативные возможности провайдера (веб-поиск Open Responses, встроенный поиск и интерпретатор кода Alibaba и т. д.) инжектируются через поле `tools`.

### Контракты инструментов хоста

Встроенные инструменты определяются один раз в Agent Core (имя, описание, JSON Schema). Хосты выполняют:

- **Workspace** — `read_file`, `write_file` / `create_file` / `edit_file` / `delete_file`, `apply_patch` (V4A на поддерживаемых транспортах), `glob`, `grep`, `ls`
- **Shell** — `shell` с одобрением, контролируемым хостом
- **Web** — `web_fetch`; поиск через инструменты провайдера или настроенный host search
- **Delegation** — `subagent`
- **Planning** — `create_plan`, session TODO tools (`todo_list`, `todo_write`)
- **Multimodal** — `generate_image`, `generate_video`
- **Dreams** — `dream_list`, `dream_read`, `dream_record`, `dream_update`, `dream_delete` для сводок памяти workspace
- **LSP** — диагностика language server после правок

### Сборка системного контекста

Agent Core определяет, как модель видит контекст проекта:

- **Rules** — `AGENTS.md`, `.spirit/rule.md` и пользовательские rule-слоты в system-секциях.
- **Skills** — каталог и инъекция активного skill; хосты находят файлы на диске.
- **MCP** — клиент Model Context Protocol, реестр и мост tool/resource/prompt.
- **Mode prompts** — границы Agent, Plan, Ask и Debug без повторного перечисления инструментов в system-тексте.

### Качество и оценка

- **Smoke-наборы** — проверки контракта, runtime и live-провайдера в `packages/agent-core/src/smoke`.
- **Eval harness** — сравнение сценариев при изменении prompts или определений инструментов (`pnpm run eval:compare` из корня репозитория).

`@spiritagent/agent-core` публикуется в npm; [`packages/host-internal`](../packages/host-internal) содержит общий host discovery, extensions, workspace helpers и оркестрацию LSP для Desktop.

## Desktop

[Desktop-приложение](../apps/desktop) — основной графический хост: IDE-поверхность, привязанная к workspace, с conversational agent.

- **Dock-панели** — проводник файлов с Monaco, встроенный терминал (Electron), Git changes и history, in-app browser для локальных dev-серверов.
- **Сессии** — история нескольких диалогов, worktree-per-session workflows, одобрение инструментов, subagent viewer, структурированные опросники, использование контекста и rewind.
- **Настройки** — провайдеры моделей и API keys, Skills и Rules, MCP servers, расширения, Dreams (beta), LSP, темы и язык UI (английский / упрощённый китайский / русский и др.).
- **Платформы** — Electron на Windows, macOS и Linux; опциональный web host с remote pairing.

См. [apps/desktop/README.md](../apps/desktop/README.md) для разработки Desktop.

## Site

[Маркетинговый и документационный сайт](../apps/site) — приложение Next.js + Fumadocs (`@spiritagent/site`), деплой на Vercel.

```bash
pnpm run dev:site
```

Локальная разработка и переключение Git в Vercel — в [apps/site/README.md](../apps/site/README.md).

## CLI

<img width="1014" height="744" alt="Spirit CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />

[Rust CLI](../apps/cli) (`spirit`) — terminal-first хост с опциональным Ratatui UI. Подключается к общему daemon Spirit Server по WebSocket; подходит для скриптов, SSH-сессий и минимальных окружений.

```bash
pnpm run dev:cli    # cargo run -p spirit
```

## Server

[`packages/server`](../packages/server) (`@spiritagent/server`, бинарь `spirit-server` / `spirit serve`) — **общий daemon-бэкенд** для собственных хостов. CLI и Desktop больше не встраивают рантайм в свой процесс, а подключаются к одному и тому же daemon по WebSocket (JSON-RPC 2.0): сессия, начатая в терминале, стримится в Desktop в реальном времени — и наоборот.

- **Единый источник истины** — сессии, потоковые события, выполнение инструментов и очереди подтверждений живут в daemon; клиенты только отрисовывают UI и отправляют ввод.
- **Инстансы на случайном порту** — привязка к `127.0.0.1` на выделенном ОС порту, регистрация в `{spiritDataDir}/server/instances/`; клиенты сначала пытаются подключиться к живому инстансу, иначе запускают новый. `spirit-server ps` / `kill` управляют инстансами.
- **Bearer-аутентификация** — токен уровня home в `{spiritDataDir}/server.token` (права 0600), принимается через заголовок `Authorization` или query `?token=`; `spirit-server rotate-token` ротирует его для новых подключений.
- **Без новых зависимостей** — слой WebSocket (RFC 6455) реализован внутри пакета.

**CLI и Desktop работают только через daemon для выполнения агента** (см. [Epic #274](https://github.com/SpiritAgents/spirit/issues/274)). Клиенты Desktop Web Host получают аутентифицированные snapshot-push от Desktop-хоста, а выполнение агента остаётся в daemon. Удалённый доступ (`--hostname 0.0.0.0`) зарезервирован для будущей фазы и по умолчанию выключен.

## ACP Server

[`packages/acp-server`](../packages/acp-server) — тонкий адаптер, предоставляющий Spirit как [Agent Client Protocol](https://agentclientprotocol.com) (ACP) server через stdio / ndJSON. Любой ACP-совместимый редактор — например **Zed** или **JetBrains Junie** — может подключить Spirit как AI coding engine без кастомной интеграции.

- **Terminal Auth** — `initialize` объявляет auth `type: "terminal"`; клиенты запускают `spirit-acp --setup` для интерактивной настройки provider, затем `authenticate` перед `session/new`.
- **Поверхность протокола** — `initialize`, `authenticate`, `logout`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_mode`.
- **Streaming & thinking** — realtime `agent_message_chunk` и `agent_thought_chunk` для reasoning модели.
- **Permission bridge** — одобрение инструментов через ACP `request_permission` (allow-once / always-allow / reject).
- **Slash-команды** — workspace и user Skills через `available_commands_update`; `/skill-name` активирует skill и инжектирует инструкции.
- **Локальное выполнение** — инструменты in-process через `NodeHostToolService` (stdio зарезервирован для ACP ndJSON).

### Быстрый старт (Zed)

1. Сборка сервера: `pnpm run build:acp-server`
2. Добавить в `settings.json` Zed (без API key в `env`):

```json
"agent_servers": {
  "Spirit": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. При аутентификации выбрать **Run in terminal** → `--setup`: provider, credentials, model.
4. Setup пишет в общий Spirit data directory (`config.json` + OS keyring — как Desktop/CLI). Затем `authenticate`, затем `session/new`.

Ручной setup вне редактора:

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| Переменная окружения   | Обязательна | Описание                                                                      |
| ---------------------- | ----------- | ----------------------------------------------------------------------------- |
| `SPIRIT_ACP_WORKSPACE` | Нет         | Корень workspace (по умолчанию: `cwd` клиента)                                |
| `SPIRIT_ACP_DATA_DIR`  | Нет         | Каталог данных Spirit (по умолчанию: `%APPDATA%/Spirit` или `~/.spirit-data`) |

## Разработка

**Требования:** Node.js 24+, pnpm 12+ (включить через `corepack enable`). Для сборки CLI нужен Rust toolchain.

| Команда                    | Описание                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ |
| `pnpm install`             | Установить зависимости workspace (один раз в корне репозитория)                |
| `pnpm run dev:desktop`     | Сборка shared packages и запуск Desktop (Vite + Electron)                      |
| `pnpm run dev:desktop:web` | Desktop renderer с browser web host                                            |
| `pnpm run dev:site`        | Запуск маркетингового/документационного сайта (Next.js)                        |
| `pnpm run dev:cli`         | CLI с TUI                                                                      |
| `pnpm run build`           | Production build agent-core, host-internal, server, acp-server, Desktop и site |
| `pnpm run eval:compare`    | Eval-сравнение после изменений agent-core                                      |

### Структура репозитория

```
apps/
  desktop/           Electron + React host
  site/              Маркетинговый и документационный сайт (Next.js, Vercel)
  cli/               Rust CLI и TUI
packages/
  agent-core/        Agent runtime, prompts, tool definitions, transports, MCP, eval
  host-internal/     Shared host discovery, tools, extensions, LSP helpers
  server/            Общий daemon-бэкенд (WebSocket + JSON-RPC) для CLI / Desktop / Web
  acp-server/        ACP server adapter для интеграции с редакторами
scripts/             Release, eval и автоматизация репозитория
```

## Участие в разработке

Начните с [CONTRIBUTING.md](../CONTRIBUTING.md). О границах архитектуры, соглашениях о коммитах и руководстве по agent-core см. [AGENTS.md](../AGENTS.md). О проблемах безопасности см. [SECURITY.md](../SECURITY.md).

## Лицензия

[MIT](../LICENSE)
