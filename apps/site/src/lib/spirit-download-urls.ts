import { product } from "@spiritagent/product";

/** Mirrors `scripts/release/selfhosted-paths.mjs` public CDN layout. */
export const SPIRIT_DOWNLOAD_HOST = new URL(product.downloadOrigin).host;

export type SpiritDownloadChannel = "desktop" | "cli";
export type SpiritDownloadOs = "darwin" | "windows" | "linux";
export type SpiritDownloadArch = "x64" | "arm64" | "ia32";

const DESKTOP_FILENAMES: Record<SpiritDownloadOs, Partial<Record<SpiritDownloadArch, string>>> = {
  darwin: {
    x64: `${product.name}-darwin-x64.dmg`,
    arm64: `${product.name}-darwin-arm64.dmg`,
  },
  windows: {
    x64: `${product.name}-windows-x64.exe`,
    ia32: `${product.name}-windows-ia32.exe`,
    arm64: `${product.name}-windows-arm64.exe`,
  },
  linux: {
    x64: `${product.name}-linux-x64.AppImage`,
    arm64: `${product.name}-linux-arm64.AppImage`,
  },
};

const CLI_FILENAMES: Record<SpiritDownloadOs, Partial<Record<SpiritDownloadArch, string>>> = {
  darwin: {
    x64: `${product.name}-CLI-darwin-x64.tar.gz`,
    arm64: `${product.name}-CLI-darwin-arm64.tar.gz`,
  },
  windows: {
    x64: `${product.name}-CLI-windows-x64.zip`,
    ia32: `${product.name}-CLI-windows-ia32.zip`,
    arm64: `${product.name}-CLI-windows-arm64.zip`,
  },
  linux: {
    x64: `${product.name}-CLI-linux-x64.tar.gz`,
    arm64: `${product.name}-CLI-linux-arm64.tar.gz`,
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
  return new URL(spiritDownloadObjectKey(channel, os, arch, version), `${product.downloadOrigin}/`)
    .href;
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
