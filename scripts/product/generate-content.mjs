import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument, visit } from "yaml";
import { resolveProduct } from "../../packages/product/schema.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function renderProductText(source, products) {
  return source.replace(
    /\{\{product\.([a-zA-Z.]+)(?:\|([a-z]+))?\}\}/g,
    (_match, selector, filter) => {
      const parts = selector.split(".");
      const selected = parts.length === 2 ? products[parts.shift()] : products.current;
      const field = parts[0];
      if (!selected || parts.length !== 1 || !Object.hasOwn(selected, field)) {
        throw new Error(`Unknown product template field: ${selector}`);
      }
      const value = selected[field];
      if (!filter) return value;
      if (filter === "json") return JSON.stringify(value);
      if (filter === "host") return new URL(value).host;
      if (filter === "html" || filter === "mdx") {
        const escaped = value.replace(
          /[&<>"']/g,
          (character) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[character],
        );
        return filter === "mdx"
          ? escaped.replaceAll("{", "&#123;").replaceAll("}", "&#125;")
          : escaped;
      }
      throw new Error(`Unknown product template filter: ${filter}`);
    },
  );
}

export function renderProductTemplate(source, products, filename) {
  if (!source.includes("{{product.")) return source;
  const render = (value) => renderProductText(value, products);
  if (filename.endsWith(".json")) {
    return (
      JSON.stringify(
        JSON.parse(source, (_key, value) => (typeof value === "string" ? render(value) : value)),
        null,
        2,
      ) + "\n"
    );
  }
  const frontmatter = /^(---\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!frontmatter || !frontmatter[2].includes("{{product.")) return render(source);
  const document = parseDocument(frontmatter[2]);
  if (document.errors.length) throw document.errors[0];
  visit(document, {
    Scalar(_key, node) {
      if (typeof node.value === "string") node.value = render(node.value);
    },
  });
  return `---\n${document.toString()}---\n${render(source.slice(frontmatter[0].length))}`;
}

async function filesUnder(directory, optional = false) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (optional && error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(filename)));
    else if (entry.isFile()) files.push(filename);
  }
  return files.sort();
}

export async function generateProductContent({
  root = repoRoot,
  quality = process.env.SPIRIT_PRODUCT_QUALITY ?? "stable",
  scope = "all",
  check = false,
} = {}) {
  if (!["all", "site", "built-in"].includes(scope)) {
    throw new Error(`Unknown product content scope: ${scope}`);
  }
  const manifest = JSON.parse(await readFile(path.join(root, "product.json"), "utf8"));
  const products = {
    current: resolveProduct(manifest, quality),
    stable: resolveProduct(manifest, "stable"),
    dev: resolveProduct(manifest, "dev"),
  };
  const entries = [];
  const generatedRoots = [];
  const addTree = async (sourceRoot, outputRoot) => {
    for (const source of await filesUnder(sourceRoot)) {
      entries.push({ source, output: path.join(outputRoot, path.relative(sourceRoot, source)) });
    }
  };
  if (scope === "all" || scope === "site") {
    const outputRoot = path.join(root, "apps/site/.generated/product/docs");
    await addTree(path.join(root, "apps/site/content/docs"), outputRoot);
    generatedRoots.push(outputRoot);
  }
  if (scope === "all" || scope === "built-in") {
    const sourceRoot = path.join(root, "packages/host-internal/built-in");
    const outputRoot = path.join(root, "packages/host-internal/dist/resources/built-in");
    await addTree(path.join(sourceRoot, "skills"), path.join(outputRoot, "skills"));
    entries.push({
      source: path.join(sourceRoot, "marketplace.json"),
      output: path.join(outputRoot, products.current.workspaceDataFolderName, "marketplace.json"),
    });
    generatedRoots.push(outputRoot);
  }
  const outputs = [];
  for (const { source, output } of entries) {
    const content = await readFile(source);
    let rendered = content;
    if (/\.(mdx?|json)$/.test(source)) {
      const text = renderProductTemplate(content.toString("utf8"), products, source);
      if (/\{\{product\./.test(text)) {
        throw new Error(`Unresolved product placeholder in ${source}`);
      }
      rendered = Buffer.from(text);
    }
    let previous;
    try {
      previous = await readFile(output);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!previous?.equals(rendered)) {
      if (check) throw new Error(`Stale product content: ${path.relative(root, output)}`);
      await mkdir(path.dirname(output), { recursive: true });
      const temporary = `${output}.${process.pid}.tmp`;
      await writeFile(temporary, rendered);
      await rename(temporary, output);
    }
    outputs.push(path.relative(root, output));
  }
  const expected = new Set(entries.map(({ output }) => output));
  for (const outputRoot of generatedRoots) {
    for (const file of await filesUnder(outputRoot, true)) {
      // Extension bundles are managed separately by assemble-built-in-extensions.
      if (path.relative(outputRoot, file).startsWith(`extensions${path.sep}`)) continue;
      if (expected.has(file)) continue;
      if (check) throw new Error(`Stale product content: ${path.relative(root, file)}`);
      await unlink(file);
    }
  }
  return outputs;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  let scope = "all";
  let check = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--check") check = true;
    else if (args[index] === "--scope" && args[index + 1]) scope = args[++index];
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  const outputs = await generateProductContent({ scope, check });
  console.log(
    `${check ? "Checked" : "Generated"} ${outputs.length} product content files (${scope}).`,
  );
}
