import {
  modelRefKey,
  resolveModelByRef,
  resolveModelEntry,
  type ModelRef,
  type ProviderEntry,
} from "./schema.js";

/** Stable, fully-qualified model choices exposed to the subagent tool. */
export function listSubagentLanguageModelSelectors(providers: readonly ProviderEntry[]): string[] {
  const selectors = new Set<string>();
  for (const provider of providers) {
    for (const model of provider.models) {
      const resolved = resolveModelEntry(provider, model.name);
      if (resolved?.capabilities?.includes("languageModel")) {
        selectors.add(modelRefKey({ providerId: provider.id, name: model.name }));
      }
    }
  }
  return [...selectors].sort();
}

/** Resolve one explicit subagent model without guessing among same-named provider entries. */
export function resolveSubagentLanguageModelSelector(
  providers: readonly ProviderEntry[],
  selector: string,
): ModelRef {
  const normalized = selector.trim();
  const separator = normalized.indexOf("::");
  const providerId = separator < 0 ? "" : normalized.slice(0, separator).trim();
  const name = separator < 0 ? "" : normalized.slice(separator + 2).trim();
  if (!providerId || !name) {
    throw new Error(
      `Invalid subagent model selector ${JSON.stringify(selector)}; expected providerId::modelId.`,
    );
  }

  const ref = { providerId, name };
  const resolved = resolveModelByRef(providers, ref);
  if (!resolved) {
    throw new Error(`Unknown subagent model selector ${JSON.stringify(modelRefKey(ref))}.`);
  }
  if (!resolved.model.capabilities?.includes("languageModel")) {
    throw new Error(`Subagent model ${JSON.stringify(modelRefKey(ref))} is not a language model.`);
  }
  return { providerId: resolved.provider.id, name: resolved.model.name };
}
