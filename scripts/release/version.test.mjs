import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReleaseVersion, parseReleaseVersion } from './version.mjs';
import { mapPrimaryAsset } from './selfhosted-paths.mjs';
import { product } from '@spiritagent/product';

test('parseReleaseVersion accepts a stable X.Y.Z', () => {
  assert.deepEqual(parseReleaseVersion('1.0.0'), {
    version: '1.0.0',
    channel: 'latest',
    prerelease: false,
    npmTag: 'latest',
  });
});

test('parseReleaseVersion accepts alpha, beta, and rc suffixes', () => {
  assert.equal(parseReleaseVersion('1.0.0-alpha.0').channel, 'alpha');
  assert.equal(parseReleaseVersion('1.0.0-alpha.0').prerelease, true);
  assert.equal(parseReleaseVersion('1.0.0-alpha.0').npmTag, 'alpha');
  assert.equal(parseReleaseVersion('1.0.0-beta.1').channel, 'beta');
  assert.equal(parseReleaseVersion('1.0.0-beta.1').npmTag, 'beta');
  assert.equal(parseReleaseVersion('2.3.4-rc.12').channel, 'rc');
  assert.equal(parseReleaseVersion('2.3.4-rc.12').npmTag, 'rc');
});

test('parseReleaseVersion rejects a v prefix, missing N, and unknown suffixes', () => {
  assert.throws(() => parseReleaseVersion('v1.0.0'), /no "v" prefix/);
  assert.throws(() => parseReleaseVersion('1.0.0-beta'), /X\.Y\.Z-beta\.N/);
  assert.throws(() => parseReleaseVersion('1.0.0-rc'), /X\.Y\.Z-rc\.N/);
  assert.throws(() => parseReleaseVersion('1.0.0-preview.1'), /Invalid release version/);
  assert.throws(() => parseReleaseVersion(''), /Invalid or missing/);
  assert.throws(() => parseReleaseVersion(undefined), /Invalid or missing/);
});

test('isReleaseVersion matches parseReleaseVersion', () => {
  assert.equal(isReleaseVersion('0.3.3'), true);
  assert.equal(isReleaseVersion('1.0.0-beta.1'), true);
  assert.equal(isReleaseVersion('v1.0.0'), false);
  assert.equal(isReleaseVersion('1.0.0-beta'), false);
});

test('mapPrimaryAsset captures prerelease versions in installer names', () => {
  const mapped = mapPrimaryAsset(`${product.name}-Desktop-1.0.0-beta.1-darwin-arm64.dmg`);
  assert.equal(mapped?.version, '1.0.0-beta.1');
  assert.equal(mapped?.os, 'darwin');
  assert.equal(mapped?.arch, 'arm64');

  const stable = mapPrimaryAsset(`${product.name}-Desktop-0.3.3-darwin-arm64.dmg`);
  assert.equal(stable?.version, '0.3.3');

  assert.equal(mapPrimaryAsset(`${product.name}-Desktop-1.0.0-preview.1-darwin-arm64.dmg`), undefined);
});
