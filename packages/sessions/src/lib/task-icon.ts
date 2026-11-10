import type { ComponentType } from "react";

import { iconNames } from "lucide-react/dynamic";
import * as spiritIcons from "@spiritagent/icons";

export type TaskIconComponent = ComponentType<{
  className?: string;
  strokeWidth?: number | string;
}>;

/**
 * Pure icon resolution (no rendering): Spirit Icons first, then Lucide by kebab name.
 * Tasks that declare no `icon.id` (or an unresolvable one) get no icon at all. The row
 * component renders spirit components directly and lucide matches through DynamicIcon.
 */
export type TaskIconResolution =
  | { kind: "spirit"; component: TaskIconComponent }
  | { kind: "lucide"; name: string }
  | { kind: "none" };

const lucideIconNames: readonly string[] = iconNames;

function toPascalCase(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function toKebabCase(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function isIconComponent(value: unknown): value is TaskIconComponent {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}

export function resolveTaskIcon(iconId?: string): TaskIconResolution {
  const trimmed = iconId?.trim() ?? "";
  if (trimmed) {
    const spirit = (spiritIcons as Record<string, unknown>)[toPascalCase(trimmed)];
    if (isIconComponent(spirit)) {
      return { kind: "spirit", component: spirit };
    }
    const kebab = toKebabCase(trimmed);
    if (lucideIconNames.includes(kebab)) {
      return { kind: "lucide", name: kebab };
    }
  }
  return { kind: "none" };
}
