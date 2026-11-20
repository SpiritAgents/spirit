import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Production package builds start from an empty output directory. Desktop's
 * development watcher keeps the previous output in place so a running process
 * can always resolve its module graph while changed packages are recompiled.
 */
export function cleanPackageDist({
  cwd = process.cwd(),
  development = process.env.SPIRIT_DEV_BUILD === "1",
} = {}) {
  if (development) return false;
  fs.rmSync(path.join(cwd, "dist"), { recursive: true, force: true });
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cleanPackageDist();
}
