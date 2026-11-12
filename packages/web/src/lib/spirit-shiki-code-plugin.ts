import { createCodePlugin } from "@streamdown/code";

import { SPIRIT_SHIKI_PLUS_THEMES } from "@/lib/spirit-shiki-themes";

/** Shiki highlighting plugin shared by Streamdown and tool card UIs. */
export const spiritShikiCodePlugin = createCodePlugin({
  themes: [...SPIRIT_SHIKI_PLUS_THEMES],
});
