#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  EXPECTED_PRIMARY_ASSET_COUNT,
  mapPrimaryAsset,
  objectKeyFor,
  publicUrlFor,
  PUBLIC_DOWNLOAD_HOST,
} from './selfhosted-paths.mjs';
import { parseReleaseVersion } from './version.mjs';
import { readNpmPackages } from './npm-packages.mjs';
import { product, PRODUCT_BUILD_ID } from '../../packages/product/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  console.error(
    [
      'Usage: node scripts/release/prepare-approval-report.mjs --input <dir> --output-dir <dir> --version <X.Y.Z[-alpha.N|-beta.N|-rc.N]> [--sha <commit>]',
      'Env: RELEASE_VERSION, GITHUB_SHA, GITHUB_REPOSITORY, GH_TOKEN / GITHUB_TOKEN',
    ].join('\n'),
  );
}

function formatBytes(bytes) {
  return new Intl.NumberFormat('en-US').format(bytes);
}

async function collectFiles(dir, { skipPaths, skipDirs }) {
  const skipPathSet = new Set(skipPaths.map((item) => path.resolve(item)));
  const skipDirSet = new Set(skipDirs.map((item) => path.resolve(item)));
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const resolved = path.resolve(fullPath);
    if (skipPathSet.has(resolved) || skipDirSet.has(resolved)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, { skipPaths, skipDirs })));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  return hash.digest('hex');
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: repoRoot,
    env: process.env,
    ...options,
  });
  return result;
}

function generateNotesViaGh(version, sha) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    return undefined;
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    return undefined;
  }

  const args = [
    'api',
    '--method',
    'POST',
    `-H`,
    'Accept: application/vnd.github+json',
    `/repos/${repository}/releases/generate-notes`,
    '-f',
    `tag_name=${version}`,
  ];
  if (sha) {
    args.push('-f', `target_commitish=${sha}`);
  }

  const result = runCapture('gh', args);
  if (result.status !== 0) {
    console.error(result.stderr?.trim() || 'gh releases/generate-notes failed');
    return undefined;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (typeof parsed.body === 'string' && parsed.body.trim()) {
      return parsed.body.trim();
    }
  } catch {
    // fall through
  }
  return undefined;
}

