import type { ModelRef } from "./types.js";

/** Pure ModelRef helpers; structurally compatible with the host config's ModelRef. */
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

export type { ModelRef };
