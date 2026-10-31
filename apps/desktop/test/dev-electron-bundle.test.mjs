import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import plist from "plist";
import { product } from "@spiritagent/product";

import {
  DEV_BUNDLE_ID,
  DEV_PRODUCT_NAME,
  applyBrandToCopiedApp,
  brandedAppPath,
  copyAppBundle,
  hashTree,
  readPlistString,
} from "../scripts/dev-electron-bundle.mjs";

const STOCK_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Electron</string>
  <key>CFBundleExecutable</key>
  <string>Electron</string>
  <key>CFBundleIconFile</key>
  <string>electron.icns</string>
  <key>CFBundleIdentifier</key>
  <string>com.github.Electron</string>
  <key>CFBundleName</key>
  <string>Electron</string>
</dict>
</plist>
`;

function writeStockApp(appDir, icnsBytes) {
  fs.mkdirSync(path.join(appDir, "Contents", "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(appDir, "Contents", "Resources"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "Contents", "Info.plist"), STOCK_PLIST);
  fs.writeFileSync(path.join(appDir, "Contents", "MacOS", "Electron"), "stock-exec");
  fs.writeFileSync(path.join(appDir, "Contents", "Resources", "electron.icns"), icnsBytes);
}

test("copy and brand a fixture app without mutating the stock bundle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spirit-dev-electron-bundle-"));
  try {
    const srcApp = path.join(root, "Electron.app");
    const destDir = path.join(root, "out");
    const destApp = brandedAppPath(destDir);
    const stockIcns = Buffer.from("stock-icns");
    const brandIcns = Buffer.from("spirit-icns");
    const icnsSrc = path.join(root, "icon.icns");
    writeStockApp(srcApp, stockIcns);
    fs.writeFileSync(icnsSrc, brandIcns);
    const sourceBefore = hashTree(srcApp);

    copyAppBundle(srcApp, destApp);
    applyBrandToCopiedApp({
      appDir: destApp,
      icnsSrc,
      productName: DEV_PRODUCT_NAME,
      bundleId: DEV_BUNDLE_ID,
      adHocSign: false,
    });

    assert.equal(path.basename(destApp), `${product.name}.app`);
    const plistPath = path.join(destApp, "Contents", "Info.plist");
    assert.equal(readPlistString(plistPath, "CFBundleName"), DEV_PRODUCT_NAME);
    assert.equal(readPlistString(plistPath, "CFBundleDisplayName"), DEV_PRODUCT_NAME);
    assert.equal(readPlistString(plistPath, "CFBundleIdentifier"), DEV_BUNDLE_ID);
    assert.deepEqual(plist.parse(fs.readFileSync(plistPath, "utf8")).CFBundleURLTypes, [
      { CFBundleURLName: product.name, CFBundleURLSchemes: [product.urlProtocol] },
    ]);
    assert.deepEqual(
      fs.readFileSync(path.join(destApp, "Contents", "Resources", "electron.icns")),
      brandIcns,
    );
    assert.equal(hashTree(srcApp), sourceBefore);
    assert.deepEqual(
      fs.readFileSync(path.join(srcApp, "Contents", "Resources", "electron.icns")),
      stockIcns,
    );
    assert.equal(fs.readFileSync(path.join(srcApp, "Contents", "Info.plist"), "utf8"), STOCK_PLIST);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
