#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appkitRoot = path.join(desktopRoot, "native", "appkit");
const addonFileName = "spirit_desktop_appkit.node";

function collectSourceFiles(rootDir) {
  const files = [];
  const bindingGyp = path.join(rootDir, "binding.gyp");
  if (fs.existsSync(bindingGyp)) {
    files.push(bindingGyp);
  }
  const srcDir = path.join(rootDir, "src");
  if (fs.existsSync(srcDir)) {
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const next = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(next);
        } else {
          files.push(next);
        }
      }
    }
    walk(srcDir);
  }
  files.sort();
  return files;
}

export function computeNativeAppkitStamp({ rootDir = appkitRoot, electronVersion, arch }) {
  const hash = createHash("sha256");
  hash.update(`electron:${electronVersion}\0arch:${arch}\0`);
  for (const filePath of collectSourceFiles(rootDir)) {
    hash.update(path.relative(rootDir, filePath).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return { version: 1, electronVersion, arch, inputHash: hash.digest("hex") };
}

function stampsEqual(a, b) {
  return (
    a?.version === b?.version &&
    a?.electronVersion === b?.electronVersion &&
    a?.arch === b?.arch &&
    a?.inputHash === b?.inputHash
  );
}

function filesIdentical(a, b) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

export function buildNativeAppkit(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return { skipped: true };
  }

  const rootDir = options.appkitRoot ?? appkitRoot;
  const outDesktopRoot = options.desktopRoot ?? desktopRoot;
  const require = createRequire(import.meta.url);
  const electronVersion = options.electronVersion ?? require("electron/package.json").version;
  const arch = options.arch ?? process.arch;

  const compiled = path.join(rootDir, "build", "Release", addonFileName);
  const stampPath = path.join(rootDir, "build", ".appkit-stamp.json");
  const stamp = computeNativeAppkitStamp({ rootDir, electronVersion, arch });

  let reused = false;
  if (fs.existsSync(compiled) && fs.existsSync(stampPath)) {
    try {
      const previous = JSON.parse(fs.readFileSync(stampPath, "utf8"));
      reused = stampsEqual(previous, stamp);
    } catch {
      reused = false;
    }
  }

  if (!reused) {
    if (options.rebuild) {
      options.rebuild({ rootDir, electronVersion, arch });
    } else {
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
        { cwd: rootDir, stdio: "inherit" },
      );
      if (result.status !== 0) {
        throw new Error(`native appkit rebuild failed (${result.status ?? "unknown"})`);
      }
    }
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
  }

  const destDir = path.join(outDesktopRoot, "dist-electron", "native");
  const destPath = path.join(destDir, addonFileName);
  fs.mkdirSync(destDir, { recursive: true });
  if (!filesIdentical(compiled, destPath)) {
    fs.copyFileSync(compiled, destPath);
  }
  return { skipped: false, reused };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildNativeAppkit();
  } catch (err) {
    console.error("[desktop-native-appkit]", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
