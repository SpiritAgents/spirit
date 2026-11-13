import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { createOpticalLogoSvg } from "../src/optical-logo.js";

const sizes = [16, 32, 64, 107, 512];
const usage =
  "Usage: node packages/brand/scripts/preview-optical-logo.mjs [dark|light] --output <directory>";

function parseOptions(argv) {
  let requestedVariant;
  let output;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-o" || argument === "--output") {
      if (output || index + 1 >= argv.length || argv[index + 1].startsWith("-")) {
        throw new Error(`${argument} requires a directory`);
      }
      output = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--output=")) {
      if (output) throw new Error("Specify --output only once");
      output = argument.slice("--output=".length);
      if (!output) throw new Error("--output requires a directory");
      continue;
    }
    if (argument === "dark" || argument === "light") {
      if (requestedVariant) throw new Error("Specify at most one logo variant");
      requestedVariant = argument;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!output) throw new Error("Missing required -o / --output directory");
  return {
    variants: requestedVariant ? [requestedVariant] : ["dark", "light"],
    outputDir: path.resolve(output),
  };
}

let options;
try {
  options = parseOptions(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error(usage);
  process.exit(1);
}

const { variants, outputDir } = options;
fs.mkdirSync(outputDir, { recursive: true });

function imageDataUri(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function buildSheet(variant, rows) {
  const width = 900;
  const rowHeight = 170;
  const height = 105 + rows.length * rowHeight + 30;
  const dark = variant === "dark";
  const background = dark ? "#171717" : "#E5E5E5";
  const foreground = dark ? "#F5F5F5" : "#18181B";
  const muted = dark ? "#A1A1AA" : "#71717A";
  const border = dark ? "#3F3F46" : "#C8C8CD";
  const columns = [280, 650];
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${background}"/>`,
    `<text x="30" y="40" fill="${foreground}" font-family="Arial, sans-serif" font-size="24" font-weight="600">Spirit ${variant} logo — optical size preview</text>`,
    `<text x="30" y="68" fill="${muted}" font-family="Arial, sans-serif" font-size="14">Current brand source at 16, 32, 64, 107 and 512 px, with nearest-neighbor pixel detail.</text>`,
    `<text x="${columns[0]}" y="92" text-anchor="middle" fill="${muted}" font-family="Arial, sans-serif" font-size="14">Current · actual</text>`,
    `<text x="${columns[1]}" y="92" text-anchor="middle" fill="${muted}" font-family="Arial, sans-serif" font-size="14">Current · pixels</text>`,
  ];

  rows.forEach((row, index) => {
    const y = 105 + index * rowHeight;
    parts.push(
      `<text x="30" y="${y + 85}" fill="${foreground}" font-family="Arial, sans-serif" font-size="20">${row.size}px</text>`,
    );
    [row.actual, row.detail].forEach((image, column) => {
      const displaySize = column === 0 ? Math.min(row.size, 128) : 128;
      const x = columns[column] - displaySize / 2;
      const imageY = y + (rowHeight - displaySize) / 2;
      parts.push(
        `<rect x="${x - 1}" y="${imageY - 1}" width="${displaySize + 2}" height="${displaySize + 2}" fill="none" stroke="${border}"/>`,
      );
      parts.push(
        `<image x="${x}" y="${imageY}" width="${displaySize}" height="${displaySize}" href="${image}"${column === 1 ? ' style="image-rendering:pixelated"' : ""}/>`,
      );
    });
  });

  parts.push("</svg>");
  const outputPath = path.join(outputDir, `logo-${variant}-preview.png`);
  await sharp(Buffer.from(parts.join("")))
    .png()
    .toFile(outputPath);
  return outputPath;
}

for (const variant of variants) {
  const source = fs.readFileSync(
    path.resolve("packages/brand/assets", `logo-${variant}.svg`),
    "utf8",
  );
  const rows = [];
  for (const size of sizes) {
    const opticalSvg = createOpticalLogoSvg(source, size);
    fs.writeFileSync(path.join(outputDir, `logo-${variant}-${size}.svg`), opticalSvg);
    const actual = await sharp(Buffer.from(opticalSvg)).png().toBuffer();
    fs.writeFileSync(path.join(outputDir, `logo-${variant}-${size}.png`), actual);
    const detail = await sharp(actual).resize(128, 128, { kernel: "nearest" }).png().toBuffer();
    rows.push({ size, actual: imageDataUri(actual), detail: imageDataUri(detail) });
  }
  const sheet = await buildSheet(variant, rows);
  console.log(`Wrote ${sheet}`);
}

console.log(`Optical SVG and PNG previews: ${outputDir}`);
