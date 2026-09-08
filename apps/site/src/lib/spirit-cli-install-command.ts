import { detectSpiritDownloadPlatform } from "@/lib/spirit-download-platform";

export const SPIRIT_CLI_INSTALL_CURL = "curl -fsSL https://spirit.dev/install | bash";

export const SPIRIT_CLI_INSTALL_POWERSHELL = "irm https://spirit.dev/install.ps1 | iex";

/** Returns the one-liner install command for the current (or given) platform. */
export function resolveSpiritCliInstallCommand(
  platform: ReturnType<typeof detectSpiritDownloadPlatform> | "auto" = "auto",
): string {
  const resolved = platform === "auto" ? detectSpiritDownloadPlatform() : platform;
  if (resolved === "Windows") {
    return SPIRIT_CLI_INSTALL_POWERSHELL;
  }
  return SPIRIT_CLI_INSTALL_CURL;
}
