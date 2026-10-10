import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { ProductManifestSchema, ProductSchema, resolveProduct } from "../schema.ts";
import {
  generateProduct,
  inputFingerprint,
  productInputs,
  readProduct,
  renderProduct,
  repoRoot,
} from "../scripts/generate.mjs";

async function fixture(run) {
  const parent = path.join(repoRoot, "tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "product-test-"));
  try {
    for (const input of productInputs) {
      const destination = path.join(root, input);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(repoRoot, input), destination);
    }
    await writeFile(path.join(root, "package.json"), '{"type":"module"}\n');
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("development quality defaults are overridden only by valid explicit values", async () => {
  const parent = path.join(repoRoot, "tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "product-entry-"));
  try {
    const probe = path.join(root, "quality-probe.mjs");
    await writeFile(probe, "console.log(process.env.SPIRIT_PRODUCT_QUALITY);\n");
    const commandArgs = [process.execPath, probe].map((arg) =>
      process.platform === "win32" ? `"${arg}"` : arg,
    );
    for (const [fallback, explicit, expected] of [
      ["dev", undefined, "dev"],
      ["stable", undefined, "stable"],
      ["dev", "stable", "stable"],
      ["stable", "dev", "dev"],
      ["dev", "", undefined],
      ["dev", "preview", undefined],
    ]) {
      const env = { ...process.env };
      delete env.SPIRIT_PRODUCT_QUALITY;
      if (explicit !== undefined) env.SPIRIT_PRODUCT_QUALITY = explicit;
      const result = spawnSync(
        process.execPath,
        [path.join(repoRoot, "packages/product/scripts/run-quality.mjs"), fallback, ...commandArgs],
        { env, encoding: "utf8", timeout: 10_000 },
      );
      assert.ifError(result.error);
      if (expected === undefined) {
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /ZodError/);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), expected);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("VS Code tasks distinguish development quality from running built outputs", async () => {
  const { tasks, inputs } = JSON.parse(
    await readFile(path.join(repoRoot, ".vscode/tasks.json"), "utf8"),
  );
  for (const label of ["Dev Desktop", "Dev Site", "Dev CLI"]) {
    assert.equal(
      tasks.find((task) => task.label === label).options.env.SPIRIT_PRODUCT_QUALITY,
      "${input:devProductQuality}",
    );
  }
  assert.equal(inputs.find((input) => input.id === "devProductQuality").default, "dev");
  assert.equal(inputs.find((input) => input.id === "buildProductQuality").default, "stable");
  assert.equal(
    tasks.find((task) => task.label === "Build").options.env.SPIRIT_PRODUCT_QUALITY,
    "${input:buildProductQuality}",
  );
  assert.equal(tasks.find((task) => task.label === "Run Built Desktop").options, undefined);
});

test("rejects invalid fields instead of normalizing or falling back", async () => {
  const product = await readProduct();
  for (const field of ["websiteOrigin", "downloadOrigin"]) {
    for (const value of [
      "",
      "https://example.test/",
      "https://example.test/path",
      "https://example.test?q=x",
      "https://example.test#fragment",
      "https://user:password@example.test",
      "file:///data",
      "https://EXAMPLE.test",
      " https://example.test",
      "https://example.test:443",
    ]) {
      assert.equal(ProductSchema.safeParse({ ...product, [field]: value }).success, false, value);
    }
    assert.equal(
      ProductSchema.parse({ ...product, [field]: "http://127.0.0.1:43121" })[field],
      "http://127.0.0.1:43121",
    );
  }
  for (const field of ["userDataFolderName", "workspaceDataFolderName"]) {
    for (const value of [
      "",
      ".",
      "..",
      "/data",
      "a/b",
      "a\\b",
      "C:",
      "a\0b",
      "NUL",
      "con.txt",
      "dir.",
      "dir ",
    ]) {
      assert.equal(ProductSchema.safeParse({ ...product, [field]: value }).success, false, value);
    }
  }
  for (const value of ["", "Stable", "release", null]) {
    assert.equal(ProductSchema.safeParse({ ...product, quality: value }).success, false);
  }
  for (const value of ["", "Brand", "brand:", "brand://", "1brand", "brand space"]) {
    assert.equal(ProductSchema.safeParse({ ...product, urlProtocol: value }).success, false);
  }
  assert.equal(ProductSchema.safeParse({ ...product, name: " " }).success, false);
  assert.equal(ProductSchema.safeParse({ ...product, extra: true }).success, false);
  const { websiteOrigin: _website, ...missingWebsite } = product;
  assert.equal(ProductSchema.safeParse(missingWebsite).success, false);
});

test("quality only selects declared user identity; workspace and origins stay shared", async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "product.json"), "utf8"));
  const stable = resolveProduct(manifest, "stable");
  const dev = resolveProduct(manifest, "dev");
  assert.notEqual(stable.userDataFolderName, dev.userDataFolderName);
  assert.notEqual(stable.urlProtocol, dev.urlProtocol);
  for (const field of ["name", "workspaceDataFolderName", "websiteOrigin", "downloadOrigin"]) {
    assert.equal(stable[field], dev[field]);
  }
  assert.equal(
    ProductManifestSchema.safeParse({ ...manifest, dataFolderName: ".unused" }).success,
    false,
  );
  assert.throws(() => resolveProduct(manifest, "preview"));
});

test("generates deterministically from a changed root manifest and runs Rust without source access", async () => {
  await fixture(async (root) => {
    const manifest = JSON.parse(await readFile(path.join(root, "product.json"), "utf8"));
    manifest.name = 'Example "Workspace"';
    manifest.websiteOrigin = "http://localhost:43121";
    manifest.downloadOrigin = "http://127.0.0.1:43122";
    manifest.workspaceDataFolderName = ".workspace-settings";
    manifest.qualities.stable = {
      userDataFolderName: ".user-stable",
      urlProtocol: "example-stable",
    };
    manifest.qualities.dev = { userDataFolderName: ".user-dev", urlProtocol: "example-dev" };
    await writeFile(path.join(root, "product.json"), JSON.stringify(manifest));
    for (const quality of ["stable", "dev"]) {
      const outDir = path.join(root, quality);
      const first = await generateProduct({ root, quality, outDir });
      const second = await generateProduct({ root, quality, outDir });
      assert.deepEqual(first.files, second.files);
      // TypeScript 7 ships no stable programmatic API (`createProgram` and friends
      // are removed from the runtime package), so this check drives the `tsc` CLI
      // instead of holding a Program in-process. Known limitation: exit status plus
      // printed diagnostics is a coarser signal than getPreEmitDiagnostics. TS 7.1 is
      // expected to restore a stable API; switch back to a programmatic check then.
      const tsc = spawnSync(
        process.platform === "win32" ? "tsc.cmd" : "tsc",
        [
          "--noEmit",
          "--strict",
          "--target",
          "esnext",
          "--module",
          "nodenext",
          "--moduleResolution",
          "nodenext",
          // TS >= 6 defaults `types` to [], so no @types auto-inclusion needs disabling;
          // --ignoreConfig keeps CLI file arguments legal next to our tsconfig.json.
          "--ignoreConfig",
          path.join(outDir, "index.d.ts"),
          path.join(outDir, "product.ts"),
        ],
        { encoding: "utf8" },
      );
      assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
      const baked = await import(pathToFileURL(path.join(outDir, "index.js")));
      assert.deepEqual(baked.product, resolveProduct(manifest, quality));
      assert.equal(Object.isFrozen(baked.product), true);
      const fields = [
        "name",
        "website_origin",
        "download_origin",
        "user_data_folder_name",
        "workspace_data_folder_name",
        "quality",
        "url_protocol",
      ];
      await writeFile(
        path.join(outDir, "probe.rs"),
        `#[allow(dead_code)] mod product;\nfn main() {\n${fields.map((field) => `println!("{}", product::PRODUCT.${field});`).join("\n")}\nprintln!("{}", product::PRODUCT_BUILD_ID);\n}\n`,
      );
      const executable = path.join(outDir, process.platform === "win32" ? "probe.exe" : "probe");
      execFileSync("rustc", ["--edition=2024", path.join(outDir, "probe.rs"), "-o", executable], {
        stdio: "pipe",
        env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root },
      });
      const output = execFileSync(executable, { cwd: outDir, encoding: "utf8" })
        .trimEnd()
        .split(/\r?\n/u);
      assert.deepEqual(output, [...Object.values(baked.product), baked.PRODUCT_BUILD_ID]);
      const runtime = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { product } from ${JSON.stringify(pathToFileURL(path.join(outDir, "index.js")).href)}; console.log(product.quality);`,
        ],
        {
          cwd: outDir,
          encoding: "utf8",
          env: { ...process.env, SPIRIT_PRODUCT_QUALITY: quality === "stable" ? "dev" : "stable" },
        },
      );
      assert.equal(runtime.trim(), quality);
    }
    const stableHash = await inputFingerprint(root, "stable");
    assert.notEqual(stableHash, await inputFingerprint(root, "dev"));
    await writeFile(path.join(root, "packages/product/schema.ts"), "// changed schema\n", {
      flag: "a",
    });
    assert.notEqual(stableHash, await inputFingerprint(root, "stable"));
  });
});

test("invalid manifest does not produce artifacts and declarations come from the schema", async () => {
  await fixture(async (root) => {
    await writeFile(path.join(root, "product.json"), '{"name":"Incomplete"}');
    const outDir = path.join(root, "invalid");
    await assert.rejects(generateProduct({ root, outDir }));
    await assert.rejects(readFile(path.join(outDir, "index.js")), { code: "ENOENT" });
  });
  const rendered = renderProduct(await readProduct());
  for (const field of Object.keys(ProductSchema.shape)) {
    assert.ok(rendered["index.d.ts"].includes(`readonly ${field}:`));
  }
  assert.ok(rendered["index.d.ts"].includes('"stable" | "dev"'));
  assert.doesNotMatch(rendered["index.js"], /node:|process\.env|readFile|zod/u);
});
