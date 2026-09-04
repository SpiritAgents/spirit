import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { classifyMarketplaceLocator } from "./locator.js";

const noFs = { pathExists: () => false, pathIsFile: () => false };

test("existing local directory classifies as local and resolves to absolute", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-marketplace-locator-"));
  try {
    const result = classifyMarketplaceLocator(dir);
    assert.equal(result.kind, "local");
    assert.equal(result.locator, path.resolve(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local marketplace.json file path normalizes to the registry root", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-marketplace-locator-"));
  try {
    const indexPath = path.join(dir, ".spirit", "marketplace.json");
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, "{}", "utf8");
    const result = classifyMarketplaceLocator(indexPath);
    assert.equal(result.kind, "local");
    assert.equal(result.locator, path.resolve(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local file outside .spirit/ is rejected", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-marketplace-locator-"));
  try {
    const indexPath = path.join(dir, "marketplace.json");
    await writeFile(indexPath, "{}", "utf8");
    assert.throws(() => classifyMarketplaceLocator(indexPath), /must live inside a .spirit\//);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git locators: .git suffix, git@, ssh://, Azure DevOps /_git/", () => {
  for (const input of [
    "https://github.com/octocat/Hello-World.git",
    "git@github.com:octocat/Hello-World.git",
    "ssh://git@github.com/octocat/Hello-World.git",
    "https://dev.azure.com/org/project/_git/repo",
  ]) {
    const result = classifyMarketplaceLocator(input, noFs);
    assert.equal(result.kind, "git", input);
    assert.equal(result.locator, input.replace(/\/+$/u, ""));
  }
});

test("http(s) URLs without .git classify as http-index with auto-completion", () => {
  assert.deepEqual(classifyMarketplaceLocator("https://example.com", noFs), {
    kind: "http-index",
    locator: "https://example.com/.spirit/marketplace.json",
  });
  assert.deepEqual(classifyMarketplaceLocator("https://example.com/market/", noFs), {
    kind: "http-index",
    locator: "https://example.com/market/.spirit/marketplace.json",
  });
  assert.deepEqual(
    classifyMarketplaceLocator("https://example.com/m/.spirit/marketplace.json", noFs),
    {
      kind: "http-index",
      locator: "https://example.com/m/.spirit/marketplace.json",
    },
  );
  // No git shorthand: a GitHub repo URL without .git is an index direct-link.
  assert.deepEqual(classifyMarketplaceLocator("https://github.com/octocat/Hello-World", noFs), {
    kind: "http-index",
    locator: "https://github.com/octocat/Hello-World/.spirit/marketplace.json",
  });
});

test("unrecognized inputs are rejected", () => {
  assert.throws(() => classifyMarketplaceLocator("", noFs), /must not be empty/);
  assert.throws(() => classifyMarketplaceLocator("   ", noFs), /must not be empty/);
  assert.throws(() => classifyMarketplaceLocator("octocat/Hello-World", noFs), /Unrecognized/);
  assert.throws(() => classifyMarketplaceLocator("./missing-dir", noFs), /Unrecognized/);
  assert.throws(() => classifyMarketplaceLocator("ftp://example.com/x", noFs), /Unrecognized/);
});

test("existing local path wins over .git suffix (local-first rule)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-marketplace-locator-"));
  try {
    const gitNamed = path.join(dir, "repo.git");
    const result = classifyMarketplaceLocator(gitNamed, {
      pathExists: () => true,
      pathIsFile: () => false,
    });
    assert.equal(result.kind, "local");
    assert.equal(result.locator, path.resolve(gitNamed));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
