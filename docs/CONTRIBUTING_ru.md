# Участие в разработке Spirit

[English](../CONTRIBUTING.md) · [简体中文](CONTRIBUTING_zh-CN.md) · [繁體中文](CONTRIBUTING_zh-TW.md) · [日本語](CONTRIBUTING_ja.md) · [한국어](CONTRIBUTING_ko.md) · [Deutsch](CONTRIBUTING_de.md) · [Français](CONTRIBUTING_fr.md) · [Español](CONTRIBUTING_es.md) · [Português do Brasil](CONTRIBUTING_pt-BR.md)

Спасибо за ваш интерес к Spirit! Этот проект — монорепозиторий открытого агента для кодирования с инструментами: Desktop (Electron), CLI (Rust), общий демон (`packages/server`) и основная среда выполнения (`packages/agent-core`). Правите ли вы документацию, исправляете баги или добавляете функции — мы будем рады помощи. Если не знаете, с чего начать, откройте Issue и поздоровайтесь.

## Прежде чем вносить вклад

**Для более крупных изменений сначала откройте Issue**, чтобы согласовать направление, прежде чем вкладывать значительные усилия. Примеры:

- Новые функции или существенные изменения UX
- Изменения публичного API, протокола или формата конфигурации / хранения
- Рефакторинги, которые затрагивают несколько пакетов
- Изменения промптов, контрактов инструментов или внедрения контекста, которые меняют поведение агента

**Меньшие изменения можно сразу отправлять как pull request**, например:

- Обновления документации, README или комментариев
- Исправления орфографии и оформления
- Точечные исправления багов с ясным и ограниченным влиянием на поведение

Если сомневаетесь, короткое Issue обычно быстрее, чем большой PR, который придётся переделывать.

## Разработка с агентами

Писать код с помощью Cursor, Copilot или других агентных инструментов можно — но **вы по-прежнему отвечаете за diff, который отправляете**:

- Нужно уметь объяснить, _почему_ сделано изменение, а не только то, что его породила модель
- Проверяйте вывод агента: убирайте посторонние правки, дублирующуюся логику и лишние защитные слои
- К **тексту, видимому модели** (системные промпты, имена и описания инструментов, текст eval), относитесь особенно внимательно — держите его кратким, на английском, и не повторяйте возможности, уже объявленные в поле `tools` запроса
- В описании PR укажите мотив, влияние и то, как вы проверили изменение

Агенты могут ускорить реализацию. Они не заменяют ваше суждение.

## Архитектура и область

У Spirit ясная слоистая модель. Прежде чем затрагивать несколько пакетов, прочитайте [`.github/instructions/agent-core-host-boundary.instructions.md`](../.github/instructions/agent-core-host-boundary.instructions.md):

| Слой               | Путь                                                                              | Роль                                                                         |
| ------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Семантика агента   | `packages/agent-core`                                                             | Среда выполнения, промпты, контракты инструментов, MCP, транспорты           |
| Общая логика хоста | `packages/host-internal`                                                          | Обнаружение, расширения, вспомогательные средства workspace, оркестрация LSP |
| Хосты / адаптеры   | `apps/desktop`, `apps/cli`, `apps/site`, `packages/server`, `packages/acp-server` | Тонкие, платформенные UI и выполнение                                        |

Не дублируйте определения инструментов и промпты между CLI и Desktop. Новые контракты инструментов относятся к `agent-core`; выполнение относится к хосту.

## Среда разработки

**Требования:** Node.js 24+, pnpm 12+ (`corepack enable`) и инструментарий Rust (для CLI).

```bash
pnpm install          # один раз, в корне репозитория
pnpm run dev:desktop  # Desktop (Vite + Electron)
pnpm run dev:site     # маркетинговый и документационный сайт (Next.js)
pnpm run dev:cli      # CLI с TUI
pnpm run build        # production-сборка пакетов TS + Desktop + site + CLI
```

Во время `pnpm run dev:desktop` правки исходников пакетов не требуют ручной пересборки: пакеты, которые потребляет renderer, отдаются из исходников TypeScript (HMR), а изменения главного процесса Electron пересобираются задачами watch, после чего приложение перезапускается само.

| Команда                     | Описание                                        |
| --------------------------- | ----------------------------------------------- |
| `pnpm run dev:desktop:web`  | Renderer Desktop с веб-хостом в браузере        |
| `pnpm run dev:site`         | Маркетинговый и документационный сайт (Next.js) |
| `pnpm run build:agent-core` | Сборка только `@spiritagent/agent-core`         |
| `pnpm run build:cli`        | Release-сборка Rust CLI                         |
| `pnpm run eval:compare`     | Сравнение eval после изменений agent-core       |

