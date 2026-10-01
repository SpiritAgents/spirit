import {
  resolveClangdOnPath,
  resolveCommandOnPath,
  resolveGoplsOnPath,
  resolvePyrightOnPath,
  resolveRustAnalyzerOnPath,
} from "./resolve-server.js";
import { resolveJdtlsOnPath } from "./resolve-server-jdtls.js";
import { resolveOmnisharpOnPath } from "./resolve-server-omnisharp.js";

export type LspProviderId =
  | "pyright"
  | "gopls"
  | "rust-analyzer"
  | "clangd"
  | "jdtls"
  | "omnisharp";

export interface LspProviderDescriptor {
  id: LspProviderId;
  displayName: string;
  languageLabels: string[];
  extensions: readonly string[];
}

export type LspProviderDiscoveryStatus = "ready" | "not_found";

export interface LspProviderDiscoveryResult {
  id: LspProviderId;
  status: LspProviderDiscoveryStatus;
  command?: string;
  args?: string[];
}

export const LSP_PROVIDERS: readonly LspProviderDescriptor[] = [
  {
    id: "pyright",
    displayName: "Pyright",
    languageLabels: ["Python"],
    extensions: [".py", ".pyi"],
  },
  {
    id: "gopls",
    displayName: "gopls",
    languageLabels: ["Go"],
    extensions: [".go"],
  },
  {
    id: "rust-analyzer",
    displayName: "rust-analyzer",
    languageLabels: ["Rust"],
    extensions: [".rs"],
  },
  {
    id: "clangd",
    displayName: "clangd",
    languageLabels: ["C", "C++"],
    extensions: [".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
  },
  {
    id: "jdtls",
    displayName: "Eclipse JDT Language Server",
    languageLabels: ["Java"],
    extensions: [".java"],
  },
  {
    id: "omnisharp",
    displayName: "OmniSharp",
    languageLabels: ["C#"],
    extensions: [".cs"],
  },
] as const;

const EXTENSION_TO_PROVIDER = buildExtensionRouteMap(LSP_PROVIDERS);

function buildExtensionRouteMap(
  providers: readonly LspProviderDescriptor[],
): Map<string, LspProviderId> {
  const map = new Map<string, LspProviderId>();
  for (const provider of providers) {
    for (const extension of provider.extensions) {
      map.set(extension.toLowerCase(), provider.id);
    }
  }
  return map;
}

export function findLspProvider(id: string): LspProviderDescriptor | undefined {
  return LSP_PROVIDERS.find((provider) => provider.id === id);
}

export function routeLspProviderForExtension(extension: string): LspProviderId | undefined {
  const normalized = extension.startsWith(".")
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`;
  return EXTENSION_TO_PROVIDER.get(normalized);
}

export function routeLspProviderForPath(resolvedPath: string): LspProviderId | undefined {
  const lastDot = resolvedPath.lastIndexOf(".");
  if (lastDot < 0) {
    return undefined;
  }
  const extension = resolvedPath.slice(lastDot).toLowerCase();
  return routeLspProviderForExtension(extension);
}

type ProviderResolver = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) => Promise<{ command: string; args: string[] } | undefined>;

const PROVIDER_RESOLVERS: Partial<Record<LspProviderId, ProviderResolver>> = {
  pyright: resolvePyrightOnPath,
  gopls: resolveGoplsOnPath,
  "rust-analyzer": resolveRustAnalyzerOnPath,
  clangd: resolveClangdOnPath,
  jdtls: resolveJdtlsOnPath,
  omnisharp: resolveOmnisharpOnPath,
};

export async function discoverLspProvider(
  id: LspProviderId,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  options: { lightweight?: boolean } = {},
): Promise<LspProviderDiscoveryResult> {
  const resolver = PROVIDER_RESOLVERS[id];
  if (!resolver) {
    return { id, status: "not_found" };
  }

  const resolved =
    id === "rust-analyzer" && options.lightweight === true
      ? await resolveCommandOnPath("rust-analyzer", env, platform, [])
      : await resolver(env, platform);
  if (!resolved) {
    return { id, status: "not_found" };
  }

  return {
    id,
    status: "ready",
    command: resolved.command,
    args: resolved.args,
  };
}

export async function discoverAllLspProviders(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  options: { lightweight?: boolean } = {},
): Promise<LspProviderDiscoveryResult[]> {
  return Promise.all(
    LSP_PROVIDERS.map((provider) => discoverLspProvider(provider.id, env, platform, options)),
  );
}

/** Register a provider resolver (used when adding new language servers). */
export function registerLspProviderResolver(id: LspProviderId, resolver: ProviderResolver): void {
  PROVIDER_RESOLVERS[id] = resolver;
}
