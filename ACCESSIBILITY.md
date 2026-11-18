# Accessibility at Spirit

Last updated: 2026-11-18

[简体中文](docs/ACCESSIBILITY_zh-CN.md) · [繁體中文](docs/ACCESSIBILITY_zh-TW.md) · [日本語](docs/ACCESSIBILITY_ja.md) · [한국어](docs/ACCESSIBILITY_ko.md) · [Deutsch](docs/ACCESSIBILITY_de.md) · [Français](docs/ACCESSIBILITY_fr.md) · [Español](docs/ACCESSIBILITY_es.md) · [Português do Brasil](docs/ACCESSIBILITY_pt-BR.md) · [Русский](docs/ACCESSIBILITY_ru.md)

Spirit is under active development. This statement records current accessibility work, supported workflows, and verification coverage.

## Priorities and current work

Spirit's current accessibility work prioritizes keyboard operation, visible focus, meaningful control semantics, and reduced motion in the shared React Workbench used by Desktop and the optional web host.

[PR #437: fix(web): improve keyboard navigation and focus indicators](https://github.com/SpiritAgents/spirit/pull/437) added and tested the following behavior in covered views:

- Shared [roving-focus primitives](packages/ui/src/roving-focus-group.tsx) for linear lists, visual grids, virtualized lists, and actions belonging to the current row.
- Arrow-key navigation, with Home and End where implemented, in model and provider lists, extension source tabs and catalogs, automation lists and history, workspace file trees, Git lists, tool tabs, and the session sidebar.
- A single main Tab entry for covered composite lists, while keeping current-row actions keyboard reachable.
- Keyboard-focused item details in the shared tooltip implementation, including closing details on blur or Escape and associating descriptions through `aria-describedby`.
- Focus indicators that remain distinct from pointer hover styling, including sidebar rows and inline actions.

The Workbench also has a Reduce Motion preference with System, On, and Off choices. The [implementation](packages/web/src/lib/reduce-motion.ts) follows the operating system's `prefers-reduced-motion` setting in System mode and provides a shared document state used by motion-aware styles and behavior.

Parts of the React UI use native controls, ARIA roles, accessible names, state attributes such as `aria-current`, `aria-expanded`, and `aria-selected`, and status or alert roles. Decorative icons in the shared icon helper are hidden from assistive technology unless accessibility properties or child content are supplied. These implementation details provide semantic hooks for assistive technologies. Current verification emphasizes keyboard and focus behavior.

## Contributor expectations

Human contributors and coding agents changing interactive UI should:

- Preserve keyboard operation, visible focus, and meaningful names, roles, and states. Reuse the existing shared controls and roving-focus primitives where they fit.
- Keep focus movement separate from activation unless the established control pattern explicitly links them. Keep actions that were once pointer-oriented available in the keyboard path too.
- Add or update focused regression tests for changed behavior. Existing examples include [roving-focus tests](packages/web/test/components/roving-focus-group.test.tsx), [composite-list tests](packages/web/test/components/keyboard-lists.test.tsx), [sidebar keyboard tests](packages/web/test/components/session-sidebar-keyboard.test.tsx), and [workspace keyboard tests](packages/web/test/components/workspace-keyboard.test.tsx).
- Run relevant checks and report the verification scope. For Workbench changes, the available package commands are:

```bash
pnpm --filter @spiritagent/web test
pnpm --filter @spiritagent/web typecheck
```

The [Verify workflow](.github/workflows/verify.yml) runs TypeScript builds, tests, typechecks, oxlint, and oxfmt, together with Rust checks. See [Contributing to Spirit](CONTRIBUTING.md#testing-and-ci) for the repository's general guidance.

Use Vitest and jsdom for regression evidence, and record assistive-technology testing separately. Pull requests should identify relevant manual checks and verification gaps.

## Reporting accessibility barriers

[Open an accessibility barrier report using Spirit's bug report form](https://github.com/SpiritAgents/spirit/issues/new?template=bug_report.md). Include “Accessibility” in the issue title so the report is easy to recognize.

Describe the affected task or page, what you expected, and what happened. Useful context can include the Spirit version, operating system, input method, browser when using the web host, and any assistive technology involved. Provide only the context you are comfortable sharing.

A text description is enough. Disability context, screenshots, recordings, and logs are optional. Include supporting material when it helps and you are comfortable sharing it. Redact API keys, tokens, and private paths from any logs you share.

## Response and tracking

Accessibility reports use the same GitHub issue and pull request workflow as other Spirit bugs. Maintainers assess and prioritize reports during triage. Status and implementation discussion live in the issue and linked pull requests.

## Environment coverage

- **Desktop:** Spirit's Electron shell targets Windows, macOS, and Linux.
- **Web host:** Desktop and the optional web host share the React Workbench renderer and its keyboard-focused regression suite.
- **Keyboard input:** Automated tests cover the specific navigation and focus behaviors described above in the shared React Workbench.
- **Screen readers and other assistive technology:** The source includes semantic controls, accessible names, state attributes, and live status elements. Detailed results for specific assistive technologies can be added as they are verified.
- **CLI and terminal UI:** Spirit includes a Rust CLI and optional terminal UI. Accessibility evaluation remains an open area for these hosts.

## Current coverage gaps

- The keyboard work in PR #437 covers specific React views and shared primitives. Monaco editor content, embedded terminals, the in-app browser, extension-contributed UI, and other embedded or third-party content remain additional evaluation areas.
- End-to-end screen-reader evaluation remains open for streamed messages, dynamic updates, dialogs, and complex content. Existing tests focus on DOM roles and keyboard interactions.

## Ownership and maintenance

Spirit maintainers review changes to this statement through the project's normal pull request process.

Contributors changing supported behavior, test coverage, or known barriers should propose corresponding updates to this statement in the same pull request. Translations should preserve the English version's distinctions between implemented behavior and its verification status.

## Feedback and improvements

To suggest an improvement to this statement or Spirit's accessibility practices, [open a feature request](https://github.com/SpiritAgents/spirit/issues/new?template=feature_request.md) or propose a focused documentation pull request. Use the [accessibility barrier reporting path](#reporting-accessibility-barriers) above for an active problem using Spirit.
