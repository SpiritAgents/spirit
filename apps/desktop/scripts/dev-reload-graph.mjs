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
