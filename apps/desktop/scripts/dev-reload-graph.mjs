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
