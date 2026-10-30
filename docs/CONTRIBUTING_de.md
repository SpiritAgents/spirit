# Zu Spirit beitragen

[English](../CONTRIBUTING.md) · [简体中文](CONTRIBUTING_zh-CN.md) · [繁體中文](CONTRIBUTING_zh-TW.md) · [日本語](CONTRIBUTING_ja.md) · [한국어](CONTRIBUTING_ko.md) · [Français](CONTRIBUTING_fr.md) · [Español](CONTRIBUTING_es.md) · [Português do Brasil](CONTRIBUTING_pt-BR.md) · [Русский](CONTRIBUTING_ru.md)

Vielen Dank für Ihr Interesse an Spirit! Dieses Projekt ist ein Open-Source-Monorepo eines werkzeugnutzenden Coding-Agents: Desktop (Electron), CLI (Rust), ein gemeinsamer Daemon (`packages/server`) und die Kern-Runtime (`packages/agent-core`). Ob Sie Dokumentation korrigieren, Bugs beheben oder neue Funktionen bauen: Ihre Hilfe ist willkommen. Wenn Sie nicht wissen, wo Sie anfangen sollen, öffnen Sie gern ein Issue und sagen Sie Hallo.

## Bevor Sie beitragen

**Öffnen Sie bei größeren Änderungen zuerst ein Issue**, damit wir die Richtung abstimmen können, bevor Sie erheblichen Aufwand investieren. Beispiele:

- Neue Funktionen oder wesentliche UX-Änderungen
- Änderungen an öffentlicher API, am Protokoll oder am Konfigurations- / Persistenzformat
- Refactors über mehrere Pakete hinweg
- Änderungen an Prompts, Tool-Verträgen oder der Kontextinjektion, die das Agent-Verhalten ändern

**Kleinere Änderungen können direkt als Pull Request kommen**, zum Beispiel:

- Aktualisierungen von Dokumentation, README oder Kommentaren
- Rechtschreib- und Stilkorrekturen
- Gezielte Bugfixes mit klarer, begrenzter Verhaltenswirkung

Im Zweifel ist ein kurzes Issue meist schneller als ein großer PR, der nachgearbeitet werden muss.

## Programmieren mit Agenten

Code mit Cursor, Copilot oder anderen Agent-Werkzeugen zu schreiben, ist willkommen — aber **Sie bleiben für den Diff verantwortlich, den Sie einreichen**:

- Können Sie erklären, _warum_ eine Änderung gemacht wurde, und nicht nur, dass ein Modell sie erzeugt hat
- Prüfen Sie die Agent-Ausgabe: Entfernen Sie sachfremde Edits, duplizierte Logik und unnötige Verteidigungsschichten
- Behandeln Sie **modellsichtbaren Text** (System-Prompts, Tool-Namen und -Beschreibungen, Eval-Text) mit besonderer Sorgfalt — knapp, auf Englisch, und ohne Fähigkeiten zu wiederholen, die im `tools`-Feld der Anfrage bereits deklariert sind
- Nennen Sie in der PR-Beschreibung Motivation, Auswirkung und wie Sie die Änderung geprüft haben

Agenten können die Umsetzung beschleunigen. Sie können Ihr Urteil nicht ersetzen.

## Architektur und Umfang

Spirit hat ein klares Schichtenmodell. Lesen Sie vor Änderungen an mehreren Paketen [`.github/instructions/agent-core-host-boundary.instructions.md`](../.github/instructions/agent-core-host-boundary.instructions.md):

| Schicht               | Pfad                                                                              | Rolle                                                       |
| --------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Agentensemantik       | `packages/agent-core`                                                             | Runtime, Prompts, Tool-Verträge, MCP, Transports            |
| Gemeinsame Host-Logik | `packages/host-internal`                                                          | Discovery, Extensions, Workspace-Helfer, LSP-Orchestrierung |
| Hosts / Adapter       | `apps/desktop`, `apps/cli`, `apps/site`, `packages/server`, `packages/acp-server` | Dünne, plattformspezifische UI und Ausführung               |

