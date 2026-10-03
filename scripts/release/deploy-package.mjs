import { readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function assertContainedLinks(root) {
  const boundary = await realpath(root);
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(item);
        const relative = path.relative(boundary, target);
        if (
          relative === ".." ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)
        ) {
          throw new Error(`Deployed link escapes its package: ${item} -> ${target}`);
        }
      } else if (entry.isDirectory()) {
        await walk(item);
      }
    }
  }
  await walk(boundary);
}

export async function deployProductionPackage({
  packageName,
  destination,
  arch = process.arch,
  platform = process.platform,
  offline = process.env.npm_config_offline === "true",
  ignoreScripts = false,
}) {
  const args = [
    "--filter",
    packageName,
    "deploy",
    "--prod",
    `--cpu=${arch}`,
    `--os=${platform}`,
    ...(offline ? ["--offline"] : []),
    ...(ignoreScripts ? ["--ignore-scripts"] : []),
    destination,
  ];
  const result = crossSpawn.sync("pnpm", args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Production deployment of ${packageName} failed with status ${result.status}`);
  }
  // pnpm deploy records source file URLs for its install step. Shipping uses the
  // installed graph, not that checkout-specific installation metadata.
  const manifestPath = path.join(destination, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const field of ["dependencies", "optionalDependencies"]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range !== "string" || !range.startsWith(`${name}@file:`)) continue;
      const installed = JSON.parse(
        await readFile(path.join(destination, "node_modules", name, "package.json"), "utf8"),
      );
      if (typeof installed.version !== "string") throw new Error(`Deployed ${name} has no version`);
      manifest[field][name] = installed.version;
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const metadata of [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "node_modules/.modules.yaml",
    "node_modules/.pnpm/lock.yaml",
  ]) {
    await rm(path.join(destination, metadata), { force: true });
  }
  await assertContainedLinks(destination);
}
