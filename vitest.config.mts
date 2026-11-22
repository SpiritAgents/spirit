import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type TestProjectConfiguration } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

function discoverVitestProjects(): TestProjectConfiguration[] {
  const projects: TestProjectConfiguration[] = [];

  const packagesDir = path.join(repoRoot, "packages");
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgRoot = path.join(packagesDir, entry.name);
    const pkgJsonPath = path.join(pkgRoot, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    if (!pkg.name || !pkg.scripts?.test?.includes("vitest")) continue;

    const configPath = path.join(pkgRoot, "vitest.config.ts");
    if (fs.existsSync(configPath)) {
      projects.push(configPath);
    } else {
      projects.push({
        root: pkgRoot,
        test: {
          name: pkg.name,
          environment: "node",
        },
      });
    }
  }

  projects.push(path.join(repoRoot, "apps", "desktop", "vitest.native.config.ts"));
  return projects;
}

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: discoverVitestProjects(),
  },
});
