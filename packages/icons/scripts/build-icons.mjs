// Generates everything derived from the icon sources in icons/:
//   - src/icons/<name>.ts            React component modules (via createSpiritIcon)
//   - src/index.ts                   barrel with one named export per icon
//   - package.json                   per-icon subpath entries in "exports"
//   - .spirit-icon-preview/icons.json  data for the local preview page
//
// The generated files under src/ are gitignored; icons/*.svg + icons/*.json
// are the single source of truth. Run via `pnpm build` / `pnpm typecheck`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSvgIcon, verifyIcons } from "./verify-icons.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const ICONS_DIR = join(PACKAGE_ROOT, "icons");
const GENERATED_ICONS_DIR = join(PACKAGE_ROOT, "src", "icons");
const BARREL_FILE = join(PACKAGE_ROOT, "src", "index.ts");
const PACKAGE_MANIFEST = join(PACKAGE_ROOT, "package.json");
const PREVIEW_DATA_FILE = join(REPO_ROOT, ".spirit-icon-preview", "icons.json");

function toCamelCase(name) {
  return name.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function toPascalCase(name) {
  return name
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function renderIconModule(name, elements) {
  const entries = elements.map(({ tag, attributes }) => {
    const attrs = [...attributes]
      .map(([key, value]) => `${toCamelCase(key)}: ${JSON.stringify(value)}`)
      .join(", ");
    return `  [${JSON.stringify(tag)}, { ${attrs} }],`;
  });
  return `import { createSpiritIcon, type SpiritIconNode } from "../create-spirit-icon.js";

const iconNode: SpiritIconNode = [
${entries.join("\n")}
];

export const ${toPascalCase(name)} = createSpiritIcon(${JSON.stringify(name)}, iconNode);
`;
}

function renderBarrel(iconNames) {
  const lines = iconNames.map(
    (name) => `export { ${toPascalCase(name)} } from "./icons/${name}.js";`,
  );
  return `export {
  createSpiritIcon,
  type SpiritIconNode,
  type SpiritIconProps,
} from "./create-spirit-icon.js";
${lines.join("\n")}
`;
}

// Rewrites only the "exports" field, preserving the existing "." entry and
// leaving every other manifest field untouched.
function updatePackageExports(iconNames) {
  const manifest = JSON.parse(readFileSync(PACKAGE_MANIFEST, "utf8"));
  if (typeof manifest.exports?.["."] !== "object" || manifest.exports["."] === null) {
    throw new Error('build-icons: package.json must keep its existing "." export');
  }
  const exportsField = { ".": manifest.exports["."] };
  for (const name of iconNames) {
    exportsField[`./${name}`] = {
      types: `./dist/icons/${name}.d.ts`,
      default: `./dist/icons/${name}.js`,
    };
  }
  manifest.exports = exportsField;
  writeFileSync(PACKAGE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

// The preview page keeps one element per line, indentation stripped.
function extractPreviewBody(svgSource) {
  const open = svgSource.indexOf(">");
  const close = svgSource.lastIndexOf("</svg>");
  return svgSource
    .slice(open + 1, close)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

const { errors, iconNames } = verifyIcons();
if (errors.length > 0) {
  console.error("build-icons: icon source verification failed:");
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

mkdirSync(GENERATED_ICONS_DIR, { recursive: true });

const previewIcons = [];
for (const name of iconNames) {
  const svgSource = readFileSync(join(ICONS_DIR, `${name}.svg`), "utf8").trim();
  const { elements } = parseSvgIcon(svgSource);
  const { tags } = JSON.parse(readFileSync(join(ICONS_DIR, `${name}.json`), "utf8"));
  writeFileSync(join(GENERATED_ICONS_DIR, `${name}.ts`), renderIconModule(name, elements));
  previewIcons.push({ name, keywords: tags, body: extractPreviewBody(svgSource) });
}

writeFileSync(BARREL_FILE, renderBarrel(iconNames));
updatePackageExports(iconNames);
writeFileSync(PREVIEW_DATA_FILE, `${JSON.stringify(previewIcons, null, 2)}\n`);

console.log(
  `build-icons: generated ${iconNames.length} icon module(s), the barrel, package exports and preview data`,
);
