import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PINNED_SHADCN_UI_MIT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "third-party-notices",
  "shadcn-ui.MIT.txt"
);

export function readPinnedShadcnUiMit() {
  return readFileSync(PINNED_SHADCN_UI_MIT, "utf8");
}

/** Appendix after scanned npm licenses. Fence body is the pinned file bytes unchanged. */
export function buildShadcnUiCopiedNoticeAppendix(pinnedMitText) {
  const body = pinnedMitText.endsWith("\n") ? pinnedMitText : `${pinnedMitText}\n`;
  return (
    [
      "",
      "## Copied UI",
      "",
      "Inlined styles from [shadcn/ui](https://github.com/shadcn-ui/ui) are copied into this app. This is not an npm package listed above.",
      "",
      "```",
      "",
    ].join("\n") +
    body +
    "```\n"
  );
}

function appendShadcnUiCopiedNotice(noticePath) {
  const existing = readFileSync(noticePath, "utf8");
  const prefix = existing.endsWith("\n") ? existing : `${existing}\n`;
  writeFileSync(noticePath, prefix + buildShadcnUiCopiedNoticeAppendix(readPinnedShadcnUiMit()), "utf8");
}

const LICENSE_FILE_NAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "COPYING",
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function dependencyEntries(pkgJson, productionOnly) {
  const entries = [];
  const add = (deps) => {
    if (!deps) return;
    entries.push(...Object.entries(deps));
  };

  add(pkgJson.dependencies);
  add(pkgJson.optionalDependencies);
  if (!productionOnly) add(pkgJson.devDependencies);

  return entries;
}

function workspaceLocalDependencyNames(pkgJson) {
  const names = new Set();
  for (const [name, spec] of dependencyEntries(pkgJson, false)) {
    if (typeof spec === "string" && (spec.startsWith("file:") || spec.startsWith("workspace:"))) {
      names.add(name);
    }
  }
  return names;
}

function directDependencyNames(pkgJson, productionOnly) {
  return new Set(dependencyEntries(pkgJson, productionOnly).map(([name]) => name));
}

function normalizeRepoUrl(url) {
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/\.git$/, "");
}

function repoUrl(info) {
  const repository = info.repository;
  if (typeof repository === "string") return normalizeRepoUrl(repository);
  if (repository && typeof repository.url === "string") return normalizeRepoUrl(repository.url);
  if (typeof info.homepage === "string") return normalizeRepoUrl(info.homepage);
  return "";
}

function licenseLabel(license) {
  if (typeof license === "string" && license.trim()) return license.trim();
  if (Array.isArray(license)) {
    return license
      .map((item) => (typeof item === "string" ? item : item?.type))
      .filter(Boolean)
      .join(" OR ");
  }
  if (license && typeof license === "object" && "type" in license) {
    const type = license.type;
    if (typeof type === "string") return type;
  }
  return "UNKNOWN";
}

