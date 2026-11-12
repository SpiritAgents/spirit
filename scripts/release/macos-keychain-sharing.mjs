#!/usr/bin/env node
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MACOS_KEYCHAIN_ACCESS_GROUP_SUFFIX = 'dev.spirit.shared';

const EMPTY_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict/></plist>
`;

export function macosKeychainAccessGroup(teamId) {
  const normalized = teamId?.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9]+$/.test(normalized)) {
    throw new Error('A valid Apple Team ID is required for keychain sharing');
  }
  return `${normalized}.${MACOS_KEYCHAIN_ACCESS_GROUP_SUFFIX}`;
}

export async function renderMacosKeychainEntitlements({
  teamId,
  outputPath,
  baseEntitlementsPath,
}) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS entitlements can only be rendered with plutil on macOS');
  }
  const output = path.resolve(outputPath);
  await mkdir(path.dirname(output), { recursive: true });
  if (baseEntitlementsPath) {
    await copyFile(path.resolve(baseEntitlementsPath), output);
  } else {
    await writeFile(output, EMPTY_ENTITLEMENTS);
  }
  const accessGroup = macosKeychainAccessGroup(teamId);
  execFileSync('plutil', ['-insert', 'keychain-access-groups', '-array', output], {
    stdio: 'pipe',
  });
  execFileSync(
    'plutil',
    ['-insert', 'keychain-access-groups.0', '-string', accessGroup, output],
    { stdio: 'pipe' },
  );
  return accessGroup;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const accessGroup = await renderMacosKeychainEntitlements({
    teamId: readArg('--team-id'),
    outputPath: readArg('--output'),
    baseEntitlementsPath: process.argv.includes('--base') ? readArg('--base') : undefined,
  });
  console.log(`Rendered keychain access group ${accessGroup}`);
}
