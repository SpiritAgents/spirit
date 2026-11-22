#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { developmentWatchPackageNames } from "./dev-reload-graph.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");

const WORKBENCH_PACKAGE = "@spiritagent/workbench";

/**
 * Build only the workspace packages that Electron main/preload and built-in
 * extensions load at runtime. @spiritagent/workbench declares @spiritagent/web
 * solely so standalone production mode can serve web/dist; building all other
 * runtime/extension dependencies first and then building workbench with --only
 * keeps full Turbo caching while skipping @spiritagent/web's production bundle
 * in dev mode (where Vite serves packages/web and workspace sources live).
 */
export function developmentTurboBuildPlans(rootDir = repoRoot) {
  const names = developmentWatchPackageNames(rootDir);
  const nonWorkbench = names.filter((name) => name !== WORKBENCH_PACKAGE);
  const plans = [
    ["exec", "turbo", "run", "build", ...nonWorkbench.map((name) => `--filter=${name}`)],
  ];
  if (names.includes(WORKBENCH_PACKAGE)) {
    plans.push(["exec", "turbo", "run", "build", "--only", `--filter=${WORKBENCH_PACKAGE}`]);
  }
  return plans;
}

function main() {
  for (const args of developmentTurboBuildPlans(repoRoot)) {
    const result = spawnSync("pnpm", args, {
      cwd: repoRoot,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    if (result.error) {
      console.error("[dev] failed to build runtime workspace dependencies:", result.error);
      process.exit(1);
    }
    if ((result.status ?? 1) !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
