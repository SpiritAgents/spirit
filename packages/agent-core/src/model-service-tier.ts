import type { JsonObject } from "./ports.js";

/**
 * Canonical per-model service tier preference stored in the host config (`serviceTier`).
 * The enum is the public tier vocabulary; the picker and validation read only the model's
 * declared `serviceTiers`, and the wire effect comes from the fixed transport API table
 * (simple form) or the literal per-tier declaration (literal form). See
 * `service-tier-request.ts` for the wire mapping.
 */
export type ModelServiceTier = "auto" | "default" | "flex" | "fast" | "priority" | "ultrafast";

export const MODEL_SERVICE_TIERS: readonly ModelServiceTier[] = [
  "auto",
  "default",
  "flex",
  "fast",
  "priority",
  "ultrafast",
];

/**
 * Literal `serviceTiers` form: per-tier wire effects declared verbatim (headers/body patches), so
 * the runtime applies the selected tier's literals with zero internal mapping. Used for routes
 * whose mapping varies per upstream (e.g. aggregation gateways).
 */
export interface ModelServiceTierWireDeclaration {
  headers?: Record<string, string>;
  body?: JsonObject;
  /**
   * AI SDK providerOptions fragment (per upstream namespace) for surfaces that serialize call
   * providerOptions (the gateway v3 language-model protocol); ignored elsewhere.
   */
  providerOptions?: JsonObject;
}

/** One literal tier: its wire effect plus an optional availability limit, which is never sent upstream. */
export interface ModelServiceTierDeclaration extends ModelServiceTierWireDeclaration {
  /** Maximum request input tokens supported by this tier; the boundary itself is inclusive. */
  maxInputTokens?: number;
}

/** Literal `serviceTiers` map: tier name → declaration. The simple form is `ModelServiceTier[]`. */
export type ModelServiceTiersLiteralDeclaration = Record<string, ModelServiceTierDeclaration>;

/** Declared `serviceTiers` block: either the simple tier-name list or the literal wire map. */
export type ModelServiceTiersDeclaration =
  | readonly ModelServiceTier[]
  | ModelServiceTiersLiteralDeclaration;

export function serviceTierMaxInputTokens(
  declaration: ModelServiceTiersDeclaration | undefined,
  tier: ModelServiceTier,
): number | undefined {
  if (declaration === undefined || Array.isArray(declaration)) {
    return undefined;
  }
  return (declaration as ModelServiceTiersLiteralDeclaration)[tier]?.maxInputTokens;
}

export function isServiceTierAvailableForInputTokens(
  declaration: ModelServiceTiersDeclaration | undefined,
  tier: ModelServiceTier,
  lastInputTokens: number | undefined,
): boolean {
  const maxInputTokens = serviceTierMaxInputTokens(declaration, tier);
  return (
    maxInputTokens === undefined ||
    lastInputTokens === undefined ||
    lastInputTokens <= maxInputTokens
  );
}

/**
 * Resolves the effective tier without mutating the stored preference. An unavailable preference
 * falls back to a declared, available `default`; without one, no tier wire effect is produced.
 */
export function resolveEffectiveServiceTier(input: {
  serviceTier?: ModelServiceTier;
  serviceTiers?: ModelServiceTiersDeclaration;
  lastInputTokens?: number;
}): ModelServiceTier | undefined {
  const tier = input.serviceTier;
  if (
    tier === undefined ||
    isServiceTierAvailableForInputTokens(input.serviceTiers, tier, input.lastInputTokens)
  ) {
    return tier;
  }
  if (
    input.serviceTiers !== undefined &&
    (Array.isArray(input.serviceTiers)
      ? input.serviceTiers.includes("default")
      : Object.keys(input.serviceTiers).includes("default")) &&
    isServiceTierAvailableForInputTokens(input.serviceTiers, "default", input.lastInputTokens)
  ) {
    return "default";
  }
  return undefined;
}

/** Raised when a stored `serviceTier` value is not part of the public enum. */
export class ModelServiceTierConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelServiceTierConfigError";
  }
}

export function normalizeModelServiceTier(value: unknown): ModelServiceTier | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return (MODEL_SERVICE_TIERS as readonly string[]).includes(trimmed)
    ? (trimmed as ModelServiceTier)
    : undefined;
}
