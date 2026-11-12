import type { TFunction } from "i18next";

export const DOODLE_PLAIN_VARIANTS = ["startSomething", "letsBuild"] as const;

export const DOODLE_WORKSPACE_VARIANT = "doSomethingIn" as const;

export type DoodlePlainVariantId = (typeof DOODLE_PLAIN_VARIANTS)[number];

export type DoodleVariantId = DoodlePlainVariantId | typeof DOODLE_WORKSPACE_VARIANT;

export function doodlePool(includeWorkspaceVariants: boolean): readonly DoodleVariantId[] {
  if (includeWorkspaceVariants) {
    return [...DOODLE_PLAIN_VARIANTS, DOODLE_WORKSPACE_VARIANT];
  }
  return DOODLE_PLAIN_VARIANTS;
}

export function pickDoodleVariant(options: {
  includeWorkspaceVariants: boolean;
  random?: () => number;
}): DoodleVariantId {
  const pool = doodlePool(options.includeWorkspaceVariants);
  const random = options.random ?? Math.random;
  const index = Math.floor(random() * pool.length);
  return pool[Math.min(index, pool.length - 1)]!;
}

const doodleVariantBySessionKey = new Map<string, DoodleVariantId>();

type PendingNavDoodle = {
  navGeneration: number;
  variantId: DoodleVariantId;
};

let pendingNavDoodle: PendingNavDoodle | null = null;

export function normalizeDoodleSessionKey(sessionKey: string): string {
  return sessionKey.trim() || "__no-session__";
}

/** Roll and retain a doodle for in-flight session navigation before composerSessionKey updates. */
export function beginDoodleNavigation(
  navGeneration: number,
  options: {
    includeWorkspaceVariants: boolean;
    random?: () => number;
  },
): DoodleVariantId {
  const variantId = pickDoodleVariant(options);
  pendingNavDoodle = { navGeneration, variantId };
  return variantId;
}

export function activeDoodleNavigationVariant(navGeneration: number): DoodleVariantId | null {
  if (pendingNavDoodle?.navGeneration === navGeneration) {
    return pendingNavDoodle.variantId;
  }
  return null;
}

export function commitDoodleNavigation(navGeneration: number, sessionKey: string): void {
  if (pendingNavDoodle?.navGeneration !== navGeneration) {
    return;
  }
  doodleVariantBySessionKey.set(normalizeDoodleSessionKey(sessionKey), pendingNavDoodle.variantId);
  pendingNavDoodle = null;
}

export function cancelDoodleNavigation(navGeneration: number): void {
  if (pendingNavDoodle?.navGeneration === navGeneration) {
    pendingNavDoodle = null;
  }
}

/** Stable per-session variant; shared across hook instances so panes do not re-roll independently. */
export function resolveDoodleVariantForSession(
  sessionKey: string,
  options: {
    includeWorkspaceVariants: boolean;
    random?: () => number;
  },
): DoodleVariantId {
  const normalizedKey = normalizeDoodleSessionKey(sessionKey);
  let variantId = doodleVariantBySessionKey.get(normalizedKey);
  if (!variantId) {
    variantId = pickDoodleVariant(options);
    doodleVariantBySessionKey.set(normalizedKey, variantId);
  }
  return variantId;
}

export function resetDoodleStateForTests(): void {
  doodleVariantBySessionKey.clear();
  pendingNavDoodle = null;
}

export function resolveDoodle(
  t: TFunction,
  variantId: DoodleVariantId,
  workspaceLabel: string | null,
): string {
  return t(`app.doodle.${variantId}`, {
    workspace: workspaceLabel ?? "",
  });
}

export function isWorkspaceDoodleVariant(variantId: string): boolean {
  return variantId === DOODLE_WORKSPACE_VARIANT;
}
