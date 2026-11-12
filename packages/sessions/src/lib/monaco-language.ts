export function monacoLanguageId(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    jsonc: "json",
    md: "markdown",
    mdx: "markdown",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    html: "html",
    htm: "html",
    yml: "yaml",
    yaml: "yaml",
    rs: "rust",
    py: "python",
    toml: "ini",
    xml: "xml",
    svg: "xml",
    sql: "sql",
    sh: "shell",
    ps1: "powershell",
  };
  return map[ext] ?? "plaintext";
}