Duplizieren Sie Tool-Definitionen oder Prompts nicht zwischen CLI und Desktop. Neue Tool-Verträge gehören in `agent-core`; die Ausführung gehört in den Host.

## Entwicklungsumgebung

**Anforderungen:** Node.js 26.13.0, pnpm 12.4.2 (Installation mit `npm install --global pnpm@12.4.2`) und die Rust-Toolchain (für die CLI).

```bash
pnpm install          # einmal, im Repo-Root
pnpm run dev:desktop  # Desktop (Vite + Electron)
pnpm run dev:site     # Marketing- und Dokumentationssite (Next.js)
pnpm run dev:cli      # CLI mit TUI
pnpm run build        # Produktionsbuild der TS-Pakete + Desktop + site + CLI
```

Während `pnpm run dev:desktop` brauchen Änderungen am Paketquelltext keinen manuellen Rebuild: Vom Renderer genutzte Pakete werden aus ihren TypeScript-Quellen ausgeliefert (HMR), und Änderungen am Electron-Hauptprozess werden über Watch-Tasks neu gebaut; die App startet automatisch neu.

| Befehl                      | Beschreibung                                |
| --------------------------- | ------------------------------------------- |
| `pnpm run dev:desktop:web`  | Desktop-Renderer mit Browser-Web-Host       |
| `pnpm run dev:site`         | Marketing- und Dokumentationssite (Next.js) |
| `pnpm run build:agent-core` | Nur `@spiritagent/agent-core` bauen         |
| `pnpm run build:cli`        | Release-Build der Rust-CLI                  |
| `pnpm run eval:compare`     | Eval-Vergleich nach agent-core-Änderungen   |

