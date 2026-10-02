/** Shared GitHub artifact to public download path mapping (primary installers only). */

import { VERSION_IN_FILENAME_RE } from './version.mjs';
import { product } from '../../packages/product/dist/index.js';

export const PUBLIC_DOWNLOAD_HOST = new URL(product.downloadOrigin).host;
const productPattern = product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PRIMARY_PATTERNS = [
  {
    channel: 'desktop',
    re: new RegExp(`^${productPattern}-Desktop-(?<version>${VERSION_IN_FILENAME_RE})-darwin-(?<arch>x64|arm64)\\.dmg$`),
    toKey: ({ arch, version }) => ({
      os: 'darwin',
      arch,
      version,
      fileName: `${product.name}-darwin-${arch}.dmg`,
    }),
  },
  {
    channel: 'desktop',
    re: new RegExp(`^${productPattern}-Desktop-(?<version>${VERSION_IN_FILENAME_RE})-win-(?<arch>x64|arm64)\\.exe$`),
    toKey: ({ arch, version }) => ({
      os: 'windows',
      arch,
      version,
      fileName: `${product.name}-windows-${arch}.exe`,
    }),
  },
  {
    channel: 'desktop',
    // electron-builder AppImage uses x86_64 for linux x64 (arm64 stays arm64).
    re: new RegExp(
      `^${productPattern}-Desktop-(?<version>${VERSION_IN_FILENAME_RE})-linux-(?<arch>x64|x86_64|arm64)\\.AppImage$`,
    ),
    toKey: ({ arch, version }) => {
      const normalizedArch = arch === 'x86_64' ? 'x64' : arch;
      return {
        os: 'linux',
        arch: normalizedArch,
        version,
        fileName: `${product.name}-linux-${normalizedArch}.AppImage`,
      };
    },
  },
  {
    channel: 'cli',
    re: new RegExp(
      `^${productPattern}-CLI-(?<version>${VERSION_IN_FILENAME_RE})-darwin-(?<arch>x64|arm64)\\.tar\\.gz$`,
    ),
    toKey: ({ arch, version }) => ({
      os: 'darwin',
      arch,
      version,
      fileName: `${product.name}-CLI-darwin-${arch}.tar.gz`,
    }),
  },
  {
    channel: 'cli',
    re: new RegExp(`^${productPattern}-CLI-(?<version>${VERSION_IN_FILENAME_RE})-windows-(?<arch>x64|arm64)\\.zip$`),
    toKey: ({ arch, version }) => ({
      os: 'windows',
      arch,
      version,
      fileName: `${product.name}-CLI-windows-${arch}.zip`,
    }),
  },
  {
    channel: 'cli',
    re: new RegExp(`^${productPattern}-CLI-(?<version>${VERSION_IN_FILENAME_RE})-linux-(?<arch>x64|arm64)\\.tar\\.gz$`),
    toKey: ({ arch, version }) => ({
      os: 'linux',
      arch,
      version,
      fileName: `${product.name}-CLI-linux-${arch}.tar.gz`,
    }),
  },
];

/** Expected primary installer count for a full multi-arch release matrix. */
export const EXPECTED_PRIMARY_ASSET_COUNT = 12;

/**
 * @param {string} fileName basename of a GitHub release asset
 * @returns {{ channel: string, os: string, arch: string, version: string, fileName: string } | undefined}
 */
export function mapPrimaryAsset(fileName) {
  const base = fileName.split('/').pop() ?? fileName;
  for (const pattern of PRIMARY_PATTERNS) {
    const match = base.match(pattern.re);
    if (!match?.groups) {
      continue;
    }
    const mapped = pattern.toKey(match.groups);
    return {
      channel: pattern.channel,
      ...mapped,
    };
  }
  return undefined;
}

/**
 * @param {{ channel: string, os: string, arch: string, fileName: string }} mapped
 * @param {string} versionSegment release version or "latest"
 */
export function objectKeyFor(mapped, versionSegment) {
  return `${mapped.channel}/${mapped.os}/${mapped.arch}/${versionSegment}/${mapped.fileName}`;
}

/**
 * @param {string} objectKey
 */
export function publicUrlFor(objectKey) {
  return new URL(objectKey.split('/').map(encodeURIComponent).join('/'), `${product.downloadOrigin}/`).href;
}
