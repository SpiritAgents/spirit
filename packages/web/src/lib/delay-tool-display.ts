import type { ToolBlockSnapshot } from "../types.js";

type Unit = "day" | "hour" | "minute" | "second";
type NativePart = { type: string; value: string; unit?: string };
type DurationValues = Record<`${Unit}s`, number>;

export interface DurationSegment {
  unit: Unit;
  value: number;
  number: string;
  suffix: string;
  separator: string;
}

export function durationSegments(seconds: number, locale: string): DurationSegment[] {
  const total = Math.max(0, Math.round(seconds));
  const values: DurationValues = {
    days: Math.floor(total / 86_400),
    hours: Math.floor(total / 3_600) % 24,
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
  };
  const parts: NativePart[] = [];
  if (typeof Intl.DurationFormat === "function") {
    parts.push(
      ...new Intl.DurationFormat(locale, {
        style: "narrow",
        secondsDisplay: total === 0 ? "always" : "auto",
      }).formatToParts(values),
    );
  } else {
    const units = (["day", "hour", "minute", "second"] as const).filter(
      (unit) => values[`${unit}s`] > 0 || (total === 0 && unit === "second"),
    );
    for (const part of new Intl.ListFormat(locale, { style: "narrow", type: "unit" }).formatToParts(
      units,
    )) {
      if (part.type === "literal") {
        parts.push(part);
      } else {
        const unit = units.find((unit) => unit === part.value)!;
        parts.push(
          ...new Intl.NumberFormat(locale, {
            style: "unit",
            unit,
            unitDisplay: "narrow",
          })
            .formatToParts(values[`${unit}s`])
            .map((part) => ({ ...part, unit })),
        );
      }
    }
  }
  const segments: DurationSegment[] = [];
  for (const part of parts) {
    if (!part.unit) {
      const previous = segments.at(-1);
      if (previous) previous.separator += part.value;
      continue;
    }
    if (
      part.unit !== "day" &&
      part.unit !== "hour" &&
      part.unit !== "minute" &&
      part.unit !== "second"
    ) {
      throw new Error(`Unexpected duration unit: ${part.unit}`);
    }
    let segment = segments.at(-1);
    if (!segment || segment.unit !== part.unit) {
      segment = {
        unit: part.unit,
        value: values[`${part.unit}s`],
        number: "",
        suffix: "",
        separator: "",
      };
      segments.push(segment);
    }
    if (part.type === "integer" || part.type === "group") segment.number += part.value;
    else segment.suffix += part.value;
  }
  if (locale.toLowerCase().startsWith("zh")) {
    for (const [index, segment] of segments.entries()) {
      segment.suffix = ` ${segment.suffix.trim()}`;
      segment.separator = index < segments.length - 1 ? " " : "";
    }
  }
  return segments;
}

export function durationText(seconds: number, locale: string): string {
  return durationSegments(seconds, locale)
    .map((part) => part.number + part.suffix + part.separator)
    .join("");
}

export function delayArguments(tool: ToolBlockSnapshot): { seconds?: number; task_id?: string } {
  try {
    const args: unknown = JSON.parse(tool.argsExcerpt || "{}");
    if (typeof args !== "object" || args === null) return {};
    return {
      ...("seconds" in args &&
      typeof args.seconds === "number" &&
      Number.isFinite(args.seconds) &&
      args.seconds >= 0
        ? { seconds: args.seconds }
        : {}),
      ...("task_id" in args && typeof args.task_id === "string" ? { task_id: args.task_id } : {}),
    };
  } catch (error) {
    // Streaming argument previews can end in the middle of a JSON token.
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

export function delayDisplaySeconds(tool: ToolBlockSnapshot, now = Date.now()): number | undefined {
  if (tool.delay?.elapsedMs !== undefined)
    return Math.max(0, Math.round(tool.delay.elapsedMs / 1000));
  if (tool.phase === "succeeded" || tool.phase === "failed") return undefined;
  if (tool.delay?.deadlineUnixMs !== undefined) {
    return Math.max(
      tool.delay.deadlineUnixMs > tool.delay.startedAtUnixMs ? 1 : 0,
      Math.ceil((tool.delay.deadlineUnixMs - now) / 1000),
    );
  }
  return delayArguments(tool).seconds;
}
