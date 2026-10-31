import { product } from "@spiritagent/product";

export function interpolateProductCopy(template: string): string {
  return template.replace(/\{\{product\.([^}]+)\}\}/g, (_match, field: string) => {
    if (!Object.hasOwn(product, field)) {
      throw new Error(`Unknown product copy field: ${field}`);
    }
    return product[field as keyof typeof product];
  });
}

export function hydrateProductCopy(value: unknown): unknown {
  if (typeof value === "string") return interpolateProductCopy(value);
  if (Array.isArray(value)) return value.map(hydrateProductCopy);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, hydrateProductCopy(item)]),
    );
  }
  return value;
}
