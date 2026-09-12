#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appkitRoot = path.join(desktopRoot, "native", "appkit");
const addonFileName = "spirit_desktop_appkit.node";

export function buildNativeAppkit(options = {}) {
  if (process.platform !== "darwin") {
    return;
  }

  const require = createRequire(import.meta.url);
  const electronVersion = options.electronVersion ?? require("electron/package.json").version;
  const arch = options.arch ?? process.arch;
  const nodeGypPkg = require.resolve("node-gyp/package.json");
  const nodeGypBin = path.join(path.dirname(nodeGypPkg), "bin", "node-gyp.js");

  const result = spawnSync(
    process.execPath,
    [
      nodeGypBin,
      "rebuild",
      `--target=${electronVersion}`,
      "--dist-url=https://electronjs.org/headers",
      `--arch=${arch}`,
    ],
    { cwd: appkitRoot, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`native appkit rebuild failed (${result.status ?? "unknown"})`);
  }

  const compiled = path.join(appkitRoot, "build", "Release", addonFileName);
  const destDir = path.join(desktopRoot, "dist-electron", "native");
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(compiled, path.join(destDir, addonFileName));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildNativeAppkit();
  } catch (err) {
    console.error("[desktop-native-appkit]", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
