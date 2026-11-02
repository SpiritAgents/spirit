# @spiritagent/ui

Shared React primitives for Spirit desktop and the marketing site. Apps supply theme tokens; this package supplies controls, overlays, and motion.

## Requirements

- Node.js 26.13.0
- React 18+
- Tailwind CSS v4 (scan `src` with `@source` and import `theme.css`)

## Model Picker

Hosts supply `ModelPickerLabelsProvider` and `ModelPickerRuntimeProvider` around their pickers. The shared tooltip host may sit above these providers; [`ModelPickerMenu`](src/model-picker/model-picker-menu.tsx) carries each picker's current labels and runtime into its registered inspector content so hover details retain the same context as the menu.

## License

MIT — see [LICENSE](LICENSE) and the [Spirit repository](https://github.com/SpiritAgents/spirit).
