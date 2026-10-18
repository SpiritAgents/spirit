import type { JsonObject } from "../ports.js";
import { openAiFunctionToolName, resolveProviderToolNamesAgainstLocal } from "./resolve.js";
import { fetchProviderToolsFrom } from "./tools-from.js";
import {
  isOpenAiFunctionToolEntry,
  isPlainJsonObject,
  type OpenAiFunctionToolEntry,
  type ProviderToolEntry,
  type ProviderToolExecuteDeclaration,
} from "./types.js";

type FetchFn = typeof fetch;

/**
 * Minimal structural read of a transport config for providerTools resolution; every transport
 * config carrying `providerTools` satisfies it. `providerToolsEnabled === false` is the global
 * opt-out gate (`agents.providerTools.enabled: false`): nothing is injected, recognized, or merged.
 */
export interface DeclaredProviderToolsConfig {
  providerTools?: ProviderToolEntry[];
  providerToolsEnabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
}

export interface ResolvedProviderToolExecution {
  entry: ProviderToolEntry;
  execute: ProviderToolExecuteDeclaration;
  /** Declared JSON schema for fail-fast argument validation; absent = permissive. */
  parameters?: JsonObject;
}

export interface ResolvedProviderToolDisplay {
  label?: string;
  /** Entry `ui.expand === false`: the UI must not expand the call's details (e.g. ciphertext output). */
  suppressExpand: boolean;
}

export interface ResolvedProviderTools {
  /**
   * OpenAI-function-shaped tools (literal `tools` + `toolsFrom`-fetched), after the per-name
   * collision filter (local host/MCP/extension tools win). Merged into the request `tools[]`.
   */
  functionTools: OpenAiFunctionToolEntry[];
  /**
   * Literal entries not in OpenAI function shape (transport-native passthrough such as server
   * tools), after the collision filter. Merged verbatim into the request `tools[]`.
   */
  literalEntries: JsonObject[];
  /** Entry-level `body` patches in declaration order (merged only while provider tools are enabled). */
  bodyPatches: JsonObject[];
  /** Host-executed calls by tool name (entries carrying `execute`). */
  executions: Map<string, ResolvedProviderToolExecution>;
  /** Every recognized provider tool name (host-executed and in-band/upstream-executed). */
  recognizedNames: Set<string>;
  /** Display bridge per recognized name (entry `label` + `ui.expand`). */
  display: Map<string, ResolvedProviderToolDisplay>;
}

export const EMPTY_RESOLVED_PROVIDER_TOOLS: ResolvedProviderTools = {
  functionTools: [],
  literalEntries: [],
  bodyPatches: [],
  executions: new Map(),
  recognizedNames: new Set(),
  display: new Map(),
};

/**
 * The model-facing name of a literal (non-function-shaped) tool entry: server-tool style entries
 * carry `name`; formula-style trace entries carry `function_name`. Entries without a name are
 * passthrough-only and contribute nothing to recognition or collision filtering.
 */
export function literalProviderToolEntryName(tool: unknown): string | undefined {
  if (!isPlainJsonObject(tool)) {
    return undefined;
  }
  const name = tool.name ?? tool.function_name;
  return typeof name === "string" && name.trim().length > 0 ? name : undefined;
}

function collectEntryNames(
  entry: ProviderToolEntry,
  fetchedTools: readonly OpenAiFunctionToolEntry[],
): string[] {
  const names: string[] = [];
  for (const tool of entry.tools ?? []) {
    const name = openAiFunctionToolName(tool) ?? literalProviderToolEntryName(tool);
    if (name !== undefined) {
      names.push(name);
    }
  }
  for (const tool of fetchedTools) {
    names.push(tool.function.name);
  }
  return names;
}

/**
 * Synchronous read of the parts that need no `toolsFrom` fetch: literal entries and entry-level
 * body patches, gated by `providerToolsEnabled`. Not collision-filtered — the wire merge point
 * applies the resolved (filtered) sets; this read exists for paths that assemble a request without
 * a local tool list (there are none today) and for tests.
 */
