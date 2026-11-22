import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SPIRIT_SCOPE = "@spiritagent/";
const RENDERER_ONLY_PACKAGES = new Set([
  "@spiritagent/brand",
  "@spiritagent/icons",
  "@spiritagent/ui",
  "@spiritagent/web",
]);
const EXTENSION_BUILD_PACKAGES = [
  "@spiritagent/github",
  "@spiritagent/linear",
  "@spiritagent/notion",
  "@spiritagent/vercel",
];

/**
 * Follow only runtime dependencies. Renderer packages are source-served by
 * Vite and must not restart Electron for every component edit.
 */
export function workbenchRuntimePackageNames(repoRoot) {
  const names = new Set();
  const pending = ["@spiritagent/workbench"];

  while (pending.length > 0) {
    const name = pending.shift();
    if (!name || names.has(name) || RENDERER_ONLY_PACKAGES.has(name)) continue;
    const packageDir = path.join(repoRoot, "packages", name.slice(SPIRIT_SCOPE.length));
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
    names.add(name);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith(SPIRIT_SCOPE)) pending.push(dependency);
    }
  }

  return [...names].sort();
}

export function developmentRestartWatchDirs(desktopRoot, repoRoot) {
  return [
    path.join(desktopRoot, "dist-electron"),
    ...workbenchRuntimePackageNames(repoRoot).map((name) =>
      path.join(repoRoot, "packages", name.slice(SPIRIT_SCOPE.length), "dist"),
    ),
  ];
}

/** Packages whose development builds feed either Electron or built-in extensions. */
export function developmentWatchPackageNames(repoRoot) {
  return [
    ...new Set([...workbenchRuntimePackageNames(repoRoot), ...EXTENSION_BUILD_PACKAGES]),
  ].sort();
}

/**
 * Development rebuilds do not need Turbo's transitive invalidation: runtime
 * dependants load the fresh dependency on the next reload. Build only edited
 * packages, but keep simultaneous edits in dependency order so their typecheck
 * sees the new declarations.
 */
export function developmentPackageBuildOrder(repoRoot) {
  const names = new Set(developmentWatchPackageNames(repoRoot));
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(name) {
    if (visited.has(name) || visiting.has(name)) return;
    visiting.add(name);
    if (name === "@spiritagent/extensions") {
      for (const dependency of EXTENSION_BUILD_PACKAGES) visit(dependency);
    }
    const packageDir = path.join(repoRoot, "packages", name.slice(SPIRIT_SCOPE.length));
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (names.has(dependency)) visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  }

  for (const name of names) visit(name);
  return ordered;
}

export function developmentBuildClosure(changedPackages) {
  const changed = new Set(changedPackages);
  if (EXTENSION_BUILD_PACKAGES.some((name) => changed.has(name))) {
    changed.add("@spiritagent/extensions");
  }
  return changed;
}

function isRuntimeBuildMetadata(file) {
  return /(?:\.map|\.d\.[cm]?ts|\.tsbuildinfo|\.node)$/u.test(file);
}

function hashRuntimeFile(hash, root, file) {
  let content;
  try {
    content = fs.readFileSync(file);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
  hash.update(path.relative(root, file));
  hash.update("\0");
  hash.update(content);
  hash.update("\0");
  return true;
}

function hashRuntimeDirectory(hash, root, directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!hashRuntimeDirectory(hash, root, file)) return false;
      continue;
    }
    if (!entry.isFile() || isRuntimeBuildMetadata(entry.name)) continue;
    if (!hashRuntimeFile(hash, root, file)) return false;
  }
  return true;
}

/**
 * Fingerprint executable build outputs, not their type declarations or source maps.
 * A build which recreates identical runtime files must not restart the app. Missing
 * files mean a compiler is midway through replacing its output and are not a valid
 * restart candidate. Native sources are included explicitly because linked Mach-O
 * outputs may differ on every build even when their inputs have not changed.
 */
export function developmentRuntimeFingerprint(watchDirs, nativeSources = []) {
  const hash = createHash("sha256");
  for (const directory of [...watchDirs].sort()) {
    if (!hashRuntimeDirectory(hash, directory, directory)) return undefined;
  }
  for (const source of [...nativeSources].sort()) {
    if (!hashRuntimeFile(hash, source, source)) return undefined;
  }
  return hash.digest("hex");
}

export function developmentNativeSources(desktopRoot) {
  const appkitRoot = path.join(desktopRoot, "native", "appkit");
  return [path.join(appkitRoot, "binding.gyp"), path.join(appkitRoot, "src", "appkit.mm")];
}
