import { z } from "zod";

export const QualitySchema = z.enum(["stable", "dev"]);

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

const FolderNameSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value === value.trim() &&
      value !== "." &&
      value !== ".." &&
      !/[<>:"/\\|?*]/u.test(value) &&
      !hasControlCharacter(value) &&
      !/[. ]$/u.test(value) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value),
    "Expected a portable single relative directory name",
  );

const OriginSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      value === url.origin
    );
  } catch {
    return false;
  }
}, "Expected a normalized HTTP(S) origin without credentials, path, query or fragment");

export const ProductSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .refine(
      (value) => value === value.trim() && !hasControlCharacter(value),
      "Expected a non-empty single-line product display name",
    ),
  websiteOrigin: OriginSchema,
  downloadOrigin: OriginSchema,
  userDataFolderName: FolderNameSchema,
  workspaceDataFolderName: FolderNameSchema,
  quality: QualitySchema,
  urlProtocol: z.string().regex(/^[a-z][a-z0-9+.-]*$/u),
});

const QualityFieldsSchema = ProductSchema.pick({
  userDataFolderName: true,
  urlProtocol: true,
});

export const ProductManifestSchema = ProductSchema.omit({
  userDataFolderName: true,
  quality: true,
  urlProtocol: true,
}).extend({
  qualities: z.strictObject({
    stable: QualityFieldsSchema,
    dev: QualityFieldsSchema,
  }),
});

export type Product = z.infer<typeof ProductSchema>;

export function resolveProduct(manifest: unknown, quality: unknown): Product {
  const { qualities, ...common } = ProductManifestSchema.parse(manifest);
  const selected = QualitySchema.parse(quality);
  return ProductSchema.parse({ ...common, ...qualities[selected], quality: selected });
}
