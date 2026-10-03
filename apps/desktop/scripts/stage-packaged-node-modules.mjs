#!/usr/bin/env node
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployProductionPackage } from "../../../scripts/release/deploy-package.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const packNodeModulesDir = path.join(desktopRoot, "..", ".desktop-pack-node-modules");

export async function stagePackagedNodeModules({ arch = process.arch } = {}) {
  if (existsSync(packNodeModulesDir)) {
    await rm(packNodeModulesDir, { recursive: true, force: true });
  }
  await deployProductionPackage({
    packageName: "@spiritagent/desktop",
    destination: packNodeModulesDir,
    arch,
    ignoreScripts: true,
  });
  const nodeModules = path.join(packNodeModulesDir, "node_modules");
  if (!existsSync(nodeModules)) {
    throw new Error(`pnpm deploy did not create ${nodeModules}`);
  }
  return nodeModules;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stagePackagedNodeModules();
}