export function declaredProviderToolWirePatches(config: DeclaredProviderToolsConfig | undefined): {
  literalEntries: JsonObject[];
  bodyPatches: JsonObject[];
} {
  if (!config || config.providerToolsEnabled === false || !config.providerTools?.length) {
    return { literalEntries: [], bodyPatches: [] };
  }

  const literalEntries: JsonObject[] = [];
  const bodyPatches: JsonObject[] = [];
  for (const entry of config.providerTools) {
    for (const tool of entry.tools ?? []) {
      if (!isOpenAiFunctionToolEntry(tool)) {
        literalEntries.push(tool);
      }
    }
    if (entry.body !== undefined) {
      bodyPatches.push(entry.body);
    }
  }
  return { literalEntries, bodyPatches };
}

async function fetchEntryToolsFrom(
  entry: ProviderToolEntry,
  config: DeclaredProviderToolsConfig,
  fetchImpl: FetchFn | undefined,
): Promise<OpenAiFunctionToolEntry[]> {
  if (entry.toolsFrom === undefined) {
    return [];
  }
  try {
    return await fetchProviderToolsFrom(entry.toolsFrom, {
      apiBase: config.baseUrl ?? "",
      apiKey: config.apiKey ?? "",
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    });
  } catch (error) {
    // A failed dynamic tool source degrades to "entry contributes no fetched tools": the request
    // still carries the literal entries, and the log line keeps the failure observable.
    console.warn(
      `Provider tools fetch failed for ${JSON.stringify(entry.toolsFrom.path ?? entry.toolsFrom.url)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

function resolveToolsAgainstLocal(
  config: DeclaredProviderToolsConfig,
  fetchedByEntry: OpenAiFunctionToolEntry[][],
  localToolNames: ReadonlySet<string>,
): ResolvedProviderTools {
  const entries = config.providerTools ?? [];

  const declaredNames: string[] = [];
  const nameSource = new Map<string, { entry: ProviderToolEntry; tool: unknown }>();
  entries.forEach((entry, index) => {
    const fetched = fetchedByEntry[index] ?? [];
    for (const tool of [...(entry.tools ?? []), ...fetched]) {
      const name = openAiFunctionToolName(tool) ?? literalProviderToolEntryName(tool);
      if (name === undefined || nameSource.has(name)) {
        continue;
      }
      nameSource.set(name, { entry, tool });
      declaredNames.push(name);
    }
  });

  const { names } = resolveProviderToolNamesAgainstLocal(declaredNames, localToolNames);

  const resolved: ResolvedProviderTools = {
    functionTools: [],
    literalEntries: [],
    bodyPatches: [],
    executions: new Map(),
    recognizedNames: names,
    display: new Map(),
  };

  entries.forEach((entry, index) => {
    const fetched = fetchedByEntry[index] ?? [];
    const entryNames = new Set(collectEntryNames(entry, fetched));
    const survivingNames = new Set([...entryNames].filter((name) => names.has(name)));

    for (const tool of entry.tools ?? []) {
      const name = openAiFunctionToolName(tool) ?? literalProviderToolEntryName(tool);
      if (name !== undefined && !survivingNames.has(name)) {
        continue;
      }
      if (isOpenAiFunctionToolEntry(tool)) {
        resolved.functionTools.push(tool);
      } else {
        resolved.literalEntries.push(tool);
      }
    }
    for (const tool of fetched) {
      if (survivingNames.has(tool.function.name)) {
        resolved.functionTools.push(tool);
      }
    }

    // An entry whose tools all lost collisions still merges its `body` when it is a pure
    // body-switch entry (no tool sources declared); entries with tool sources merge their body
    // only while at least one of their tools survives.
    const declaresTools = entry.tools !== undefined || entry.toolsFrom !== undefined;
    if (entry.body !== undefined && (!declaresTools || survivingNames.size > 0)) {
      resolved.bodyPatches.push(entry.body);
    }

    for (const name of survivingNames) {
      if (!resolved.display.has(name)) {
        resolved.display.set(name, {
          ...(entry.label !== undefined ? { label: entry.label } : {}),
          suppressExpand: entry.ui?.expand === false,
        });
      }
    }

    if (entry.execute !== undefined) {
      const parametersByName = new Map<string, JsonObject>();
      for (const tool of [...(entry.tools ?? []), ...fetched]) {
        if (isOpenAiFunctionToolEntry(tool) && tool.function.parameters !== undefined) {
          if (!parametersByName.has(tool.function.name)) {
            parametersByName.set(tool.function.name, tool.function.parameters);
          }
        }
      }
      for (const name of survivingNames) {
        if (!resolved.executions.has(name)) {
          const parameters = parametersByName.get(name);
          resolved.executions.set(name, {
            entry,
            execute: entry.execute,
            ...(parameters !== undefined ? { parameters } : {}),
          });
        }
      }
    }
  });

  return resolved;
}

/**
 * Resolution cache: one in-flight/resolved value per (config object, local-tool-name set). The
 * `toolsFrom` HTTP layer has its own TTL cache; this cache only pins the resolved view so the
 * turn machine, streaming gate, and transports share one resolution per request round.
 */
const resolutionCache = new WeakMap<object, Map<string, Promise<ResolvedProviderTools>>>();
const resolvedValueCache = new WeakMap<object, Map<string, ResolvedProviderTools>>();

function localToolNamesKey(localToolNames: ReadonlySet<string>): string {
  return [...localToolNames].sort().join("\0");
}

/**
 * Resolves the config's `providerTools` declarations against the local tool names: literal `tools`
 * plus fetched `toolsFrom` entries, collision-filtered (local wins, one console warning per skipped
 * name). `providerToolsEnabled === false` yields the empty resolution without touching the cache,
 * so live exposure toggles never go stale.
 */
export function resolveDeclaredProviderTools(
  config: DeclaredProviderToolsConfig | undefined,
  localToolNames: ReadonlySet<string>,
  fetchImpl?: FetchFn,
): Promise<ResolvedProviderTools> {
  if (!config || config.providerToolsEnabled === false || !config.providerTools?.length) {
    return Promise.resolve(EMPTY_RESOLVED_PROVIDER_TOOLS);
  }

  const cacheKey = localToolNamesKey(localToolNames);
  let perConfig = resolutionCache.get(config as object);
  const cached = perConfig?.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  if (perConfig === undefined) {
    perConfig = new Map();
    resolutionCache.set(config as object, perConfig);
  }

  const resolution = (async () => {
    const entries = config.providerTools ?? [];
    const fetchedByEntry = await Promise.all(
      entries.map((entry) => fetchEntryToolsFrom(entry, config, fetchImpl)),
    );
    const resolved = resolveToolsAgainstLocal(config, fetchedByEntry, localToolNames);
    let values = resolvedValueCache.get(config as object);
    if (values === undefined) {
      values = new Map();
      resolvedValueCache.set(config as object, values);
    }
    values.set(cacheKey, resolved);
    return resolved;
  })();
  // A rejected resolution (never today: toolsFrom failures degrade per entry) must not be pinned.
  resolution.catch(() => perConfig.delete(cacheKey));
  perConfig.set(cacheKey, resolution);
  return resolution;
}

/**
 * Synchronous peek at the latest completed resolution for this config (any local-name set). Used
 * by paths that cannot await (streaming preview gates).
 */
export function peekDeclaredProviderTools(
  config: DeclaredProviderToolsConfig | undefined,
): ResolvedProviderTools | undefined {
  if (!config || config.providerToolsEnabled === false || !config.providerTools?.length) {
    return undefined;
  }
  const values = resolvedValueCache.get(config as object);
  if (values === undefined || values.size === 0) {
    return undefined;
  }
  return [...values.values()].at(-1);
}

/**
 * Synchronous peek at the recognized provider tool names from the latest completed resolution for
 * this config (any local-name set). Used by the streaming early-execution gate, which cannot await.
 */
export function peekDeclaredProviderToolNames(
  config: DeclaredProviderToolsConfig,
): ReadonlySet<string> | undefined {
  return peekDeclaredProviderTools(config)?.recognizedNames;
}
