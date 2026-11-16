import { createCodePlugin } from "@streamdown/code";

import { SPIRIT_SHIKI_PLUS_THEMES } from "./spirit-shiki-themes.js";

/** Shiki highlighting plugin shared by Streamdown and tool card UIs. */
export const spiritShikiCodePlugin = createCodePlugin({
  themes: [...SPIRIT_SHIKI_PLUS_THEMES],
});