function isPlatformSpecificPackage(name) {
  if (/^@rolldown\/binding-/.test(name)) return true;
  if (/^@tailwindcss\/oxide-/.test(name)) return true;
  if (/^lightningcss-(darwin|win32|linux|freebsd|android)/.test(name)) return true;
  if (/^@esbuild\//.test(name)) return true;
  if (name === "fsevents") return true;
  return false;
}

function findLicenseInDir(dir) {
  for (const fileName of LICENSE_FILE_NAMES) {
    const filePath = path.join(dir, fileName);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

function hashContent(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * @typedef {{ name?: string, from?: string, version?: string, path?: string, dependencies?: Record<string, PnpmListNode> }} PnpmListNode
 */

/**
 * pnpm list (not license-checker): hoisted node_modules is invisible to a checker started inside an app dir.
 * --depth 1 is direct dependencies; --depth 0 is only the filtered package itself.
 * @param {string} workspaceRoot
 * @param {string} filterName
 * @param {boolean} productionOnly
 * @param {boolean} recursive
 * @returns {PnpmListNode[]}
 */
function collectPnpmListPackages(workspaceRoot, filterName, productionOnly, recursive) {
  const args = [
    "list",
    "--filter",
    filterName,
    "--json",
    "--depth",
    recursive ? "Infinity" : "1",
  ];
  if (productionOnly) args.push("--prod");

  const raw = execFileSync("pnpm", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(raw);
  const trees = Array.isArray(parsed) ? parsed : [parsed];
  /** @type {Map<string, PnpmListNode>} */
  const byKey = new Map();

  /**
   * @param {PnpmListNode | undefined} node
   * @param {string | undefined} nameFromKey
   */
  function walk(node, nameFromKey) {
    if (!node) return;
    const name = node.name || node.from || nameFromKey;
    if (name && node.version) {
      byKey.set(`${name}@${node.version}`, { ...node, name });
    }
    if (node.dependencies) {
      for (const [depName, child] of Object.entries(node.dependencies)) {
        walk(child, depName);
      }
    }
  }

  for (const tree of trees) walk(tree, undefined);
  return [...byKey.values()].sort((a, b) => {
    const nameCmp = (a.name ?? "").localeCompare(b.name ?? "");
    if (nameCmp !== 0) return nameCmp;
    return (a.version ?? "").localeCompare(b.version ?? "", undefined, { numeric: true });
  });
}

/**
 * @param {PnpmListNode} item
 * @param {string} workspaceRoot
 */
function resolvePackageDir(item, workspaceRoot) {
  if (item.path && existsSync(path.join(item.path, "package.json"))) return item.path;
  if (item.name) {
    const hoisted = path.join(workspaceRoot, "node_modules", ...item.name.split("/"));
    if (existsSync(path.join(hoisted, "package.json"))) return hoisted;
    try {
      return path.dirname(
        createRequire(path.join(workspaceRoot, "package.json")).resolve(`${item.name}/package.json`)
      );
    } catch {
      // Package is not resolvable from the hoisted workspace root.
    }
  }
  return null;
}

function summaryCounts(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const license = String(entry.info.licenses ?? "UNKNOWN");
    counts.set(license, (counts.get(license) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function resolveLicenseFile(entry) {
  if (typeof entry.info.path === "string") {
    return findLicenseInDir(entry.info.path);
  }
  return null;
}

function buildNoticeText(entries, displayName, productionOnly, recursive) {
  const summaryLines = summaryCounts(entries).map(([license, count]) => `- ${license}: ${count} package(s)`);

  const componentLines = [];
  for (const entry of entries) {
    const license = String(entry.info.licenses ?? "UNKNOWN");
    componentLines.push(`- **${entry.name}** ${entry.version} — ${license}`);
    const url = repoUrl(entry.info);
    if (url) componentLines.push(`  - ${url}`);
  }

  const byHash = new Map();
  const missing = [];

  for (const entry of entries) {
    const label = `${entry.name} ${entry.version}`;
    const spdx = String(entry.info.licenses ?? "UNKNOWN");
    const filePath = resolveLicenseFile(entry);
    if (!filePath || !existsSync(filePath)) {
      missing.push({ label, spdx });
      continue;
    }

    const text = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").trimEnd();
    const hash = hashContent(text);
    let group = byHash.get(hash);
    if (!group) {
      group = { spdx, text, packages: [] };
      byHash.set(hash, group);
    }
    group.packages.push(label);
  }

  const licenseBlocks = [...byHash.values()]
    .map((group) => ({
      ...group,
      packages: [...group.packages].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      ),
    }))
    .sort(
      (a, b) =>
        a.spdx.localeCompare(b.spdx) ||
        a.packages[0].localeCompare(b.packages[0], undefined, { numeric: true, sensitivity: "base" })
    )
    .map(
      (group) =>
        `### ${group.spdx}\n\n**Used by:**\n\n${group.packages
          .map((pkg) => `- ${pkg}`)
          .join("\n")}\n\n\`\`\`\n${group.text}\n\`\`\`\n`
    );

  for (const item of missing) {
    licenseBlocks.push(
      `### ${item.label} — ${item.spdx}\n\n_(No LICENSE file found under this package in node_modules; verify upstream.)_\n`
    );
  }

  const scopeNote = [
    productionOnly ? "package.json `dependencies` only" : "`dependencies` + `devDependencies`",
    recursive ? "transitive dependencies included (`--recursive`)" : "direct dependencies only by default",
  ].join("; ");

  return [
    "# Third-party notices",
    "",
    `This file was generated for \`${displayName}\` (${scopeNote}).`,
    "Regenerate: \`npm run notice\` — \`-- --production\` limits output to production dependencies, \`-- --recursive\` includes transitive dependencies.",
    "Scope constraint: exclude workspace-local/internal dependencies resolved via \`workspace:\` or \`file:\`; keep output sorted deterministically by package name and license section.",
    "",
    "## Summary",
    "",
    ...summaryLines,
    "",
    "## Components",
    "",
    ...componentLines,
    "",
    "## License texts",
    "",
    ...licenseBlocks,
  ].join("\n");
}

function findWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(current, "pnpm-lock.yaml")) || existsSync(path.join(current, "package-lock.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function resolveExcludedNames(pkgJson, extraExcludedPackageNames) {
  return new Set([pkgJson.name, ...workspaceLocalDependencyNames(pkgJson), ...extraExcludedPackageNames]);
}

function buildEntriesFromPnpmList({
  workspaceRoot,
  filterName,
  pkgJson,
  productionOnly,
  recursive,
  excludedNames,
  excludePlatformSpecificPackages,
}) {
  const packages = collectPnpmListPackages(workspaceRoot, filterName, productionOnly, recursive);
  const directNames = directDependencyNames(pkgJson, productionOnly);
  const entries = [];

  for (const item of packages) {
    const name = item.name;
    if (!name || excludedNames.has(name)) continue;
    if (!recursive && !directNames.has(name)) continue;
    if (excludePlatformSpecificPackages && isPlatformSpecificPackage(name)) continue;

    const packageDir = resolvePackageDir(item, workspaceRoot);
    if (!packageDir) continue;

    const manifest = readJson(path.join(packageDir, "package.json"));
    if (manifest.private) continue;

    entries.push({
      name,
      version: item.version,
      info: {
        licenses: licenseLabel(manifest.license ?? manifest.licenses),
        path: packageDir,
        repository: manifest.repository,
        homepage: typeof manifest.homepage === "string" ? manifest.homepage : undefined,
      },
    });
  }

  return entries.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version, undefined, { numeric: true, sensitivity: "base" })
  );
}

function formatNoticeWithOxfmt(noticePath, workspaceRoot) {
  execFileSync("pnpm", ["exec", "oxfmt", path.resolve(noticePath)], {
    cwd: workspaceRoot,
    stdio: "inherit",
  });
}

export async function generateNotice({
  pkgRoot,
  extraExcludedPackageNames = [],
  includeShadcnUiCopiedNotice = false,
  excludePlatformSpecificPackages = false,
  extraNoticePaths = [],
  productionOnly: productionOnlyOption,
  recursive: recursiveOption,
}) {
  const productionOnly = productionOnlyOption ?? process.argv.includes("--production");
  const recursive = recursiveOption ?? process.argv.includes("--recursive");
  const pkgJson = readJson(path.join(pkgRoot, "package.json"));
  const displayName = pkgJson.name ?? "package";
  const excludedNames = resolveExcludedNames(pkgJson, extraExcludedPackageNames);
  const workspaceRoot = findWorkspaceRoot(pkgRoot) ?? pkgRoot;

  try {
    const entries = buildEntriesFromPnpmList({
      workspaceRoot,
      filterName: displayName,
      pkgJson,
      productionOnly,
      recursive,
      excludedNames,
      excludePlatformSpecificPackages,
    });
    const noticeText = buildNoticeText(entries, displayName, productionOnly, recursive);

    const noticePath = path.join(pkgRoot, "NOTICE.md");
    writeFileSync(noticePath, noticeText, "utf8");
    formatNoticeWithOxfmt(noticePath, workspaceRoot);
    if (includeShadcnUiCopiedNotice) {
      appendShadcnUiCopiedNotice(noticePath);
    }

    if (extraNoticePaths.length > 0) {
      const finalText = readFileSync(noticePath, "utf8");
      for (const extraPath of extraNoticePaths) {
        mkdirSync(path.dirname(extraPath), { recursive: true });
        writeFileSync(extraPath, finalText, "utf8");
      }
    }

    console.log(`Wrote NOTICE.md (${entries.length} packages)`);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`Failed to generate NOTICE.md for ${displayName}`);
    console.error(message);
    process.exitCode = 1;
  }
}
