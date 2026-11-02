/** Renderer-safe: no host-internal / host/storage imports. */

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
