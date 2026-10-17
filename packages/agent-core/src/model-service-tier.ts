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
}

/** Literal `serviceTiers` map: tier name → wire declaration. The simple form is `ModelServiceTier[]`. */
export type ModelServiceTiersLiteralDeclaration = Record<string, ModelServiceTierWireDeclaration>;

/** Declared `serviceTiers` block: either the simple tier-name list or the literal wire map. */
export type ModelServiceTiersDeclaration =
  | readonly ModelServiceTier[]
  | ModelServiceTiersLiteralDeclaration;

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
