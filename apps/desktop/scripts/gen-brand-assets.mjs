/**
 * Generates all packaging/runtime icons from the @spiritagent/brand SVG sources (outputs are not committed, see .gitignore):
 * - build/icon.png (512)          — macOS packaging icon + Windows window/taskbar icon; source logo-dark.svg, natively opaque canvas
 * - build/icon.ico (16/32/48/256) — Windows/Linux electron-builder; same source
 * - build/icon.icns               — macOS only; multi-resolution ICNS for the branded dev bundle; electron-builder mac still uses build/icon.png
 * - build/tray/iconTemplate.png (22) / @2x (44) / -32 (32) — macOS Template + Windows tray; source glyph constant
 * - build/background.png (540x408) / @2x (1080x816) — DMG window background; source dmg-background.svg (540x380)
 *
 * The DMG window height includes the Finder title bar (~28pt), so the background image needs a 28px white band at the bottom,
 * matching the dmg comment in electron-builder.yml; adjust BG_BOTTOM_PAD when the design changes.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SPIRIT_GLASS_LOGO_PATH,
  SPIRIT_GLASS_LOGO_VIEWBOX,
} from "@spiritagent/brand/src/constants.js";
import { createOpticalLogoSvg } from "@spiritagent/brand/src/optical-logo.js";
import { imagesToIco } from "png-to-ico";
import { readPNG } from "png-to-ico/lib/png.js";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const buildDir = path.join(desktopRoot, "build");
const trayDir = path.join(buildDir, "tray");

const brandRoot = path.join(desktopRoot, "..", "..", "packages", "brand");
const brandAssetsDir = path.join(brandRoot, "assets");
const appIconSvg = path.join(brandAssetsDir, "logo-dark.svg");
const appIconSvgSource = fs.readFileSync(appIconSvg, "utf8");
const dmgBackgroundSvg = path.join(brandAssetsDir, "dmg-background.svg");
const STAMP_FILE = path.join(buildDir, ".brand-assets-stamp.json");

const BRAND_INPUT_FILES = [
  appIconSvg,
  dmgBackgroundSvg,
  path.join(brandRoot, "src", "constants.js"),
  path.join(brandRoot, "src", "optical-logo.js"),
  fileURLToPath(import.meta.url),
];

export function expectedBrandAssetOutputs(rootDir = desktopRoot, platform = process.platform) {
  const outBuildDir = path.join(rootDir, "build");
  const outTrayDir = path.join(outBuildDir, "tray");
  const outputs = [
    path.join(outBuildDir, "icon.png"),
    path.join(outBuildDir, "icon.ico"),
    path.join(outTrayDir, "iconTemplate.png"),
    path.join(outTrayDir, "iconTemplate@2x.png"),
    path.join(outTrayDir, "iconTemplate-32.png"),
    path.join(outBuildDir, "background.png"),
    path.join(outBuildDir, "background@2x.png"),
  ];
  if (platform === "darwin") {
    outputs.push(path.join(outBuildDir, "icon.icns"));
  }
  return outputs;
}

export function computeBrandAssetsStamp(
  inputFiles = BRAND_INPUT_FILES,
  platform = process.platform,
) {
  const hash = createHash("sha256");
  hash.update(`platform:${platform}\0`);
  for (const filePath of inputFiles) {
    hash.update(path.basename(filePath));
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return { version: 1, platform, inputHash: hash.digest("hex") };
}

export function isBrandAssetsUpToDate({
  stampFile = STAMP_FILE,
  expectedOutputs = expectedBrandAssetOutputs(),
  stamp = computeBrandAssetsStamp(),
} = {}) {
  if (!fs.existsSync(stampFile)) return false;
  if (!expectedOutputs.every((filePath) => fs.existsSync(filePath))) return false;
  try {
    const previous = JSON.parse(fs.readFileSync(stampFile, "utf8"));
    return (
      previous?.version === stamp.version &&
      previous?.platform === stamp.platform &&
      previous?.inputHash === stamp.inputHash
    );
  } catch {
    return false;
  }
}

const ICO_SIZES = [16, 32, 48, 256];
/** Apple iconset slots; keep the canvas square and opaque so Dock/Finder apply the system squircle. */
const MAC_ICONSET_SIZES = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];
/** DMG background bottom white band: content area 380pt + 28pt = window 408pt */
const BG_BOTTOM_PAD = 28;

function renderAppIconPng(size) {
  const opticalSvg = createOpticalLogoSvg(appIconSvgSource, size);
  return sharp(Buffer.from(opticalSvg)).png().toBuffer();
}

