import { readFileSync, writeFileSync } from "node:fs";

export function writeChangedFile(file, content) {
  try {
    if (readFileSync(file, "utf8") === content) return false;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  writeFileSync(file, content, "utf8");
  return true;
}
