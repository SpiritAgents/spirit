const SUMMARY_DETAIL_MAX = 80;

function displayBasename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

export function truncateSummaryDetail(value: string, max = SUMMARY_DETAIL_MAX): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

export function parseDiagnosticsPathsFromRequest(request: unknown): string[] {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return [];
  }
  const paths = (request as Record<string, unknown>).paths;
  if (!Array.isArray(paths)) {
    return [];
  }
  const normalized: string[] = [];
  for (const entry of paths) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      normalized.push(trimmed);
    }
  }
  return normalized;
}

export function diagnosticsPathsHeadlineDetail(paths: readonly string[]): string | undefined {
  if (paths.length === 0) {
    return undefined;
  }
  const basenames = paths.map((entry) => displayBasename(entry));
  if (basenames.length === 1) {
    return truncateSummaryDetail(basenames[0]!);
  }
  if (basenames.length === 2) {
    return truncateSummaryDetail(`${basenames[0]}, ${basenames[1]}`);
  }
  return truncateSummaryDetail(`${basenames[0]} +${basenames.length - 1}`);
}
