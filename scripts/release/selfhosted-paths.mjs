/** Shared GitHub artifact → download.spirit.dev path mapping (primary installers only). */

import { VERSION_IN_FILENAME_RE } from './version.mjs';

export const PUBLIC_DOWNLOAD_HOST = 'download.spirit.dev';

const PRIMARY_PATTERNS = [
  {
    channel: 'desktop',
    re: new RegExp(`^Spirit-Desktop-(?<version>${VERSION_IN_FILENAME_RE})-darwin-(?<arch>x64|arm64)\\.dmg$`),
    toKey: ({ arch, version }) => ({
      os: 'darwin',
      arch,
      version,
      fileName: `Spirit-darwin-${arch}.dmg`,
    }),
  },
  {
    channel: 'desktop',
    re: new RegExp(`^Spirit-Desktop-(?<version>${VERSION_IN_FILENAME_RE})-win-(?<arch>x64|arm64)\\.exe$`),
    toKey: ({ arch, version }) => ({
      os: 'windows',
      arch,
      version,
      fileName: `Spirit-windows-${arch}.exe`,
    }),
  },
  {
    channel: 'desktop',
    // electron-builder AppImage uses x86_64 for linux x64 (arm64 stays arm64).
    re: new RegExp(
      `^Spirit-Desktop-(?<version>${VERSION_IN_FILENAME_RE})-linux-(?<arch>x64|x86_64|arm64)\\.AppImage$`,
    ),
    toKey: ({ arch, version }) => {
      const normalizedArch = arch === 'x86_64' ? 'x64' : arch;
      return {
        os: 'linux',
        arch: normalizedArch,
        version,
        fileName: `Spirit-linux-${normalizedArch}.AppImage`,
      };
    },
  },
  {
    channel: 'cli',
    re: new RegExp(`^Spirit-CLI-(?<version>${VERSION_IN_FILENAME_RE})-darwin-(?<arch>x64|arm64)\\.tar\\.gz$`),
    toKey: ({ arch, version }) => ({
      os: 'darwin',
      arch,
      version,
      fileName: `Spirit-CLI-darwin-${arch}.tar.gz`,
    }),
  },
  {
    channel: 'cli',
    re: new RegExp(`^Spirit-CLI-(?<version>${VERSION_IN_FILENAME_RE})-windows-(?<arch>x64|arm64)\\.zip$`),
    toKey: ({ arch, version }) => ({
      os: 'windows',
      arch,
      version,
      fileName: `Spirit-CLI-windows-${arch}.zip`,
    }),
  },
  {
    channel: 'cli',
    re: new RegExp(`^Spirit-CLI-(?<version>${VERSION_IN_FILENAME_RE})-linux-(?<arch>x64|arm64)\\.tar\\.gz$`),
    toKey: ({ arch, version }) => ({
      os: 'linux',
      arch,
      version,
      fileName: `Spirit-CLI-linux-${arch}.tar.gz`,
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
  return `https://${PUBLIC_DOWNLOAD_HOST}/${objectKey}`;
}
