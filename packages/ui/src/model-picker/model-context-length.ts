/** Renderer-safe: no host service or storage imports. */

export function parseModelContextLength(value: unknown): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    return undefined;
  }

  return value;
}
