# @spiritagent/ui

Shared React primitives for Spirit desktop and the marketing site. Apps supply theme tokens; this package supplies controls, overlays, and motion.

## Requirements

- Node.js 26.13.0
- React 18+
- Tailwind CSS v4 (scan `src` with `@source` and import `theme.css`)

## Model Picker

Hosts supply `ModelPickerLabelsProvider` and `ModelPickerRuntimeProvider` around their pickers. The shared tooltip host may sit above these providers; [`ModelPickerMenu`](src/model-picker/model-picker-menu.tsx) carries each picker's current labels and runtime into its registered inspector content so hover details retain the same context as the menu.

## Markdown and Diff Rendering

The `@spiritagent/ui/rendering` entry point supplies native Markdown, Mermaid,
highlighted unified diffs, and text-selection actions. Import
`@spiritagent/ui/rendering/styles.css` alongside the host's Tailwind stylesheet.
These components use the same rendering implementation in the workbench and
extension pages; they do not import workbench state, navigation controllers, or
filesystem services.

Pass the resolved theme to `SpiritStreamdownMarkdown`, provide link handling
through `WorkspaceMarkdownLinkProvider`, and supply media readers explicitly
when local or managed media is allowed. Localization comes from the caller's
React i18next provider. Rendering-specific dependencies are optional peers for
consumers that only use the basic controls.

## License

MIT — see [LICENSE](LICENSE) and the [Spirit repository](https://github.com/SpiritAgents/spirit).
