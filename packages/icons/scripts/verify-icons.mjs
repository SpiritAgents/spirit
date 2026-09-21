// Validates the icon sources in packages/icons/icons/ against the package
// conventions: one standalone 24x24 SVG per icon carrying the full default
// attribute set on its root, a whitelisted self-closing element set,
// double-quoted attributes only, no external references, and a sibling
// .json metadata file holding search tags.

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICONS_DIR = fileURLToPath(new URL("../icons", import.meta.url));

const ROOT_ATTRIBUTES = new Map([
  ["xmlns", "http://www.w3.org/2000/svg"],
  ["width", "24"],
  ["height", "24"],
  ["viewBox", "0 0 24 24"],
  ["fill", "none"],
  ["stroke", "currentColor"],
  ["stroke-width", "2"],
  ["stroke-linecap", "round"],
  ["stroke-linejoin", "round"],
]);

const ALLOWED_ELEMENTS = new Set(["path", "rect", "circle", "line", "polyline", "polygon"]);
const ALLOWED_COLOR_VALUES = new Set(["currentColor", "none"]);
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class ParseFailure extends Error {}

// Parses an icon SVG source into its root attributes and child elements.
// The grammar is intentionally strict so the sources stay reviewable as data:
// exactly one <svg> root, self-closing whitelisted children only, attributes
// separated by whitespace and always double-quoted.
export function parseSvgIcon(source) {
  let pos = 0;

  const fail = (reason) => {
    throw new ParseFailure(`${reason} (offset ${pos})`);
  };

  const skipWhitespace = () => {
    while (pos < source.length && /\s/.test(source[pos])) pos += 1;
  };

  const readName = () => {
    const match = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(source.slice(pos));
    if (!match) fail("expected an identifier");
    pos += match[0].length;
    return match[0];
  };

  // Reads attributes up to and including the tag terminator (">" or "/>").
  const readAttributes = () => {
    const attributes = new Map();
    for (;;) {
      skipWhitespace();
      if (source.startsWith("/>", pos)) {
        pos += 2;
        return { attributes, selfClosing: true };
      }
      if (source[pos] === ">") {
        pos += 1;
        return { attributes, selfClosing: false };
      }
      if (pos >= source.length) fail("unexpected end of input inside a tag");
      const name = readName();
      skipWhitespace();
      if (source[pos] !== "=") fail(`attribute "${name}" must be followed by "="`);
      pos += 1;
      skipWhitespace();
      if (source[pos] !== '"') fail(`attribute "${name}" must use double quotes`);
      pos += 1;
      const end = source.indexOf('"', pos);
      if (end === -1) fail(`attribute "${name}" is missing its closing quote`);
      const value = source.slice(pos, end);
      pos = end + 1;
      if (attributes.has(name)) fail(`duplicate attribute "${name}"`);
      attributes.set(name, value);
      if (pos < source.length && !/[\s/>]/.test(source[pos])) {
        fail(`attributes must be separated by whitespace (after "${name}")`);
      }
    }
  };

  skipWhitespace();
  if (!source.startsWith("<svg", pos)) fail("file must contain a single <svg> root element");
  pos += 4;
  if (pos >= source.length || !/\s/.test(source[pos])) fail("expected whitespace after <svg");
  const root = readAttributes();
  if (root.selfClosing) fail("the root <svg> element must wrap its children, not self-close");

  const elements = [];
  for (;;) {
    skipWhitespace();
    if (source.startsWith("</svg>", pos)) {
      pos += "</svg>".length;
      break;
    }
    if (pos >= source.length) fail("missing the </svg> closing tag");
    if (source[pos] !== "<") fail("unexpected text between elements");
    pos += 1;
    if (source[pos] === "/")
      fail("child elements must be self-closing; only </svg> may close here");
    const tag = readName();
    const child = readAttributes();
    if (!child.selfClosing) fail(`element <${tag}> must be self-closing`);
    elements.push({ tag, attributes: child.attributes });
  }
  skipWhitespace();
  if (pos !== source.length) fail("unexpected content after </svg>");
  if (elements.length === 0) fail("icon declares no drawable elements");
  return { rootAttributes: root.attributes, elements };
}

