/** Shiki VS Code themes shared by Streamdown and Workspace Monaco (matching the @streamdown/code defaults). */
export const SPIRIT_SHIKI_PLUS_THEMES = ["light-plus", "dark-plus"] as const;

export type SpiritShikiPlusTheme = (typeof SPIRIT_SHIKI_PLUS_THEMES)[number];

export const SPIRIT_MONACO_SHIKI_LIGHT = "light-plus" satisfies SpiritShikiPlusTheme;
export const SPIRIT_MONACO_SHIKI_DARK = "dark-plus" satisfies SpiritShikiPlusTheme;

/** Shiki grammars for common Workspace file-tree extensions (aligned with monacoLanguageId). */
export const SPIRIT_SHIKI_WORKSPACE_LANGS = [
  "typescript",
  "javascript",
  "json",
  "markdown",
  "css",
  "scss",
  "less",
  "html",
  "yaml",
  "rust",
  "python",
  "xml",
  "sql",
  "shell",
  "powershell",
  "ini",
] as const;