function generateNotesViaGitLog(sha) {
  const describe = runCapture('git', ['describe', '--tags', '--abbrev=0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const rangeArgs =
    describe.status === 0 && describe.stdout.trim()
      ? [`${describe.stdout.trim()}..${sha || 'HEAD'}`, '--']
      : [sha || 'HEAD', '--max-count=30', '--'];

  const log = runCapture('git', ['log', '--pretty=format:- %s (%h)', ...rangeArgs]);
  if (log.status !== 0) {
    return '- (changelog unavailable)';
  }
  const body = log.stdout.trim();
  return body || '- (no commits in range)';
}

function renderAssetTable(assets) {
  const lines = ['| File | SHA256 | Size (bytes) |', '| --- | --- | ---: |'];
  for (const asset of assets) {
    lines.push(`| \`${asset.file}\` | \`${asset.sha256}\` | ${formatBytes(asset.size)} |`);
  }
  return lines.join('\n');
}

const inputDir = path.resolve(readArg('--input') ?? path.join(repoRoot, 'dist', 'release'));
const outputDir = path.resolve(readArg('--output-dir') ?? path.join(inputDir, 'approval'));
const version = readArg('--version') ?? process.env.RELEASE_VERSION;
const sha = readArg('--sha') ?? process.env.GITHUB_SHA ?? '';

if (!version) {
  usage();
  console.error('Invalid or missing --version.');
  process.exit(1);
}

let parsed;
try {
  parsed = parseReleaseVersion(version);
} catch (error) {
  usage();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });

const reportPath = path.join(outputDir, 'approval-report.md');
const manifestPath = path.join(outputDir, 'release-manifest.json');
const notesPath = path.join(outputDir, 'release-notes.md');
const sumsPath = path.join(inputDir, 'SHA256SUMS.txt');

const files = (
  await collectFiles(inputDir, {
    skipPaths: [reportPath, manifestPath, notesPath, sumsPath, path.join(outputDir, 'SHA256SUMS.txt')],
    skipDirs: [outputDir],
  })
).sort((left, right) => left.localeCompare(right));

if (files.length === 0) {
  console.error(`No release assets found under ${inputDir}`);
  process.exit(1);
}

const assets = [];
const sumLines = [];
for (const filePath of files) {
  const relativePath = path.relative(inputDir, filePath).replaceAll(path.sep, '/');
  const digest = await sha256(filePath);
  const size = (await stat(filePath)).size;
  assets.push({ file: relativePath, sha256: digest, size });
  sumLines.push(`${digest}  ${relativePath}`);
}

await writeFile(sumsPath, `${sumLines.join('\n')}\n`);

const changelog = generateNotesViaGh(version, sha) ?? generateNotesViaGitLog(sha);
await writeFile(notesPath, `${changelog}\n`);

const table = renderAssetTable(assets);
const npmPackageInfo = await readNpmPackages();
const npmPackages = npmPackageInfo.map(({ name }) => name);
const npmTable = [
  '| Package | Version |',
  '| --- | --- |',
  ...npmPackageInfo.map(({ name, version }) => `| \`${name}\` | \`${version}\` |`),
].join('\n');

const selfhostedRows = [];
for (const asset of assets) {
  const mapped = mapPrimaryAsset(asset.file);
  if (!mapped || mapped.version !== version) {
    continue;
  }
  const versionKey = objectKeyFor(mapped, version);
  const latestKey = objectKeyFor(mapped, 'latest');
  selfhostedRows.push({
    source: asset.file,
    versionUrl: publicUrlFor(versionKey),
    latestUrl: publicUrlFor(latestKey),
  });
}
selfhostedRows.sort((left, right) => left.versionUrl.localeCompare(right.versionUrl));

if (selfhostedRows.length !== EXPECTED_PRIMARY_ASSET_COUNT) {
  console.error(
    `Expected ${EXPECTED_PRIMARY_ASSET_COUNT} primary installers for self-hosted publish, found ${selfhostedRows.length}.`,
  );
  for (const row of selfhostedRows) {
    console.error(`- ${row.source}`);
  }
  process.exit(1);
}

const selfhostedTable = [
  '| Source (GitHub asset) | Version URL | Latest URL |',
  '| --- | --- | --- |',
  ...selfhostedRows.map((row) => {
    const latestCell = parsed.prerelease ? '— (not updated)' : `\`${row.latestUrl}\``;
    return `| \`${row.source}\` | \`${row.versionUrl}\` | ${latestCell} |`;
  }),
].join('\n');

const githubChannelNote = parsed.prerelease
  ? `Channel status: **Will publish after approval** as a GitHub **pre-release** (\`${parsed.channel}\`).`
  : 'Channel status: **Will publish after approval**';
const npmChannelNote = parsed.prerelease
  ? `Channel status: **Will publish after approval** (OIDC trusted publishing) with \`--tag ${parsed.npmTag}\` (will not update \`latest\`).`
  : 'Channel status: **Will publish after approval** (OIDC trusted publishing)';
const selfhostedChannelNote = parsed.prerelease
  ? 'Prerelease: versioned object keys only; `latest` keys are **not** updated.'
  : 'Primary installers only (darwin `.dmg`, windows `.exe`, linux `.AppImage` for Desktop; CLI archives). All version paths are written first, then each `latest` key.';

const report = [
  `# Release approval — ${version}`,
  '',
  `Target commit: \`${sha || '(local)'}\``,
  '',
  `Release channel: \`${parsed.channel}\`${parsed.prerelease ? ' (prerelease)' : ''}`,
  '',
  '## Changelog',
  '',
  changelog,
  '',
  '## GitHub Release',
  '',
  githubChannelNote,
  '',
  table,
  '',
  '## npm',
  '',
  npmChannelNote,
  '',
  `Publish order: ${npmPackages.map((name) => `\`${name}\``).join(' → ')}`,
  '',
  npmTable,
  '',
  `## Self-hosted (\`${PUBLIC_DOWNLOAD_HOST}\`)`,
  '',
  'Channel status: **Will publish after approval** (Cloudflare R2 via S3 API)',
  '',
  selfhostedChannelNote,
  '',
  selfhostedRows.length > 0 ? selfhostedTable : '_No primary installers found in assets._',
  '',
  '## Checksums',
  '',
  `Also written to \`SHA256SUMS.txt\` (${assets.length} files).`,
  '',
].join('\n');

await writeFile(reportPath, report);

const manifest = {
  version,
  product,
  productBuildId: PRODUCT_BUILD_ID,
  channel: parsed.channel,
  prerelease: parsed.prerelease,
  sha: sha || null,
  generatedAt: new Date().toISOString(),
  channels: {
    github: { publish: true, prerelease: parsed.prerelease },
    npm: { publish: true, tag: parsed.npmTag, packages: npmPackages },
    selfhosted: {
      publish: true,
      host: PUBLIC_DOWNLOAD_HOST,
      origin: product.downloadOrigin,
      updateLatest: !parsed.prerelease,
      uploads: selfhostedRows,
    },
  },
  assets,
  files: {
    report: 'approval-report.md',
    notes: 'release-notes.md',
    checksums: 'SHA256SUMS.txt',
  },
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Keep a copy of checksums next to the report for the release-bundle artifact layout.
await writeFile(path.join(outputDir, 'SHA256SUMS.txt'), `${sumLines.join('\n')}\n`);

console.log(`Wrote approval report: ${reportPath}`);
console.log(`Wrote manifest: ${manifestPath}`);
console.log(`Wrote notes: ${notesPath}`);
console.log(`Wrote checksums: ${sumsPath}`);
