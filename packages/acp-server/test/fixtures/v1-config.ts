import type { ModelRef, ProviderEntry } from "@spiritagent/host-internal";

export function v1ConfigFixture(input: {
  providers: ProviderEntry[];
  activeModel: ModelRef;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    providers: input.providers,
    activeModel: input.activeModel,
    ...input.extra,
  };
}

export function openAiProvider(models: ProviderEntry["models"]): ProviderEntry {
  return {
    id: "openai",
    apiBase: "https://api.openai.com/v1",
    transportKind: "open-responses",
    models,
  };
}
