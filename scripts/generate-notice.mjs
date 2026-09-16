import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";

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
      "Vendored components and inlined Tailwind variants from [shadcn/ui](https://github.com/shadcn-ui/ui) are copied into this app. See per-file copyright headers in source. This is not an npm package listed above.",
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

// Platform binary packages ship the same license as their parent package, so
// they are folded away to keep NOTICE output identical across build platforms.
// Lockfile packages carry os/cpu restrictions; @img/sharp-wasm32 is the one
// platform variant without those fields and is matched by name instead.
const PLATFORM_BINARY_NAME_RE = /^@img\/sharp-wasm32$/;

function isPlatformBinaryPackage(packagesMeta, name, version) {
  if (PLATFORM_BINARY_NAME_RE.test(name)) return true;
  const meta = packagesMeta[`${name}@${version}`];
  return Boolean(meta?.os || meta?.cpu);
}

function findLicenseInDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  // Match case-insensitively: some packages ship lowercase variants (e.g.
  // express-rate-limit 8.7's extensionless `license`), which exact-name lookups
  // only find on case-insensitive filesystems and miss on Linux.
  for (const fileName of LICENSE_FILE_NAMES) {
    const match = entries.find((entry) => entry.toLowerCase() === fileName.toLowerCase());
    if (match) return path.join(dir, match);
  }
  return null;
}

function hashContent(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * pnpm-lock.yaml (lockfileVersion 9) is the source of truth for the dependency graph.
 * `pnpm list` is unusable under nodeLinker=hoisted: it reports every hoisted
 * workspace package as `unsavedDependencies`, which would pull the whole monorepo
 * into each package's NOTICE.
 */
function loadLockfile(workspaceRoot) {
  const documents = parseAllDocuments(readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf8"))
    .map((doc) => doc.toJSON())
    .filter((doc) => doc && typeof doc === "object");
  // pnpm 12 prepends a packageManagerDependencies document; the project graph is last.
  const lockfile = documents.findLast((doc) => doc.settings) ?? documents.at(-1);
  if (!lockfile) {
    throw new Error("pnpm-lock.yaml produced no YAML documents");
  }
  return lockfile;
}

/** Posix-style importer key for the package, e.g. "apps/site". */
function importerKeyFor(pkgRoot, workspaceRoot) {
  return path.relative(workspaceRoot, pkgRoot).split(path.sep).join("/");
}

/** Strip the peer suffix from a lockfile version key: "16.3.0(react@19.2.5)" -> "16.3.0". */
function bareVersion(versionKey) {
  const paren = versionKey.indexOf("(");
  return paren === -1 ? versionKey : versionKey.slice(0, paren);
}

/**
 * Walk the node_modules chain from a referring directory up to the workspace
 * root, so nested conflict versions win over the hoisted root (e.g. shiki's
 * nested @shikijs/core 4 vs the hoisted 3). A level only matches when it holds
 * the lockfile version. createRequire is not usable here: exports-sealed
 * packages like @modelcontextprotocol/sdk do not export ./package.json.
 * @param {{ name: string, version: string }} item
 * @param {string} fromDir
 * @param {string} workspaceRoot
 */
function resolvePackageDir(item, fromDir, workspaceRoot) {
  const segments = item.name.split("/");
  let dir = fromDir;
  while (true) {
    const candidate = path.join(dir, "node_modules", ...segments);
    const manifestPath = path.join(candidate, "package.json");
    if (existsSync(manifestPath)) {
      try {
        if (readJson(manifestPath).version === item.version) return candidate;
      } catch {
        // Unreadable manifest at this level; keep walking up.
      }
    }
    if (dir === workspaceRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Walk the lockfile snapshot graph from the package's declared dependencies,
 * resolving each node's install directory from its referrer's directory so
 * transitive dependencies nested under intermediate packages are found.
 * @param {{ lockfile: object, importerKey: string, pkgRoot: string, workspaceRoot: string, productionOnly: boolean, recursive: boolean, excludePlatformSpecificPackages: boolean }} options
 * @returns {{ name: string, version: string, dir: string | null }[]}
 */
function collectLockfilePackages({ lockfile, importerKey, pkgRoot, workspaceRoot, productionOnly, recursive, excludePlatformSpecificPackages }) {
  const importer = lockfile.importers?.[importerKey];
  if (!importer) {
    throw new Error(`No importer "${importerKey}" found in pnpm-lock.yaml`);
  }
  const snapshots = lockfile.snapshots ?? {};
  const packagesMeta = lockfile.packages ?? {};

  const direct = new Map();
  const addDeclared = (deps) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      if (info && typeof info.version === "string") direct.set(name, info.version);
    }
  };
  addDeclared(importer.dependencies);
  addDeclared(importer.optionalDependencies);
  if (!productionOnly) addDeclared(importer.devDependencies);

  /** @type {Map<string, { name: string, version: string, dir: string | null }>} */
  const visited = new Map();
  const queue = [...direct.entries()].map(([name, versionKey]) => ({
    name,
    versionKey,
    fromDir: pkgRoot,
  }));
  while (queue.length > 0) {
    const { name, versionKey, fromDir } = queue.shift();
    if (versionKey.startsWith("link:")) continue; // workspace-local dependency
    const snapshotKey = `${name}@${versionKey}`;
    if (visited.has(snapshotKey)) continue;
    const version = bareVersion(versionKey);
    if (
      excludePlatformSpecificPackages &&
      isPlatformBinaryPackage(packagesMeta, name, version)
    ) {
      // Folded into the parent package's license; prune the subtree so
      // binary-only dependencies (e.g. @emnapi/runtime) stay out as well.
      visited.set(snapshotKey, { name, version, dir: null });
      continue;
    }
    let dir = resolvePackageDir({ name, version }, fromDir, workspaceRoot);
    if (!dir && fromDir !== pkgRoot) {
      // Peer-resolved instances are nested under the importer, not the referrer
      // (e.g. site's @types/node@24 while the hoisted root holds 25).
      dir = resolvePackageDir({ name, version }, pkgRoot, workspaceRoot);
    }
    visited.set(snapshotKey, { name, version, dir });
    const snapshot = snapshots[snapshotKey];
    if (!snapshot || !recursive || !dir) continue;
    for (const key of ["dependencies", "optionalDependencies"]) {
      for (const [depName, depVersion] of Object.entries(snapshot[key] ?? {})) {
        queue.push({ name: depName, versionKey: String(depVersion), fromDir: dir });
      }
    }
  }
  return [...visited.values()].sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.version.localeCompare(b.version, undefined, { numeric: true });
  });
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

function buildEntriesFromLockfile({
  workspaceRoot,
  pkgRoot,
  productionOnly,
  recursive,
  excludedNames,
  excludePlatformSpecificPackages,
}) {
  const lockfile = loadLockfile(workspaceRoot);
  const packages = collectLockfilePackages({
    lockfile,
    importerKey: importerKeyFor(pkgRoot, workspaceRoot),
    pkgRoot,
    workspaceRoot,
    productionOnly,
    recursive,
    excludePlatformSpecificPackages,
  });
  const entries = [];

  for (const item of packages) {
    const name = item.name;
    if (!name || excludedNames.has(name)) continue;

    // Nodes without a dir are not installed on this platform (optional
    // platform-specific dependencies); they cannot contribute a license file.
    if (!item.dir) continue;
    const packageDir = item.dir;

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
    const entries = buildEntriesFromLockfile({
      workspaceRoot,
      pkgRoot,
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
