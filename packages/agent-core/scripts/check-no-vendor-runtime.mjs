#!/usr/bin/env node
/**
 * Structural no-vendor-runtime check: runtime code must not branch on provider identity. Builds a
 * forbidden-token list from the preset ids + declared endpoint hostnames in provider-presets.json
 * (the materialization zone) plus the legacy field/family names, and fails on any hit in the
 * runtime sources. Dependency-free (node:fs/node:path only); wired into `pnpm test` before vitest.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const agentCoreRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(agentCoreRoot, "..", "..");

const STATIC_TOKENS = [
  "llmVendor",
  "responsesProvider",
  "upstreamProvider",
  "isManagedProviderToolCall",
  "MOONSHOT_FORMULA",
  "formulaUi",
  "providerUi",
  "DIRECT_THINKING_SWITCH_PROVIDERS",
  "cloudflareGatewayId",
];

/** Subtrees where write-time (materialization) knowledge legitimately lives. */
const EXCLUDED_DIR_NAMES = new Set([
  "provider-presets",
  "model-knowledge",
  "model-catalog",
  "smoke",
  "eval",
]);

function collectUrlStrings(value, out) {
  if (typeof value === "string") {
    if (value.startsWith("https://") || value.startsWith("http://")) {
      out.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrlStrings(item, out);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectUrlStrings(item, out);
  }
}

function hostnameOf(urlString) {
  try {
    return new URL(urlString).hostname;
  } catch {
    return undefined;
  }
}

function loadDynamicTokens() {
  const presetsPath = join(agentCoreRoot, "src/provider-presets/provider-presets.json");
  const presets = JSON.parse(readFileSync(presetsPath, "utf8"));

  const presetIds = [];
  const urlStrings = [];
  for (const provider of presets.providers ?? []) {
    if (typeof provider.id === "string") {
      presetIds.push(provider.id);
    }
    collectUrlStrings(provider, urlStrings);
  }

  // The generic openai-compatible default base URL doubles as a preset host (custom.defaultApiBase)
  // and stays as the adapter default; it is not vendor knowledge.
  const genericDefaultHost = hostnameOf(presets.custom?.defaultApiBase ?? "");
  const hostnames = new Set();
  for (const urlString of urlStrings) {
    if (urlString.includes("{")) {
      continue; // wizard write-time template (`{resourceName}` etc.), not a runtime fact
    }
    const hostname = hostnameOf(urlString);
    if (hostname && hostname !== genericDefaultHost) {
      hostnames.add(hostname);
    }
  }
  return { presetIds, hostnames: [...hostnames] };
}

function collectSourceFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIR_NAMES.has(entry.name)) {
          stack.push(join(dir, entry.name));
        }
        continue;
      }
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        files.push(join(dir, entry.name));
      }
    }
  }
  return files;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const { presetIds, hostnames } = loadDynamicTokens();

// A preset id hits only as a standalone token: not inside an npm package name (@ai-sdk/xai), a
// hostname segment, a longer kebab token (minimax-h3 is an upstream model name, not the preset
// id), or an identifier (openai_sdk_responses is a trace kind, not the preset id).
// Single-segment ids (openai, anthropic, groq, …) are intentionally NOT scanned: they are also
// transport/protocol/adapter-namespace names, so a text scan cannot distinguish mechanism from
// vendor identity. The static tokens + hostname scan carry the guarantee for those.
const presetIdPatterns = presetIds
  .filter((id) => id.includes("-"))
  .map((id) => new RegExp(`(?<![A-Za-z0-9@/._-])${escapeRegExp(id)}(?![A-Za-z0-9_-])`));

const scanRoots = [join(agentCoreRoot, "src")];
const hostInternalSrc = join(repoRoot, "packages/host-internal/src");
const hostInternalTargets = [join(hostInternalSrc, "resolve-transport.ts")];
const hostInternalCredentials = join(hostInternalSrc, "credentials");
for (const file of collectSourceFiles(hostInternalCredentials)) {
  hostInternalTargets.push(file);
}

const hits = [];

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const token of STATIC_TOKENS) {
      if (line.includes(token)) {
        hits.push(`${relative(repoRoot, filePath)}:${index + 1} — ${token}`);
      }
    }
    for (const pattern of presetIdPatterns) {
      const match = pattern.exec(line);
      if (match) {
        hits.push(`${relative(repoRoot, filePath)}:${index + 1} — ${match[0]} (preset id)`);
      }
    }
    for (const hostname of hostnames) {
      if (line.includes(hostname)) {
        hits.push(`${relative(repoRoot, filePath)}:${index + 1} — ${hostname} (preset host)`);
      }
    }
  }
}

for (const file of collectSourceFiles(scanRoots[0])) {
  scanFile(file);
}
for (const file of hostInternalTargets) {
  scanFile(file);
}

if (hits.length > 0) {
  console.error("check-no-vendor-runtime: forbidden vendor tokens in runtime sources:");
  for (const hit of hits) {
    console.error(`  ${hit}`);
  }
  process.exit(1);
}

console.log(
  `check-no-vendor-runtime: clean (${STATIC_TOKENS.length} legacy tokens, ${presetIds.length} preset ids, ${hostnames.length} preset hosts scanned).`,
);
