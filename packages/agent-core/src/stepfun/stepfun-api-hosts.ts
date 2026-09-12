const STEPFUN_DEFAULT_ORIGIN = "https://api.stepfun.com";

export function isStepfunApiHostname(hostname: string): boolean {
  return hostname === "api.stepfun.com" || hostname === "api.stepfun.ai";
}

export function resolveStepfunV1Url(baseUrl: string | undefined, path: string): string {
  const origin = resolveStepfunApiOrigin(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}/v1${normalizedPath}`;
}

function resolveStepfunApiOrigin(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return STEPFUN_DEFAULT_ORIGIN;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return STEPFUN_DEFAULT_ORIGIN;
  }
}
