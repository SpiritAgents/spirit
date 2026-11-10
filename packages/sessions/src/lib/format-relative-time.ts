const TIME_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: "year", seconds: 60 * 60 * 24 * 365 },
  { unit: "month", seconds: 60 * 60 * 24 * 30 },
  { unit: "week", seconds: 60 * 60 * 24 * 7 },
  { unit: "day", seconds: 60 * 60 * 24 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
  { unit: "second", seconds: 1 },
];

function createRelativeTimeFormatter(locale: string): {
  formatter: Intl.RelativeTimeFormat;
  locale: string;
} {
  const trimmed = locale.trim() || "en";
  try {
    return {
      formatter: new Intl.RelativeTimeFormat(trimmed, { numeric: "auto" }),
      locale: trimmed,
    };
  } catch {
    return {
      formatter: new Intl.RelativeTimeFormat("en", { numeric: "auto" }),
      locale: "en",
    };
  }
}

/** Intl zh-CN relative time has no space by default (e.g. 3分钟前); unify with PR-timeline-style UI copy as “3 分钟前”. */
function addZhRelativeTimeSpaces(text: string): string {
  return text.replace(/(\d)([\u4e00-\u9fff])/g, "$1 $2");
}

export function formatRelativeTime(isoTimestamp: string, locale: string): string {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) {
    return isoTimestamp;
  }

  const { formatter, locale: resolvedLocale } = createRelativeTimeFormatter(locale);
  const deltaSeconds = Math.round((parsed - Date.now()) / 1000);

  for (const { unit, seconds } of TIME_UNITS) {
    if (Math.abs(deltaSeconds) >= seconds || unit === "second") {
      const value = Math.round(deltaSeconds / seconds);
      const formatted = formatter.format(value, unit);
      return resolvedLocale.toLowerCase().startsWith("zh")
        ? addZhRelativeTimeSpaces(formatted)
        : formatted;
    }
  }

  return isoTimestamp;
}
