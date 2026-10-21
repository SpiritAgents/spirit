/** Renderer-safe Bedrock region / apiBase helpers (no Node or AWS SDK dependencies). */

export function normalizeAwsRegion(region: string): string {
  return region.trim().toLowerCase();
}

export function bedrockApiBaseFromRegion(region: string): string {
  const normalized = normalizeAwsRegion(region);
  if (!normalized) {
    return "https://bedrock.us-east-1.amazonaws.com";
  }
  return `https://bedrock.${normalized}.amazonaws.com`;
}

export function extractAwsRegionFromBedrockApiBase(baseUrl: string): string | undefined {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const match = normalized.match(/^https:\/\/bedrock\.([a-z0-9-]+)\.amazonaws\.com$/i);
  return match?.[1];
}