См. [README.md — Разработка](README_ru.md#разработка) и README каждого приложения или пакета — там сведения, относящиеся к конкретному пакету.

## Хуки Git

`pnpm install` в корне репозитория запускает `prepare`, который задаёт локальный `core.hooksPath` равным `.githooks`. Хуки проверяют только index и никогда не переписывают файлы:

- **pre-commit:** `oxlint --deny-warnings` для проиндексированного TypeScript в `packages` / `apps/desktop` / `apps/site`; `oxfmt --check`, если среди проиндексированных файлов есть TypeScript или документация (другие форматируемые проиндексированные пути, которые подтягиваются вместе с ними, тоже входят); `cargo fmt --check` для проиндексированных файлов `.rs` в `apps/cli`; невидимый Unicode в проиндексированных блобах (`scripts/check-invisible-unicode.py --staged`)
- **commit-msg:** если первая строка уже выглядит как `type:` / `type(scope):`, требуется пробел после `:` и после каждой запятой в списке из нескольких scope. Subject для merge, revert, на китайском и другие свободные subject не отклоняются

`git commit --no-verify` пропускает хуки; используйте это только как запасной выход. Клон только с Rust, в котором ни разу не запускали `pnpm install`, может включить тот же путь командой `git config core.hooksPath .githooks` или `node scripts/setup-git-hooks.mjs`.

## Внесение изменений

1. Сделайте fork репозитория и создайте функциональную ветку от `main`
2. Держите коммиты сфокусированными, а diff — удобными для проверки
3. Стремитесь к совместимости между платформами (Windows, macOS, Linux), включая условную компиляцию там, где она нужна
4. Spirit находится в активной ранней разработке — при изменении форматов конфигурации или хранения предпочитайте прямые, развиваемые структуры тяжёлым прослойкам совместимости; если изменение ломающее, объясните причину и путь миграции в PR

## Имена веток

Если изменение ограничено **одним** приложением или пакетом, используйте `{type}/{scope}/{description}` (три сегмента через косую черту). **Не** пишите `{type}/{scope}-{description}`.

- `type`: тип Conventional Commits (`feat`, `fix`, `refactor`, `style`, `chore`, `ci`, …)
- `scope`: приложение или пакет (`desktop`, `cli`, `site`, `agent-core`, …), совпадает со `scope` коммита
- `description`: короткое описание в kebab-case

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

Сквозные изменения, которые затрагивают несколько приложений или пакетов, опускают сегмент scope: `{type}/{description}`.

## Сообщения коммитов

В проекте используются [Conventional Commits](https://www.conventionalcommits.org/):

- `type` и необязательный `scope` на английском (например, `feat(desktop)`, `fix(agent-core)`)
- **Subject и body на английском**; subject — одна строка, без точки в конце
- Body необязателен; если он есть, выберите формат, который подходит изменению: список `-` (один пункт на строку) для кратких тезисов или связные абзацы прозы, когда изменению нужно объяснение причины

Пример:

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

Соглашения о коммитах для сопровождающих и для стороны агента описаны в [AGENTS.md](../AGENTS.md).

## Тестирование и CI

Каждый push запускает [workflow Verify](../.github/workflows/verify.yml):

- `pnpm turbo run build` (пакеты TypeScript, Desktop и site)
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` и `pnpm exec oxfmt --check packages apps/desktop apps/site`
- `cargo build`, `cargo fmt --check`, `cargo clippy -D warnings` и `cargo test` для CLI

Перед открытием PR выполните локально то, что относится к изменению:

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # перед коммитом
pnpm --filter @spiritagent/agent-core test   # если вы меняли agent-core
cargo test -p spirit                   # если вы меняли CLI
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # если вы меняли видимое модели поведение agent-core
```

## Agent-core и изменения, видимые модели

Изменения системных промптов, определений инструментов или внедрения контекста могут повлиять на поведение агента на всех хостах. Для существенных правок:

- Запустите `pnpm run eval:compare` и просмотрите результаты
- По умолчанию оставляйте текст, видимый LLM, на английском
- Следуйте [`.github/instructions/llm-visible-copy.instructions.md`](../.github/instructions/llm-visible-copy.instructions.md)

Небольшие правки формулировок, орфографии или рефакторинги, не видимые модели, обычно не требуют полного прогона eval.

## Pull request

- Используйте ясный заголовок и описание: **что** изменилось, **зачем** и **как вы это проверили**
- Если PR должен закрыть Issue, завершите описание отдельной последней строкой `Closed #N` или `Fixed #N` (перед ней пустая строка). См. [AGENTS.md](../AGENTS.md#pull-requests-that-close-issues)
- Держите diff сфокусированным — несвязанная уборка относится к отдельному PR
- Отвечайте на замечания ревью своевременно

## Дополнительно

- [AGENTS.md](../AGENTS.md) — заметки об архитектуре, соглашения LLM и стратегия push/pull контекста
- [apps/desktop/README.md](../apps/desktop/README.md)
- [apps/site/README.md](../apps/site/README.md)
- [packages/agent-core/README.md](../packages/agent-core/README.md)

## Лицензия

Внося вклад, вы соглашаетесь, что ваши материалы лицензируются по [MIT License](../LICENSE).
