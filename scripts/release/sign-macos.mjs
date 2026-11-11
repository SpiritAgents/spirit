#!/usr/bin/env node
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMacosKeychainEntitlements } from './macos-keychain-sharing.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const nodeEntitlements = path.join(scriptDir, 'entitlements', 'macos-node.plist');

// Both endian spellings of the magic numbers are each unique, so reading once as big-endian is enough; no need to detect byte order first.
const THIN_MAGICS = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe]);
const FAT_MAGIC_BE = 0xcafebabe;
const FAT_MAGIC_LE = 0xbebafeca;

// Java class files share 0xcafebabe with fat Mach-O, but the field right after it is the class version (≥45),
// far beyond any real architecture count; use it to tell the two apart.
const MAX_FAT_ARCH_COUNT = 32;

/**
 * @param {string} filePath
 */
async function isMachO(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, 8, 0);
    if (bytesRead < 4) {
      return false;
    }
    const magic = buffer.readUInt32BE(0);
    if (THIN_MAGICS.has(magic)) {
      return true;
    }
    if (bytesRead < 8 || (magic !== FAT_MAGIC_BE && magic !== FAT_MAGIC_LE)) {
      return false;
    }
    const archCount = magic === FAT_MAGIC_BE ? buffer.readUInt32BE(4) : buffer.readUInt32LE(4);
    return archCount >= 1 && archCount <= MAX_FAT_ARCH_COUNT;
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} root
 * @param {string[]} skip paths relative to root; matched entries are not traversed further
 */
async function collectMachO(root, skip = []) {
  const skipSet = new Set(skip);
  /** @type {string[]} */
  const found = [];

  /** @param {string} dir */
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (skipSet.has(path.relative(root, entryPath))) {
        continue;
      }
      // node/bin contains multiple symlinks to the same file; following them would sign the same binary several times.
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && (await isMachO(entryPath))) {
        found.push(entryPath);
      }
    }
  }

  await walk(root);
  return found;
}

/**
 * @param {string} filePath
 * @param {{ identity: string, keychain?: string, entitlements?: string }} options
 */
function signFile(filePath, { identity, keychain, entitlements }) {
  const args = ['--force', '--options', 'runtime', '--timestamp', '--sign', identity];
  if (keychain) {
    args.push('--keychain', keychain);
  }
  if (entitlements) {
    args.push('--entitlements', entitlements);
  }
  args.push(filePath);
  const result = spawnSync('codesign', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`codesign failed: ${filePath}`);
  }
}

/**
 * Reads the signing identity; returns null when not configured, and callers skip signing entirely based on that.
 */
function resolveSigningIdentity() {
  const identity = process.env.SPIRIT_MACOS_SIGN_IDENTITY?.trim();
  if (!identity) {
    return null;
  }
  return { identity, keychain: process.env.SPIRIT_MACOS_KEYCHAIN?.trim() || undefined };
}

/**
 * Developer ID signs all Mach-O binaries in the CLI release bundle. Must be called before archiving,
 * otherwise the archive contains unsigned copies.
 *
 * @param {string} bundleRoot
 */
export async function signCliBundle(bundleRoot) {
  if (process.platform !== 'darwin') {
    console.log(`Skipping macOS signing: codesign is macOS-only, host is ${process.platform}`);
    return;
  }

  const signing = resolveSigningIdentity();
  if (!signing) {
    console.log('Skipping macOS signing: SPIRIT_MACOS_SIGN_IDENTITY is not set');
    return;
  }

  const teamId = process.env.SPIRIT_MACOS_TEAM_ID?.trim() || process.env.APPLE_TEAM_ID?.trim();
  if (!teamId) {
    throw new Error('SPIRIT_MACOS_TEAM_ID is required when signing the CLI bundle');
  }
  const entitlementDir = await mkdtemp(path.join(tmpdir(), 'spirit-macos-entitlements-'));
  const nodeSharedEntitlements = path.join(entitlementDir, 'node.plist');
  const cliSharedEntitlements = path.join(entitlementDir, 'cli.plist');
  await renderMacosKeychainEntitlements({
    teamId,
    outputPath: nodeSharedEntitlements,
    baseEntitlementsPath: nodeEntitlements,
  });
  await renderMacosKeychainEntitlements({
    teamId,
    outputPath: cliSharedEntitlements,
  });

  // Only Spirit's private Node runtime and CLI join the sharing group. Other bundled tools do not.
  const nodeRoot = path.join(bundleRoot, 'node');
  const groups = [
    { files: await collectMachO(nodeRoot), entitlements: nodeSharedEntitlements },
    { files: await collectMachO(bundleRoot, ['node']), entitlements: undefined },
  ];

  let signed = 0;
  try {
    for (const group of groups) {
      for (const filePath of group.files) {
        console.log(`Signing ${path.relative(bundleRoot, filePath)}`);
        const entitlements =
          filePath === path.join(bundleRoot, 'bin', 'spirit')
            ? cliSharedEntitlements
            : group.entitlements;
        signFile(filePath, { ...signing, entitlements });
        signed += 1;
      }
    }
  } finally {
    await rm(entitlementDir, { recursive: true, force: true });
  }

  console.log(`Signed ${signed} Mach-O binaries with ${signing.identity}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const bundleRoot = process.argv[2];
  if (!bundleRoot) {
    console.error('Usage: node scripts/release/sign-macos.mjs <bundle root>');
    process.exit(1);
  }
  signCliBundle(path.resolve(bundleRoot)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