Siehe [README.md — Entwicklung](README_de.md#entwicklung) und die README jeder App bzw. jedes Pakets für paketspezifische Details.

## Git-Hooks

`pnpm install` im Repo-Root führt `prepare` aus und setzt das lokale `core.hooksPath` auf `.githooks`. Die Hooks prüfen nur den Index und schreiben Dateien nie um:

- **pre-commit:** `oxlint --deny-warnings` für gestagtes TypeScript unter `packages` / `apps/desktop` / `apps/site`; `oxfmt --check`, wenn gestagte Dateien TypeScript oder Docs enthalten (andere formatierbare gestagte Pfade, die mitlaufen, sind eingeschlossen); `cargo fmt --check` für gestagte `.rs`-Dateien unter `apps/cli`; unsichtbares Unicode in gestagten Blobs (`scripts/check-invisible-unicode.py --staged`)
- **commit-msg:** Sieht die erste Zeile bereits aus wie `type:` / `type(scope):`, wird ein Leerzeichen nach `:` und nach jedem Komma in einer Liste mit mehreren Scopes verlangt. Merge, Revert, Chinesisch und andere freie Subjects werden nicht abgelehnt

`git commit --no-verify` überspringt die Hooks; nutzen Sie es nur als Notausweg. Ein reiner Rust-Clone, der nie `pnpm install` ausführt, kann denselben Pfad mit `git config core.hooksPath .githooks` oder `node scripts/setup-git-hooks.mjs` aktivieren.

## Änderungen vornehmen

1. Forken Sie das Repository und legen Sie einen Feature-Branch von `main` an
2. Halten Sie Commits fokussiert und Diffs gut prüfbar
3. Streben Sie Kompatibilität über Plattformen an (Windows, macOS, Linux), einschließlich bedingter Kompilierung, wo sie nötig ist
4. Spirit ist in aktiver früher Entwicklung — wenn Sie Konfigurations- oder Persistenzformate ändern, bevorzugen Sie direkte, weiterentwickelbare Strukturen gegenüber schweren Kompatibilitäts-Shims; ist eine Änderung breaking, erklären Sie Begründung und Migrationspfad im PR

## Branch-Namen

Ist die Änderung auf **eine** App oder **ein** Paket begrenzt, verwenden Sie `{type}/{scope}/{description}` (drei durch Schrägstriche getrennte Segmente). Schreiben Sie **nicht** `{type}/{scope}-{description}`.

- `type`: Conventional-Commits-Typ (`feat`, `fix`, `refactor`, `style`, `chore`, `ci`, …)
- `scope`: die App oder das Paket (`desktop`, `cli`, `site`, `agent-core`, …), passend zum `scope` des Commits
- `description`: kurze Zusammenfassung in kebab-case

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

Querschnittsänderungen, die mehrere Apps oder Pakete betreffen, lassen das Scope-Segment weg: `{type}/{description}`.

## Commit-Nachrichten

Dieses Projekt verwendet [Conventional Commits](https://www.conventionalcommits.org/):

- `type` und optionales `scope` auf Englisch (z. B. `feat(desktop)`, `fix(agent-core)`)
- **Subject und Body auf Englisch**; das Subject ist eine Zeile, ohne abschließenden Punkt
- Der Body ist optional; wenn vorhanden, wählen Sie das Format, das zur Änderung passt: eine `-`-Liste (ein Punkt pro Zeile) für zusammenfassende Kernpunkte, oder fortlaufende Prosaabsätze, wenn die Änderung ihre Begründung braucht

Beispiel:

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

Commit-Konventionen für Maintainer und für die Agent-Seite stehen in [AGENTS.md](../AGENTS.md).

## Tests und CI

Jeder Push führt den [Verify-Workflow](../.github/workflows/verify.yml) aus:

- `pnpm turbo run build` (TypeScript-Pakete, Desktop und site)
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` und `pnpm exec oxfmt --check packages apps/desktop apps/site`
- `cargo build`, `cargo fmt --check`, `cargo clippy -D warnings` und `cargo test` für die CLI

Führen Sie vor dem Öffnen eines PR lokal aus, was zutrifft:

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # vor dem Commit
pnpm --filter @spiritagent/agent-core test   # wenn Sie agent-core geändert haben
cargo test -p spirit                   # wenn Sie die CLI geändert haben
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # wenn Sie modellsichtbares agent-core-Verhalten geändert haben
```

## Agent-core und modellsichtbare Änderungen

Änderungen an System-Prompts, Tool-Definitionen oder der Kontextinjektion können das Agent-Verhalten auf allen Hosts beeinflussen. Bei wesentlichen Bearbeitungen:

- Führen Sie `pnpm run eval:compare` aus und prüfen Sie die Ergebnisse
- Belassen Sie LLM-sichtbaren Text standardmäßig auf Englisch
- Folgen Sie [`.github/instructions/llm-visible-copy.instructions.md`](../.github/instructions/llm-visible-copy.instructions.md)

Kleine Formulierungs- oder Rechtschreibkorrekturen und Refactors, die für das Modell nicht sichtbar sind, brauchen in der Regel keinen vollständigen Eval-Lauf.

## Pull Requests

- Verwenden Sie einen klaren Titel und eine klare Beschreibung: **was** sich geändert hat, **warum**, und **wie Sie es getestet haben**
- Soll der PR ein Issue schließen, beenden Sie die Beschreibung mit einer eigenen letzten Zeile `Closed #N` oder `Fixed #N` (darüber eine Leerzeile). Siehe [AGENTS.md](../AGENTS.md#pull-requests-that-close-issues)
- Halten Sie den Diff fokussiert — Aufräumarbeiten ohne Bezug gehören in einen eigenen PR
- Antworten Sie zeitnah auf Review-Feedback

## Weiterführende Hinweise

- [AGENTS.md](../AGENTS.md) — Architekturnotizen, LLM-Konventionen und die Strategie für Kontext-Push/Pull
- [apps/desktop/README.md](../apps/desktop/README.md)
- [apps/site/README.md](../apps/site/README.md)
- [packages/agent-core/README.md](../packages/agent-core/README.md)

## Lizenz

Mit Ihrem Beitrag stimmen Sie zu, dass Ihre Beiträge unter der [MIT License](../LICENSE) lizenziert werden.
