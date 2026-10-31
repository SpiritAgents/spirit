#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReleaseVersion, parseReleaseVersion } from './version.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveExpectedVersion(raw) {
  if (!raw) {
    return undefined;
  }
  try {
    return parseReleaseVersion(raw).version;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function readJsonVersion(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  return parsed.version;
}

async function readCargoVersion(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  const content = await readFile(filePath, 'utf8');
  const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`package version not found in ${relativePath}`);
  }
  return match[1];
}

async function readMcpClientVersion(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  const content = await readFile(filePath, 'utf8');
  const match = content.match(/DEFAULT_MCP_CLIENT_INFO[\s\S]*?version:\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error(`DEFAULT_MCP_CLIENT_INFO.version not found in ${relativePath}`);
  }
  return match[1];
}

async function readAcpAgentVersion(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  const content = await readFile(filePath, 'utf8');
  const match = content.match(/agentInfo:\s*\{[\s\S]*?version:\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error(`agentInfo.version not found in ${relativePath}`);
  }
  return match[1];
}

const explicitVersion = readArg('--version') ?? process.env.RELEASE_VERSION;
const legacyVersion = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
const expectedVersion =
  explicitVersion !== undefined
    ? resolveExpectedVersion(explicitVersion)
    : legacyVersion && isReleaseVersion(legacyVersion)
      ? legacyVersion
      : undefined;

const versions = [
  ['product', 'packages/product/package.json', await readJsonVersion('packages/product/package.json')],
  ['desktop', 'apps/desktop/package.json', await readJsonVersion('apps/desktop/package.json')],
  ['agent-core', 'packages/agent-core/package.json', await readJsonVersion('packages/agent-core/package.json')],
  ['host-internal', 'packages/host-internal/package.json', await readJsonVersion('packages/host-internal/package.json')],
  ['acp-server', 'packages/acp-server/package.json', await readJsonVersion('packages/acp-server/package.json')],
  ['server', 'packages/server/package.json', await readJsonVersion('packages/server/package.json')],
  ['cli', 'apps/cli/Cargo.toml', await readCargoVersion('apps/cli/Cargo.toml')],
  ['mcp-client-info', 'packages/agent-core/src/mcp/config.ts', await readMcpClientVersion('packages/agent-core/src/mcp/config.ts')],
  ['acp-agent-info', 'packages/acp-server/src/acp-agent.ts', await readAcpAgentVersion('packages/acp-server/src/acp-agent.ts')],
];

const baseline = expectedVersion ?? versions[0][2];
try {
  parseReleaseVersion(baseline);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const mismatches = versions.filter(([, , version]) => version !== baseline);

if (mismatches.length > 0) {
  console.error(`Version mismatch, expected ${baseline}:`);
  for (const [name, file, version] of versions) {
    console.error(`- ${name}: ${version} (${file})`);
  }
  process.exit(1);
}

console.log(`Release version verified: ${baseline}`);
