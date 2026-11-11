import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  macosKeychainAccessGroup,
  renderMacosKeychainEntitlements,
} from './macos-keychain-sharing.mjs';

test('the shared keychain group uses the signing Team ID', () => {
  assert.equal(
    macosKeychainAccessGroup('abcde12345'),
    'ABCDE12345.dev.spirit.shared',
  );
  assert.throws(() => macosKeychainAccessGroup(''), /Team ID/);
  assert.throws(() => macosKeychainAccessGroup('not a team'), /Team ID/);
});

test(
  'entitlement rendering preserves base permissions and adds the group',
  { skip: process.platform !== 'darwin' },
  async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'spirit-entitlements-test-'));
    try {
      const outputPath = path.join(fixture, 'desktop.plist');
      const accessGroup = await renderMacosKeychainEntitlements({
        teamId: 'ABCDE12345',
        baseEntitlementsPath: 'apps/desktop/build/entitlements.mac.plist',
        outputPath,
      });
      const inspected = execFileSync('plutil', ['-p', outputPath], { encoding: 'utf8' });
      assert.ok(inspected.includes(accessGroup));
      assert.ok(inspected.includes('com.apple.security.cs.allow-jit'));
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  },
);