function checkRootAttributes(attributes) {
  if (attributes.size !== ROOT_ATTRIBUTES.size) {
    return `root element must declare exactly the ${ROOT_ATTRIBUTES.size} default attributes`;
  }
  for (const [name, value] of ROOT_ATTRIBUTES) {
    const actual = attributes.get(name);
    if (actual === undefined) return `root element is missing attribute "${name}"`;
    if (actual !== value) {
      return `root attribute "${name}" must be ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`;
    }
  }
  return null;
}

function checkElement({ tag, attributes }) {
  if (!ALLOWED_ELEMENTS.has(tag)) return `element <${tag}> is not in the allowed set`;
  for (const [name, value] of attributes) {
    if (name === "href" || name.endsWith(":href")) {
      return `<${tag}> must not use "${name}"; external references are forbidden`;
    }
    if (/https?:/i.test(value) || /url\(/i.test(value)) {
      return `<${tag}> attribute "${name}" must not contain external references`;
    }
    if ((name === "fill" || name === "stroke") && !ALLOWED_COLOR_VALUES.has(value)) {
      return `<${tag}> attribute "${name}" must be "currentColor" or "none", got ${JSON.stringify(value)}`;
    }
  }
  return null;
}

export function verifyIcons() {
  const errors = [];
  const files = readdirSync(ICONS_DIR, { withFileTypes: true });
  const svgNames = files
    .filter((file) => file.isFile() && file.name.endsWith(".svg"))
    .map((file) => basename(file.name, ".svg"))
    .sort();
  const jsonNames = files
    .filter((file) => file.isFile() && file.name.endsWith(".json"))
    .map((file) => basename(file.name, ".json"))
    .sort();

  if (svgNames.length === 0) errors.push("icons/: no .svg sources found");

  for (const name of svgNames) {
    const svgLabel = `icons/${name}.svg`;
    if (!KEBAB_CASE.test(name)) errors.push(`${svgLabel}: file name must be kebab-case`);

    let parsed;
    try {
      parsed = parseSvgIcon(readFileSync(join(ICONS_DIR, `${name}.svg`), "utf8").trim());
    } catch (error) {
      if (error instanceof ParseFailure) {
        errors.push(`${svgLabel}: ${error.message}`);
        continue;
      }
      throw error;
    }
    const rootError = checkRootAttributes(parsed.rootAttributes);
    if (rootError) errors.push(`${svgLabel}: ${rootError}`);
    for (const element of parsed.elements) {
      const elementError = checkElement(element);
      if (elementError) errors.push(`${svgLabel}: ${elementError}`);
    }

    const jsonLabel = `icons/${name}.json`;
    let rawMetadata;
    try {
      rawMetadata = readFileSync(join(ICONS_DIR, `${name}.json`), "utf8");
    } catch {
      errors.push(`${jsonLabel}: missing metadata file for ${name}.svg`);
      continue;
    }
    let metadata;
    try {
      metadata = JSON.parse(rawMetadata);
    } catch {
      errors.push(`${jsonLabel}: invalid JSON`);
      continue;
    }
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      errors.push(`${jsonLabel}: metadata must be a JSON object`);
    } else if (
      !Array.isArray(metadata.tags) ||
      metadata.tags.some((tag) => typeof tag !== "string")
    ) {
      errors.push(`${jsonLabel}: "tags" must be an array of strings`);
    }
  }

  for (const name of jsonNames) {
    if (!svgNames.includes(name)) errors.push(`icons/${name}.json: no matching .svg source`);
  }

  return { errors, iconNames: svgNames };
}

function isMainModule() {
  try {
    return (
      process.argv[1] != null &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const { errors, iconNames } = verifyIcons();
  if (errors.length > 0) {
    console.error(`verify-icons: ${errors.length} problem(s) found:`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(`verify-icons: ${iconNames.length} icon(s) OK`);
}
