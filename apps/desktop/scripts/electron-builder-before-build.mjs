import { rebuild } from "@electron/rebuild";

import { buildNativeAppkit } from "./build-native-appkit.mjs";
import { packNodeModulesDir, stagePackagedNodeModules } from "./stage-packaged-node-modules.mjs";

export default async function beforeBuild(context) {
  await stagePackagedNodeModules();
  await rebuild({
    buildPath: packNodeModulesDir,
    electronVersion: context.electronVersion,
    arch: context.arch,
  });
  buildNativeAppkit({
    electronVersion: context.electronVersion,
    arch: context.arch,
  });
  // false: node_modules come from pnpm deploy; skip electron-builder's hoisted collector.
  return false;
}
