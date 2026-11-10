/**
 * The lazy tool_call request rides in argsExcerpt as pretty-printed JSON
 * (`{provider, server, tool, arguments}`). The MCP expanded body shows the model's `arguments`
 * payload as its Input; everything else (built-in providers, truncated excerpts, missing
 * arguments) returns undefined and the card keeps the generic body.
 */
export function resolveLazyMcpToolCallInputJson(
  argsExcerpt: string | undefined,
): string | undefined {
  const raw = argsExcerpt?.trim();
  if (!raw) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  if (record.provider !== "mcp" || !("arguments" in record)) {
    return undefined;
  }
  return JSON.stringify(record.arguments, null, 2);
}
