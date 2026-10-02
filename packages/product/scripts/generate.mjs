import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

import { ProductSchema, QualitySchema, resolveProduct } from "../schema.ts";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const productInputs = [
  "product.json",
  "packages/product/schema.ts",
  "packages/product/scripts/generate.mjs",
];

const generatedNotice = "// Generated from product.json. Do not edit.\n";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function readProduct(quality = process.env.SPIRIT_PRODUCT_QUALITY ?? "stable") {
  return resolveProduct(
    JSON.parse(await readFile(path.join(repoRoot, "product.json"), "utf8")),
    quality,
  );
}

export async function inputFingerprint(root, quality) {
  const hash = createHash("sha256").update(quality).update("\0");
  for (const input of productInputs) {
    hash
      .update(input)
      .update("\0")
      .update(await readFile(path.join(root, input)))
      .update("\0");
  }
  return hash.digest("hex");
}

function fieldTypes() {
  const schema = z.toJSONSchema(ProductSchema);
  return Object.entries(schema.properties).map(([key, value]) => {
    if (value.type !== "string") {
      throw new Error(`Unsupported product field type: ${key}`);
    }
    return [
      key,
      value.enum ? value.enum.map((entry) => JSON.stringify(entry)).join(" | ") : "string",
    ];
  });
}

export function rustString(value) {
  // Rust accepts Unicode directly but its control-character escapes differ from JSON.
  return JSON.stringify(value).replace(/\\u([0-9a-f]{4})/gu, "\\u{$1}");
}

function snakeCase(value) {
  return value.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

export function renderProduct(product) {
  const json = JSON.stringify(product);
  const buildId = sha256(json);
  const fields = fieldTypes();
  const declarations = `export interface Product {\n${fields.map(([key, type]) => `  readonly ${key}: ${type};`).join("\n")}\n}\n`;
  const value = JSON.stringify(product, null, 2);
  const js = `${generatedNotice}export const product = Object.freeze(${value});\nexport const PRODUCT_BUILD_ID = ${JSON.stringify(buildId)};\n`;
  const types = `${generatedNotice}${declarations}export declare const product: Readonly<Product>;\nexport declare const PRODUCT_BUILD_ID: string;\n`;
  const ts = `${generatedNotice}${declarations}export const product: Readonly<Product> = Object.freeze(${value});\nexport const PRODUCT_BUILD_ID = ${JSON.stringify(buildId)};\n`;
  const rust = [
    generatedNotice.trimEnd(),
    "#[derive(Clone, Copy, Debug, PartialEq, Eq)]",
    "pub struct Product {",
    ...fields.map(([key]) => `    pub ${snakeCase(key)}: &'static str,`),
    "}",
    "pub const PRODUCT: Product = Product {",
    ...fields.map(([key]) => `    ${snakeCase(key)}: ${rustString(product[key])},`),
    "};",
    ...fields.map(
      ([key]) => `pub const ${snakeCase(key).toUpperCase()}: &str = PRODUCT.${snakeCase(key)};`,
    ),
    `pub const PRODUCT_BUILD_ID: &str = ${rustString(buildId)};`,
    "",
  ].join("\n");
  return { "index.js": js, "index.d.ts": types, "product.ts": ts, "product.rs": rust };
}

async function writeChanged(filePath, value) {
  try {
    if ((await readFile(filePath, "utf8")) === value) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, filePath);
}

export async function generateProduct({
  root = repoRoot,
  quality = process.env.SPIRIT_PRODUCT_QUALITY ?? "stable",
  outDir = path.join(root, "packages/product/dist"),
} = {}) {
  const selected = QualitySchema.parse(quality);
  const manifest = JSON.parse(await readFile(path.join(root, "product.json"), "utf8"));
  const product = resolveProduct(manifest, selected);
  const files = renderProduct(product);
  const fingerprint = await inputFingerprint(root, selected);
  files["inputs.sha256"] = `${selected}\n${fingerprint}\n${sha256(files["product.rs"])}\n`;
  await mkdir(outDir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await writeChanged(path.join(outDir, file), content);
  }
  return { product, files, outDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !["--root", "--quality", "--out-dir"].includes(flag)) {
      throw new Error("Usage: generate.mjs [--quality stable|dev] [--root path] [--out-dir path]");
    }
    options[flag === "--out-dir" ? "outDir" : flag.slice(2)] = value;
  }
  await generateProduct(options);
}
