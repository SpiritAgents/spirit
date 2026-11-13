import fs from "node:fs/promises";
import path from "node:path";

import { createOpticalLogoSvg } from "@spiritagent/brand";
import sharp from "sharp";

const sourcePromise = fs.readFile(
  /*turbopackIgnore: true*/ path.resolve(
    process.cwd(),
    "../../packages/brand/assets/logo-dark.svg",
  ),
  "utf8",
);
const logoCache = new Map<number, Promise<string>>();

export function getOgLogoDataUri(size: number): Promise<string> {
  let pending = logoCache.get(size);
  if (!pending) {
    pending = sourcePromise.then(async (source) => {
      const svg = createOpticalLogoSvg(source, size);
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      return `data:image/png;base64,${png.toString("base64")}`;
    });
    logoCache.set(size, pending);
  }
  return pending;
}