/** Tray icon: scale the glyph to a 0.82 padding ratio and center it (same as the original gen-tray-icons) */
function buildTraySquareSvg(size) {
  const padRatio = 0.82;
  const scale =
    (size * padRatio) / Math.max(SPIRIT_GLASS_LOGO_VIEWBOX.width, SPIRIT_GLASS_LOGO_VIEWBOX.height);
  const drawnW = SPIRIT_GLASS_LOGO_VIEWBOX.width * scale;
  const drawnH = SPIRIT_GLASS_LOGO_VIEWBOX.height * scale;
  const offsetX = (size - drawnW) / 2;
  const offsetY = (size - drawnH) / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${offsetX.toFixed(3)},${offsetY.toFixed(3)}) scale(${scale.toFixed(6)})">
    <path d="${SPIRIT_GLASS_LOGO_PATH}" fill="#000000"/>
  </g>
</svg>`;
}

async function genPackagerIcons() {
  const iconPngPath = path.join(buildDir, "icon.png");
  await sharp(await renderAppIconPng(512)).toFile(iconPngPath);
  console.log(`Wrote ${path.relative(desktopRoot, iconPngPath)} (512x512)`);

  const images = await Promise.all(
    ICO_SIZES.map(async (size) => readPNG(await renderAppIconPng(size))),
  );
  const ico = await imagesToIco(images);
  const iconIcoPath = path.join(buildDir, "icon.ico");
  fs.writeFileSync(iconIcoPath, ico);
  console.log(`Wrote ${path.relative(desktopRoot, iconIcoPath)} (${ICO_SIZES.join("/")})`);
}

/**
 * Rasterize logo-dark.svg into a full Apple iconset and compile it with iconutil.
 * The PNGs stay square and opaque: baking a squircle here (or feeding the PNG to app.dock.setIcon)
 * produces the hard-cornered Dock tile that bypasses macOS's own mask.
 */
async function genMacIcns() {
  if (process.platform !== "darwin") {
    return;
  }
  const iconsetDir = path.join(buildDir, "icon.iconset");
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });
  try {
    for (const [fileName, size] of MAC_ICONSET_SIZES) {
      await sharp(await renderAppIconPng(size)).toFile(path.join(iconsetDir, fileName));
    }
    const icnsPath = path.join(buildDir, "icon.icns");
    execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath], { stdio: "pipe" });
    console.log(`Wrote ${path.relative(desktopRoot, icnsPath)}`);
  } finally {
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  }
}

async function genTrayIcons() {
  fs.mkdirSync(trayDir, { recursive: true });
  for (const [fileName, size] of [
    ["iconTemplate.png", 22],
    ["iconTemplate@2x.png", 44],
    ["iconTemplate-32.png", 32],
  ]) {
    const outPath = path.join(trayDir, fileName);
    await sharp(Buffer.from(buildTraySquareSvg(size), "utf8"))
      .png()
      .toFile(outPath);
    console.log(`Wrote ${path.relative(desktopRoot, outPath)} (${size}x${size})`);
  }
}

async function genDmgBackground() {
  const svg = fs.readFileSync(dmgBackgroundSvg);
  for (const [fileName, scale] of [
    ["background.png", 1],
    ["background@2x.png", 2],
  ]) {
    const contentW = 540 * scale;
    const contentH = 380 * scale;
    const outPath = path.join(buildDir, fileName);
    // density 72 is the SVG native size; multiplying by scale renders sharply directly, avoiding rasterize-then-upscale
    const content = await sharp(svg, { density: 72 * scale })
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: contentW,
        height: contentH + BG_BOTTOM_PAD * scale,
        channels: 3,
        background: "#ffffff",
      },
    })
      .composite([{ input: content, top: 0, left: 0 }])
      .png()
      .toFile(outPath);
    console.log(
      `Wrote ${path.relative(desktopRoot, outPath)} (${contentW}x${contentH + BG_BOTTOM_PAD * scale})`,
    );
  }
}

async function main() {
  const stamp = computeBrandAssetsStamp();
  if (isBrandAssetsUpToDate({ stamp })) {
    console.log("[brand-assets] already up to date");
    return;
  }
  fs.mkdirSync(buildDir, { recursive: true });
  await genPackagerIcons();
  await genMacIcns();
  await genTrayIcons();
  await genDmgBackground();
  fs.writeFileSync(STAMP_FILE, `${JSON.stringify(stamp, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
