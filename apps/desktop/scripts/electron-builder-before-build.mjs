import { rebuild } from "@electron/rebuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseHTML } from "linkedom";
import { PRODUCT_BUILD_ID } from "@spiritagent/product";

import { buildNativeAppkit } from "./build-native-appkit.mjs";
import { packNodeModulesDir, stagePackagedNodeModules } from "./stage-packaged-node-modules.mjs";

export async function verifyRendererProduct(appDir) {
  const { document } = parseHTML(await readFile(path.join(appDir, "dist", "index.html"), "utf8"));
  const identity = document
    .querySelector('meta[name="spirit-product-build"]')
    ?.getAttribute("content");
  if (identity !== PRODUCT_BUILD_ID) {
    throw new Error(
      "Renderer product build is missing or different; run build:renderer before packaging",
    );
  }
}

export default async function beforeBuild(context) {
  await verifyRendererProduct(context.appDir);
  await stagePackagedNodeModules({ arch: context.arch });
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
