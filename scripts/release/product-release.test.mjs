import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { product } from "@spiritagent/product";
import {
  spiritDownloadObjectKey,
  spiritDownloadUrl,
} from "../../apps/site/src/lib/spirit-download-urls.ts";
import { assertContainedLinks } from "./deploy-package.mjs";
import { readNpmPackages } from "./npm-packages.mjs";
import { mapPrimaryAsset, objectKeyFor, publicUrlFor } from "./selfhosted-paths.mjs";

test("all twelve release artifacts map to the same object keys and URLs as the site", () => {
  for (const channel of ["desktop", "cli"]) {
    for (const os of ["darwin", "windows", "linux"]) {
      for (const arch of ["x64", "arm64"]) {
        const extension =
          channel === "cli"
            ? os === "windows"
              ? "zip"
              : "tar.gz"
            : { darwin: "dmg", windows: "exe", linux: "AppImage" }[os];
        const filenameOs = channel === "desktop" && os === "windows" ? "win" : os;
        const filenameArch =
          channel === "desktop" && os === "linux" && arch === "x64" ? "x86_64" : arch;
        const name = `${product.name}-${channel === "cli" ? "CLI" : "Desktop"}-1.2.3-${filenameOs}-${filenameArch}.${extension}`;
        const mapped = mapPrimaryAsset(name);
        assert.ok(mapped, name);
        for (const version of ["1.2.3", "latest"]) {
          const key = objectKeyFor(mapped, version);
          assert.equal(key, spiritDownloadObjectKey(channel, os, arch, version));
          assert.equal(publicUrlFor(key), spiritDownloadUrl(channel, os, arch, version));
          assert.equal(new URL(publicUrlFor(key)).origin, product.downloadOrigin);
        }
      }
    }
  }
});

test("publish inventory includes workspace runtime dependencies in dependency order", async () => {
  const packages = await readNpmPackages();
  const indices = new Map(packages.map(({ name }, index) => [name, index]));
  assert.equal(packages[0].name, "@spiritagent/product");
  assert.ok(indices.has("@spiritagent/server"));
  const publicationGroup = new Set([
    "@spiritagent/extension-toolkit",
    "@spiritagent/create-extension",
  ]);
  for (const [index, item] of packages.entries()) {
    const manifest = JSON.parse(
      await readFile(new URL(`../../${item.directory}/package.json`, import.meta.url), "utf8"),
    );
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (!range.startsWith("workspace:")) continue;
      assert.ok(indices.has(name), `${item.name} requires unpublished ${name}`);
      if (publicationGroup.has(item.name) && publicationGroup.has(name)) continue;
      assert.ok(indices.get(name) < index, `${name} must be staged before ${item.name}`);
    }
  }
});

test("deployment rejects source links but permits internal package links", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "product-release-links-"));
  try {
    const root = path.join(fixture, "bundle");
    const inside = path.join(root, "package");
    const outside = path.join(fixture, "outside");
    await mkdir(inside, { recursive: true });
    await mkdir(outside);
    await symlink(inside, path.join(root, "internal"), "junction");
    await assertContainedLinks(root);
    await symlink(outside, path.join(root, "escape"), "junction");
    await assert.rejects(assertContainedLinks(root), /escapes its package/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
