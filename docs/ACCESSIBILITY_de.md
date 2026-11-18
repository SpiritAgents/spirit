# Barrierefreiheit bei Spirit

Zuletzt aktualisiert: 2026-11-18

[English](../ACCESSIBILITY.md) · [简体中文](ACCESSIBILITY_zh-CN.md) · [繁體中文](ACCESSIBILITY_zh-TW.md) · [日本語](ACCESSIBILITY_ja.md) · [한국어](ACCESSIBILITY_ko.md) · [Français](ACCESSIBILITY_fr.md) · [Español](ACCESSIBILITY_es.md) · [Português do Brasil](ACCESSIBILITY_pt-BR.md) · [Русский](ACCESSIBILITY_ru.md)

Spirit wird aktiv weiterentwickelt. Diese Erklärung dokumentiert die aktuelle Arbeit an Barrierefreiheit, unterstützte Workflows und den Umfang der Verifizierung.

## Prioritäten und aktuelle Arbeit

Die aktuelle Arbeit an Barrierefreiheit konzentriert sich auf Tastaturbedienung, sichtbaren Fokus, aussagekräftige Steuerelement-Semantik und reduzierte Bewegung im gemeinsamen React Workbench, das Desktop und der optionale Web-Host verwenden.

[PR #437: fix(web): improve keyboard navigation and focus indicators](https://github.com/SpiritAgents/spirit/pull/437) hat in den abgedeckten Ansichten das folgende Verhalten implementiert und getestet:

- Gemeinsame [Roving-Focus-Primitive](../packages/ui/src/roving-focus-group.tsx) für lineare Listen, visuelle Raster, virtualisierte Listen und Aktionen der aktuellen Zeile.
- Navigation mit Pfeiltasten sowie Home und Ende an den implementierten Stellen in Modell- und Anbieterlisten, Quell-Tabs und Katalogen für Erweiterungen, Automatisierungslisten und -verläufen, Workspace-Dateibäumen, Git-Listen, Tool-Tabs und der Sitzungsseitenleiste.
- Ein einziger Haupt-Tab-Einstiegspunkt für abgedeckte zusammengesetzte Listen, während Aktionen der aktuellen Zeile weiterhin per Tastatur erreichbar bleiben.
- Per Tastatur fokussierte Elementdetails in der gemeinsamen Tooltip-Implementierung, einschließlich Schließen bei Fokusverlust oder Escape und Verknüpfung von Beschreibungen über `aria-describedby`.
- Fokusindikatoren, die vom Hover-Stil des Zeigers getrennt bleiben, einschließlich Seitenleistenzeilen und Inline-Aktionen.

Die Workbench bietet außerdem eine Einstellung für reduzierte Bewegung mit den Optionen System, Ein und Aus. Die [Implementierung](../packages/web/src/lib/reduce-motion.ts) folgt im Systemmodus der Betriebssystemeinstellung `prefers-reduced-motion` und stellt einen gemeinsamen Dokumentzustand für bewegungsabhängige Stile und Verhalten bereit.

Teile der React-Benutzeroberfläche verwenden native Steuerelemente, ARIA-Rollen, zugängliche Namen, Zustandsattribute wie `aria-current`, `aria-expanded` und `aria-selected` sowie Status- oder Warnrollen. Der gemeinsame Icon-Helfer blendet dekorative Icons standardmäßig für assistive Technologien aus, wenn keine Barrierefreiheitsattribute oder Kindinhalte angegeben sind. Diese Implementierung bietet semantische Anknüpfungspunkte für assistive Technologien. Der aktuelle Verifizierungsschwerpunkt liegt auf Tastatur- und Fokusverhalten.

## Erwartungen an Beitragende

Menschen und Coding-Agenten, die interaktive Benutzeroberflächen ändern, sollten:

- Tastaturbedienung, sichtbaren Fokus sowie aussagekräftige Namen, Rollen und Zustände bewahren. Vorhandene gemeinsame Steuerelemente und Roving-Focus-Primitive wiederverwenden, wo sie passen.
- Fokusbewegung und Aktivierung standardmäßig getrennt halten und sie nur nach dem etablierten Steuerelementmuster verknüpfen. Auch für zuvor zeigerorientierte Aktionen einen Tastaturpfad beibehalten.
- Gezielte Regressionstests für geändertes Verhalten hinzufügen oder aktualisieren. Vorhandene Beispiele sind [Roving-Focus-Tests](../packages/web/test/components/roving-focus-group.test.tsx), [Tests für zusammengesetzte Listen](../packages/web/test/components/keyboard-lists.test.tsx), [Tastaturtests der Seitenleiste](../packages/web/test/components/session-sidebar-keyboard.test.tsx) und [Workspace-Tastaturtests](../packages/web/test/components/workspace-keyboard.test.tsx).
- Relevante Prüfungen ausführen und den Verifizierungsumfang angeben. Für Workbench-Änderungen stehen folgende Paketbefehle zur Verfügung:

```bash
pnpm --filter @spiritagent/web test
pnpm --filter @spiritagent/web typecheck
```

Der [Verify-Workflow](../.github/workflows/verify.yml) führt TypeScript-Builds, Tests, Typprüfungen, oxlint und oxfmt sowie Rust-Prüfungen aus. Allgemeine Hinweise enthält der [Leitfaden für Beitragende](../CONTRIBUTING.md#testing-and-ci).

Vitest und jsdom liefern Regressionsnachweise; Tests mit assistiven Technologien werden separat dokumentiert. Pull Requests sollten relevante manuelle Prüfungen und Verifizierungslücken benennen.

## Barrierefreiheit melden

[Melden Sie eine Barriere über das Spirit-Formular für Fehlerberichte](https://github.com/SpiritAgents/spirit/issues/new?template=bug_report.md). Nehmen Sie „Accessibility“ in den Titel des Issues auf, damit der Bericht leicht zu erkennen ist.

Beschreiben Sie die betroffene Aufgabe oder Seite, das erwartete und das tatsächliche Verhalten. Hilfreiche Angaben sind Spirit-Version, Betriebssystem, Eingabemethode, Browser bei Verwendung des Web-Hosts und gegebenenfalls eingesetzte assistive Technologien. Teilen Sie nur Informationen, die Sie preisgeben möchten.

Eine Meldung kann auch nur eine Textbeschreibung enthalten. Angaben zur Behinderung, Screenshots, Aufnahmen und Protokolle sind freiwillig. Ergänzen Sie Material, wenn es bei der Eingrenzung hilft und Sie es teilen möchten. Entfernen Sie API-Schlüssel, Token und private Pfade aus Protokollen vor dem Teilen.

## Reaktion und Nachverfolgung

Meldungen zur Barrierefreiheit verwenden denselben GitHub-Issue- und Pull-Request-Workflow wie andere Spirit-Fehler. Maintainer bewerten und priorisieren Meldungen beim Triage. Status und Implementierungsdiskussionen werden im Issue und in verknüpften Pull Requests dokumentiert.

## Abdeckung nach Umgebung

- **Desktop:** Die Electron-Shell von Spirit zielt auf Windows, macOS und Linux.
- **Web-Host:** Desktop und der optionale Web-Host verwenden denselben React-Workbench-Renderer und dieselbe Regressionssuite für Tastaturfokus.
- **Tastatureingabe:** Automatisierte Tests decken die oben beschriebenen Navigations- und Fokusverhalten in der gemeinsamen React Workbench ab.
- **Screenreader und andere assistive Technologien:** Der Quellcode enthält semantische Steuerelemente, zugängliche Namen, Zustandsattribute und Live-Statuselemente. Detaillierte Ergebnisse für bestimmte assistive Technologien können nach ihrer Verifizierung ergänzt werden.
- **CLI und Terminal-UI:** Spirit enthält eine Rust-CLI und eine optionale Terminal-UI. Die Bewertung ihrer Barrierefreiheit bleibt ein offener Arbeitsbereich.

## Aktuelle Lücken in der Abdeckung

- Die Tastaturarbeit in PR #437 umfasst bestimmte React-Ansichten und gemeinsame Primitive. Monaco-Editor-Inhalte, eingebettete Terminals, der In-App-Browser, von Erweiterungen bereitgestellte UI und andere eingebettete oder Drittanbieter-Inhalte sind weitere Bewertungsbereiche.
- Gestreamte Nachrichten, dynamische Aktualisierungen, Dialoge und komplexe Inhalte bleiben Teil der durchgehenden Screenreader-Bewertung. Die vorhandenen Tests konzentrieren sich auf DOM-Rollen und Tastaturinteraktionen.

## Verantwortung und Pflege

Spirit-Maintainer prüfen Änderungen an dieser Erklärung im regulären Pull-Request-Prozess des Projekts.

Beitragende, die unterstütztes Verhalten, Testabdeckung oder bekannte Barrieren ändern, sollten im selben Pull Request eine Aktualisierung dieser Erklärung vorschlagen. Übersetzungen sollten die Unterscheidung der englischen Version zwischen implementiertem Verhalten und dessen Verifizierungsstatus bewahren.

## Feedback und Verbesserungen

Um Verbesserungen an dieser Erklärung oder den Barrierefreiheitspraktiken von Spirit vorzuschlagen, [erstellen Sie einen Feature-Request](https://github.com/SpiritAgents/spirit/issues/new?template=feature_request.md) oder einen fokussierten Dokumentations-Pull-Request. Bei einem aktuellen Problem mit Spirit verwenden Sie bitte den oben beschriebenen [Weg zum Melden von Barrierefreiheit](#barrierefreiheit-melden).
