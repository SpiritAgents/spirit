/** Mirrors Spirit `scripts/release/selfhosted-paths.mjs` public CDN layout. */

export const SPIRIT_DOWNLOAD_HOST = "download.spirit.dev";

export type SpiritDownloadChannel = "desktop" | "cli";
export type SpiritDownloadOs = "darwin" | "windows" | "linux";
export type SpiritDownloadArch = "x64" | "arm64" | "ia32";

const DESKTOP_FILENAMES: Record<SpiritDownloadOs, Partial<Record<SpiritDownloadArch, string>>> = {
  darwin: {
    x64: "Spirit-darwin-x64.dmg",
    arm64: "Spirit-darwin-arm64.dmg",
  },
  windows: {
    x64: "Spirit-windows-x64.exe",
    ia32: "Spirit-windows-ia32.exe",
    arm64: "Spirit-windows-arm64.exe",
  },
  linux: {
    x64: "Spirit-linux-x64.AppImage",
    arm64: "Spirit-linux-arm64.AppImage",
  },
};

const CLI_FILENAMES: Record<SpiritDownloadOs, Partial<Record<SpiritDownloadArch, string>>> = {
  darwin: {
    x64: "Spirit-CLI-darwin-x64.tar.gz",
    arm64: "Spirit-CLI-darwin-arm64.tar.gz",
  },
  windows: {
    x64: "Spirit-CLI-windows-x64.zip",
    ia32: "Spirit-CLI-windows-ia32.zip",
    arm64: "Spirit-CLI-windows-arm64.zip",
  },
  linux: {
    x64: "Spirit-CLI-linux-x64.tar.gz",
    arm64: "Spirit-CLI-linux-arm64.tar.gz",
  },
};

function fileNameFor(
  channel: SpiritDownloadChannel,
  os: SpiritDownloadOs,
  arch: SpiritDownloadArch,
): string {
  const table = channel === "cli" ? CLI_FILENAMES : DESKTOP_FILENAMES;
  const fileName = table[os]?.[arch];
  if (!fileName) {
    throw new Error(`Unsupported download target: ${channel}/${os}/${arch}`);
  }
  return fileName;
}

export function spiritDownloadObjectKey(
  channel: SpiritDownloadChannel,
  os: SpiritDownloadOs,
  arch: SpiritDownloadArch,
  version: "latest" | string = "latest",
): string {
  return `${channel}/${os}/${arch}/${version}/${fileNameFor(channel, os, arch)}`;
}

export function spiritDownloadUrl(
  channel: SpiritDownloadChannel,
  os: SpiritDownloadOs,
  arch: SpiritDownloadArch,
  version: "latest" | string = "latest",
): string {
  return `https://${SPIRIT_DOWNLOAD_HOST}/${spiritDownloadObjectKey(channel, os, arch, version)}`;
}

export function spiritDesktopDownloadUrl(
  os: SpiritDownloadOs,
  arch: SpiritDownloadArch,
  version: "latest" | string = "latest",
): string {
  return spiritDownloadUrl("desktop", os, arch, version);
}

export function spiritCliDownloadUrl(
  os: SpiritDownloadOs,
  arch: SpiritDownloadArch,
  version: "latest" | string = "latest",
): string {
  return spiritDownloadUrl("cli", os, arch, version);
}
