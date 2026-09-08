/**
 * Brand a copy of the stock Electron.app for unpackaged macOS development.
 * Dock / Cmd-Tab read the bundle name and ICNS; do not use app.dock.setIcon
 * (that paints the square canvas and skips the system squircle).
 *
 * The stock app under node_modules is read-only. Product name matches
 * electron/product-display-name.ts and electron-builder.yml productName.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** User-facing product name; must match electron-builder `productName`. */
export const DEV_PRODUCT_NAME = "Spirit";
/** Distinct from the packaged app id `dev.spirit.desktop`. */
export const DEV_BUNDLE_ID = "dev.spirit.desktop.dev";
export const DEV_APP_DIR_NAME = `${DEV_PRODUCT_NAME}.app`;
export const DEV_ELECTRON_DIR_NAME = ".dev-electron";
export const STOCK_ICON_FILE = "electron.icns";

export function resolveStockElectronApp(electronExec) {
  return path.resolve(electronExec, "..", "..", "..");
}

export function devElectronDir(desktopRoot) {
  return path.join(desktopRoot, DEV_ELECTRON_DIR_NAME);
}

export function brandedAppPath(devDir) {
  return path.join(devDir, DEV_APP_DIR_NAME);
}

export function brandedMacExecutable(devDir) {
  return path.join(brandedAppPath(devDir), "Contents", "MacOS", "Electron");
}

export function hashFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function hashTree(dir) {
  const files = [];
  function walk(current, rel) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(next, nextRel);
      } else {
        files.push({ rel: nextRel, hash: hashFile(next) });
      }
    }
  }
  walk(dir, "");
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return JSON.stringify(files);
}

export function computeStamp({ electronVersion, icnsHash, productName, bundleId }) {
  return { electronVersion, icnsHash, productName, bundleId };
}

function stampsEqual(a, b) {
  return (
    a?.electronVersion === b.electronVersion &&
    a?.icnsHash === b.icnsHash &&
    a?.productName === b.productName &&
    a?.bundleId === b.bundleId
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function replacePlistString(plistPath, key, value) {
  if (process.platform === "darwin") {
    execFileSync("plutil", ["-replace", key, "-string", value, plistPath], { stdio: "pipe" });
    return;
  }
  const pattern = new RegExp(`(<key>${escapeRegExp(key)}</key>\\s*<string>)([^<]*)(</string>)`);
  let xml = fs.readFileSync(plistPath, "utf8");
  if (!pattern.test(xml)) {
    throw new Error(`Info.plist missing ${key}`);
  }
  xml = xml.replace(pattern, `$1${escapeXml(value)}$3`);
  fs.writeFileSync(plistPath, xml);
}

export function readPlistString(plistPath, key) {
  if (process.platform === "darwin") {
    return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plistPath], {
      encoding: "utf8",
    }).trim();
  }
  const xml = fs.readFileSync(plistPath, "utf8");
  const match = xml.match(
    new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<string>([^<]*)</string>`),
  );
  if (!match) {
    throw new Error(`Info.plist missing ${key}`);
  }
  return match[1];
}

/** Copy src to dest. Never writes into src. */
export function copyAppBundle(srcApp, destApp) {
  if (!fs.existsSync(srcApp)) {
    throw new Error(`stock Electron.app missing: ${srcApp}`);
  }
  fs.mkdirSync(path.dirname(destApp), { recursive: true });
  fs.rmSync(destApp, { recursive: true, force: true });
  if (process.platform === "darwin") {
    try {
      execFileSync("cp", ["-cR", srcApp, destApp], { stdio: "pipe" });
      return;
    } catch {
      // Non-APFS volumes do not support clonefile (`cp -c`).
    }
  }
  fs.cpSync(srcApp, destApp, { recursive: true });
}

export function applyBrandToCopiedApp({
  appDir,
  icnsSrc,
  productName,
  bundleId,
  adHocSign = process.platform === "darwin",
}) {
  const icnsDest = path.join(appDir, "Contents", "Resources", STOCK_ICON_FILE);
  fs.mkdirSync(path.dirname(icnsDest), { recursive: true });
  fs.copyFileSync(icnsSrc, icnsDest);

  const plistPath = path.join(appDir, "Contents", "Info.plist");
  replacePlistString(plistPath, "CFBundleName", productName);
  replacePlistString(plistPath, "CFBundleDisplayName", productName);
  replacePlistString(plistPath, "CFBundleIdentifier", bundleId);

  if (adHocSign) {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appDir], { stdio: "pipe" });
  }
}

export function ensureDevElectronBundle({
  desktopRoot,
  electronExec,
  electronVersion,
  icnsPath,
  platform = process.platform,
  adHocSign = platform === "darwin",
  log = () => {},
}) {
  if (platform !== "darwin") {
    return { skipped: true };
  }
  if (typeof electronExec !== "string") {
    throw new Error("require('electron') did not return an executable path");
  }
  if (!fs.existsSync(icnsPath)) {
    throw new Error("missing build/icon.icns; run gen-brand-assets.mjs on macOS first");
  }

  const srcApp = resolveStockElectronApp(electronExec);
  const destDir = devElectronDir(desktopRoot);
  const destApp = brandedAppPath(destDir);
  const stampPath = path.join(destDir, "stamp.json");
  const stamp = computeStamp({
    electronVersion,
    icnsHash: hashFile(icnsPath),
    productName: DEV_PRODUCT_NAME,
    bundleId: DEV_BUNDLE_ID,
  });

  if (fs.existsSync(destApp) && fs.existsSync(stampPath)) {
    const previous = JSON.parse(fs.readFileSync(stampPath, "utf8"));
    if (stampsEqual(previous, stamp)) {
      log("[dev] branded Electron.app already up to date");
      return { skipped: false, reused: true, destApp };
    }
  }

  copyAppBundle(srcApp, destApp);
  applyBrandToCopiedApp({
    appDir: destApp,
    icnsSrc: icnsPath,
    productName: DEV_PRODUCT_NAME,
    bundleId: DEV_BUNDLE_ID,
    adHocSign,
  });
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
  log(`[dev] branded ${path.relative(desktopRoot, destApp)}`);
  return { skipped: false, reused: false, destApp };
}
