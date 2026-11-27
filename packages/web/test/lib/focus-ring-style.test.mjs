import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagesRoot = join(__dirname, "../../..");
const sourceRoots = [join(packagesRoot, "ui/src"), join(packagesRoot, "web/src")];

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)));
    } else if (entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

test("focus rings use the shared translucent token without a second focus border", async () => {
  const legacyPatterns = [
    /ring-ring\/(?:40|60)\b/,
    /focus-visible:border-ring\b/,
    /[^\s"']*focus-visible[^\s"']*:ring-primary\b/,
    /[^\s"']*focus-visible[^\s"']*:ring-blue-(?:500|800)\b/,
  ];
  const violations = [];
  let sharedRingCount = 0;
  for (const sourceRoot of sourceRoots) {
    for (const filePath of await collectSourceFiles(sourceRoot)) {
      const content = await readFile(filePath, "utf8");
      sharedRingCount += content.match(/ring-ring\/50\b/g)?.length ?? 0;
      for (const pattern of legacyPatterns) {
        if (pattern.test(content)) {
          violations.push(`${relative(packagesRoot, filePath)} matches ${pattern}`);
        }
      }
    }
  }
  assert.ok(sharedRingCount > 20, "expected the shared translucent focus-ring token");
  assert.deepEqual(violations, []);
});

test("focus-ring recipes do not animate box shadows", async () => {
  const motionFiles = [
    "ui/src/button.tsx",
    "ui/src/chrome.ts",
    "ui/src/image-preview-dialog.tsx",
    "web/src/lib/desktop-chrome.ts",
    "web/src/lib/message-turn-actions-ui.ts",
    "web/src/components/thread-sidebar.tsx",
    "web/src/components/theme-preview-picker.tsx",
  ];
  for (const file of motionFiles) {
    const content = await readFile(join(packagesRoot, file), "utf8");
    assert.doesNotMatch(content, /transition-\[[^\]]*box-shadow/, file);
    assert.doesNotMatch(content, /\btransition-all\b/, file);
  }
});

test("all focus-ring variants use ring-2", async () => {
  const legacyWidthPatterns = [
    /[^\s"']*focus-visible[^\s"']*:ring-(?:1|3|4|5|6|7|8|9)\b/,
    /[^\s"']*focus-visible[^\s"']*:ring-\[[^\]]+\]/,
  ];
  const violations = [];
  for (const sourceRoot of sourceRoots) {
    for (const filePath of await collectSourceFiles(sourceRoot)) {
      const content = await readFile(filePath, "utf8");
      for (const pattern of legacyWidthPatterns) {
        if (pattern.test(content)) {
          violations.push(`${relative(packagesRoot, filePath)} matches ${pattern}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);

  const defaultControlFiles = [
    "ui/src/button.tsx",
    "ui/src/toggle.tsx",
    "ui/src/checkbox.tsx",
    "ui/src/radio-group.tsx",
  ];
  for (const file of defaultControlFiles) {
    const content = await readFile(join(packagesRoot, file), "utf8");
    assert.match(content, /focus-visible:ring-2\b/, file);
  }

  for (const file of ["ui/src/chrome.ts", "web/src/lib/desktop-chrome.ts"]) {
    const content = await readFile(join(packagesRoot, file), "utf8");
    assert.match(content, /focus-visible:ring-2\b/, file);
  }
});
