#!/usr/bin/env node
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import crossSpawn from 'cross-spawn';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { signCliBundle } from './sign-macos.mjs';
import { deployProductionPackage, assertContainedLinks } from './deploy-package.mjs';
import { parseReleaseVersion } from './version.mjs';
import { product, PRODUCT_BUILD_ID } from '@spiritagent/product';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releaseRoot = path.resolve(readArg('--output-dir') ?? path.join(repoRoot, 'dist', 'release'));

const targetMap = {
  'x86_64-pc-windows-msvc': {
    packageTarget: 'windows-x64',
    binaryName: 'spirit.exe',
    nodePlatform: 'win',
    nodeArch: 'x64',
    nodeArchiveExt: 'zip',
    archiveExt: 'zip',
  },
  'aarch64-pc-windows-msvc': {
    packageTarget: 'windows-arm64',
    binaryName: 'spirit.exe',
    nodePlatform: 'win',
    nodeArch: 'arm64',
    nodeArchiveExt: 'zip',
    archiveExt: 'zip',
  },
  'x86_64-unknown-linux-gnu': {
    packageTarget: 'linux-x64',
    binaryName: 'spirit',
    nodePlatform: 'linux',
    nodeArch: 'x64',
    nodeArchiveExt: 'tar.gz',
    archiveExt: 'tar.gz',
  },
  'aarch64-unknown-linux-gnu': {
    packageTarget: 'linux-arm64',
    binaryName: 'spirit',
    nodePlatform: 'linux',
    nodeArch: 'arm64',
    nodeArchiveExt: 'tar.gz',
    archiveExt: 'tar.gz',
  },
  'x86_64-apple-darwin': {
    packageTarget: 'darwin-x64',
    binaryName: 'spirit',
    nodePlatform: 'darwin',
    nodeArch: 'x64',
    nodeArchiveExt: 'tar.gz',
    archiveExt: 'tar.gz',
  },
  'aarch64-apple-darwin': {
    packageTarget: 'darwin-arm64',
    binaryName: 'spirit',
    nodePlatform: 'darwin',
    nodeArch: 'arm64',
    nodeArchiveExt: 'tar.gz',
    archiveExt: 'tar.gz',
  },
};

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

function detectHostTarget() {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  }
  throw new Error(`Unsupported host platform: ${process.platform}/${process.arch}`);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function readNvmrcMajor() {
  const content = await readFile(path.join(repoRoot, '.nvmrc'), 'utf8');
  const spec = content.trim().split('\n')[0].trim().replace(/^v/, '');
  const major = spec.split('.')[0];
  if (!/^\d+$/.test(major)) {
    throw new Error(`.nvmrc must contain a numeric major version, got: ${spec}`);
  }
  return major;
}

async function resolveNodeReleaseVersion() {
  const explicit = readArg('--node-version') ?? process.env.SPIRIT_RELEASE_NODE_VERSION;
  if (explicit) {
    const version = explicit.replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid Node runtime version: ${explicit}`);
    return version;
  }
  if (process.argv.includes('--offline')) {
    throw new Error('--offline requires --node-version or SPIRIT_RELEASE_NODE_VERSION');
  }

  const major = process.env.SPIRIT_RELEASE_NODE_MAJOR ?? (await readNvmrcMajor());
  const response = await fetch('https://nodejs.org/dist/index.json');
  if (!response.ok) {
    throw new Error(`Failed to query Node.js ${major}.x versions: ${response.status}`);
  }
  const releases = await response.json();
  const latest = releases.find((item) => item.version?.startsWith(`v${major}.`));
  if (!latest) {
    throw new Error(`No Node.js ${major}.x release found`);
  }
  return latest.version.replace(/^v/, '');
}

function run(command, args, options = {}) {
  const result = crossSpawn.sync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function runPowerShell(script) {
  const executable = process.env.PWSH ?? (process.platform === 'win32' ? 'powershell' : 'pwsh');
  run(executable, ['-NoProfile', '-NonInteractive', '-Command', script]);
}

function psSingleQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function extractArchive(archivePath, destinationDir, archiveExt) {
  if (process.platform === 'win32' && archiveExt === 'zip') {
    runPowerShell(
      `Expand-Archive -LiteralPath ${psSingleQuote(archivePath)} -DestinationPath ${psSingleQuote(destinationDir)} -Force`,
    );
    return;
  }
  run('tar', ['-xf', archivePath, '-C', destinationDir]);
}

function createArchive(sourceDir, archivePath, archiveExt) {
  if (process.platform === 'win32' && archiveExt === 'zip') {
    runPowerShell(
      `Compress-Archive -LiteralPath ${psSingleQuote(sourceDir)} -DestinationPath ${psSingleQuote(archivePath)} -Force`,
    );
    return;
  }
  if (archiveExt === 'zip') {
    run('tar', ['-a', '-cf', archivePath, '-C', path.dirname(sourceDir), path.basename(sourceDir)]);
  } else {
    run('tar', ['-czf', archivePath, '-C', path.dirname(sourceDir), path.basename(sourceDir)]);
  }
}

async function ensureNodeRuntime(targetInfo) {
  const localRuntime = readArg('--node-runtime-dir');
  if (localRuntime) {
    const explicitVersion = readArg('--node-version') ?? process.env.SPIRIT_RELEASE_NODE_VERSION;
    if (!explicitVersion) {
      throw new Error('--node-runtime-dir requires an explicit --node-version');
    }
    const root = path.resolve(localRuntime);
    const binary = targetInfo.nodePlatform === 'win' ? 'node.exe' : 'bin/node';
    if (!(await stat(path.join(root, binary))).isFile()) {
      throw new Error(`Local Node runtime has no ${binary}: ${root}`);
    }
    return { root, version: await resolveNodeReleaseVersion() };
  }
  const version = await resolveNodeReleaseVersion();
  const nodeName = `node-v${version}-${targetInfo.nodePlatform}-${targetInfo.nodeArch}`;
  const archiveName = `${nodeName}.${targetInfo.nodeArchiveExt}`;
  const cacheDir = path.join(releaseRoot, '.cache', 'node');
  const archivePath = path.join(cacheDir, archiveName);
  const extractedRoot = path.join(cacheDir, nodeName);

  if (!(await pathExists(extractedRoot))) {
    if (!(await pathExists(archivePath))) {
      if (process.argv.includes('--offline')) {
        throw new Error(`Node runtime is not cached: ${archivePath}; provide --node-runtime-dir`);
      }
      const url = `https://nodejs.org/dist/v${version}/${archiveName}`;
      console.log(`Downloading ${url}`);
      await downloadFile(url, archivePath);
    }
    extractArchive(archivePath, cacheDir, targetInfo.nodeArchiveExt);
  }

  return { root: extractedRoot, version };
}

