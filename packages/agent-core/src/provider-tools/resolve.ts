import { isOpenAiFunctionToolEntry, type ProviderToolEntry } from "./types.js";

/** Name of an OpenAI-function-shaped tool entry; other shapes contribute nothing to recognition. */
export function openAiFunctionToolName(tool: unknown): string | undefined {
  return isOpenAiFunctionToolEntry(tool) ? tool.function.name : undefined;
}

/** Declared OpenAI function interception names from the entries' literal `tools` arrays. */
export function collectDeclaredProviderToolNames(
  entries: readonly ProviderToolEntry[],
): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) {
    for (const tool of entry.tools ?? []) {
      const name = openAiFunctionToolName(tool);
      if (name !== undefined) {
        names.add(name);
      }
    }
  }
  return names;
}

/**
 * Local tools win name collisions with provider-declared tools: colliding names are skipped
 * per-name (the rest of the entry is unaffected) with one console warning each.
 */
export function resolveProviderToolNamesAgainstLocal(
  declaredNames: Iterable<string>,
  localToolNames: ReadonlySet<string>,
): { names: Set<string>; skipped: string[] } {
  const names = new Set<string>();
  const skipped: string[] = [];
  for (const name of declaredNames) {
    if (localToolNames.has(name)) {
      if (!skipped.includes(name)) {
        skipped.push(name);
        console.warn(
          `Provider tool "${name}" conflicts with a local tool; the local tool wins and the provider tool is skipped.`,
        );
      }
      continue;
    }
    names.add(name);
  }
  return { names, skipped };
}

/**
 * Endpoint URL shared by providerTools execution and fileUpload declarations:
 * absolute `url` wins; otherwise `path` joins onto the provider `apiBase`.
 */
export function resolveProviderEndpointUrl(
  apiBase: string,
  endpoint: { path?: string | undefined; url?: string | undefined },
): string {
  const url = endpoint.url?.trim();
  if (url) {
    return url;
  }
  const base = apiBase.trim().replace(/\/+$/, "");
  const path = endpoint.path?.trim() ?? "";
  if (!base || !path) {
    throw new Error(
      "Cannot resolve the provider endpoint URL: an absolute url, or a path plus a non-empty apiBase, is required.",
    );
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
