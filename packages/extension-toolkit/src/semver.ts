/**
 * Strict semver for marketplace entries: `major.minor.patch` only.
 * Pre-release and build metadata are rejected for now (registry CI rule);
 * comparison and update ordering hang off this single parser.
 */

export interface MarketplaceVersion {
  major: number;
  minor: number;
  patch: number;
}

const MARKETPLACE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function parseMarketplaceVersion(
  version: string,
  fieldName = "version",
): MarketplaceVersion {
  const match = MARKETPLACE_VERSION_PATTERN.exec(version.trim());
  if (!match) {
    throw new Error(
      `${fieldName} must be a valid semver "major.minor.patch" without pre-release or build metadata, got: ${version}`,
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isMarketplaceVersionString(version: string): boolean {
  return MARKETPLACE_VERSION_PATTERN.test(version.trim());
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareMarketplaceVersions(a: MarketplaceVersion, b: MarketplaceVersion): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

/** True when `candidate` is strictly newer than `installed` (both strict version strings). */
export function isMarketplaceVersionNewer(candidate: string, installed: string): boolean {
  return (
    compareMarketplaceVersions(
      parseMarketplaceVersion(candidate, "candidate version"),
      parseMarketplaceVersion(installed, "installed version"),
    ) > 0
  );
}