async function main() {
  const target = readArg('--target') ?? process.env.SPIRIT_RELEASE_TARGET ?? detectHostTarget();
  const targetInfo = targetMap[target];
  if (!targetInfo) {
    throw new Error(`Unsupported CLI release target: ${target}`);
  }

  const desktopPackage = await readJson('apps/desktop/package.json');
  const agentCorePackage = await readJson('packages/agent-core/package.json');
  const hostInternalPackage = await readJson('packages/host-internal/package.json');
  const serverPackage = await readJson('packages/server/package.json');
  const productPackage = await readJson('packages/product/package.json');
  const version = parseReleaseVersion(
    readArg('--version') ?? process.env.RELEASE_VERSION ?? desktopPackage.version,
  ).version;
  const targetBinaryPath = path.join(repoRoot, 'target', target, 'release', targetInfo.binaryName);
  const hostBinaryPath = path.join(repoRoot, 'target', 'release', targetInfo.binaryName);
  const binaryPath =
    readArg('--binary') ??
    ((await pathExists(targetBinaryPath))
      ? targetBinaryPath
      : target === detectHostTarget()
        ? hostBinaryPath
        : targetBinaryPath);

  if (!(await pathExists(binaryPath))) {
    throw new Error(`CLI release binary not found: ${binaryPath}`);
  }
  if (!(await readFile(binaryPath)).includes(Buffer.from(PRODUCT_BUILD_ID))) {
    throw new Error('CLI binary has a different product build; rebuild it before bundling');
  }

  const bundleName = `${product.name}-CLI-${version}-${targetInfo.packageTarget}`;
  if (/[<>:"/\\|?*\x00-\x1f]/.test(bundleName)) {
    throw new Error(`Product name cannot be used in a cross-platform release filename: ${product.name}`);
  }
  const bundleRoot = path.join(releaseRoot, 'cli', bundleName);
  const runtime = await ensureNodeRuntime(targetInfo);
  for (const input of [path.resolve(binaryPath), runtime.root]) {
    if (input === bundleRoot || input.startsWith(`${bundleRoot}${path.sep}`)) {
      throw new Error(`Release input must be outside the output bundle: ${input}`);
    }
  }
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(path.join(bundleRoot, 'bin'), { recursive: true });

  await cp(binaryPath, path.join(bundleRoot, 'bin', targetInfo.binaryName), { dereference: true });
  await cp(runtime.root, path.join(bundleRoot, 'node'), {
    recursive: true,
    verbatimSymlinks: true,
  });
  const serverRoot = path.join(bundleRoot, 'packages', 'server');
  await deployProductionPackage({
    packageName: '@spiritagent/server',
    destination: serverRoot,
    arch: targetInfo.nodeArch,
    platform: targetInfo.nodePlatform === 'win' ? 'win32' : targetInfo.nodePlatform,
    offline: process.argv.includes('--offline') || process.env.npm_config_offline === 'true',
    ignoreScripts: process.argv.includes('--ignore-scripts'),
  });
  const require = createRequire(path.join(serverRoot, 'package.json'));
  const deployedProduct = await import(pathToFileURL(require.resolve('@spiritagent/product')).href);
  if (deployedProduct.PRODUCT_BUILD_ID !== PRODUCT_BUILD_ID) {
    throw new Error('Deployed product build does not match the release build');
  }
  await assertContainedLinks(bundleRoot);

  await writeFile(
    path.join(bundleRoot, 'release-manifest.json'),
    `${JSON.stringify(
      {
        name: `${product.name} CLI`,
        product,
        productBuildId: PRODUCT_BUILD_ID,
        version,
        target,
        packageTarget: targetInfo.packageTarget,
        generatedAt: new Date().toISOString(),
        gitSha: process.env.GITHUB_SHA ?? null,
        nodeVersion: runtime.version,
        binary: `bin/${targetInfo.binaryName}`,
        components: {
          cli: version,
          desktop: desktopPackage.version,
          agentCore: agentCorePackage.version,
          hostInternal: hostInternalPackage.version,
          server: serverPackage.version,
          product: productPackage.version,
        },
      },
      null,
      2,
    )}\n`,
  );

  // Must run before createArchive: once the archive is created, signing afterwards only changes the copy outside the archive.
  if (targetInfo.nodePlatform === 'darwin') {
    await signCliBundle(bundleRoot);
  }

  const archivePath = path.join(releaseRoot, `${bundleName}.${targetInfo.archiveExt}`);
  await rm(archivePath, { force: true });
  createArchive(bundleRoot, archivePath, targetInfo.archiveExt);
  console.log(`Created ${archivePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
