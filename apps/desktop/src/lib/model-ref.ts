import type { ModelRef } from "@spiritagent/host-internal/config";

/**
 * Pure ModelRef helpers for the renderer bundle. `host-internal/config` carries `node:fs`
 * (config file IO), so the renderer cannot value-import it; these mirror the host-internal
 * helpers structurally.
 */
export function emptyModelRef(): ModelRef {
  return { providerId: "", name: "" };
}

export function isEmptyModelRef(ref: ModelRef | undefined): boolean {
  return !ref?.providerId?.trim() || !ref?.name?.trim();
}

export function modelRefsEqual(a: ModelRef | undefined, b: ModelRef | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return a.providerId === b.providerId && a.name === b.name;
}

export function modelRefKey(ref: ModelRef): string {
  return `${ref.providerId}::${ref.name}`;
}
