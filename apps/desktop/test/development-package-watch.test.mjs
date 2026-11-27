import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";

import { cleanPackageDist } from "../../../scripts/clean-package-dist.mjs";
import {
  developmentBuildClosure,
  developmentPackageBuildOrder,
} from "../scripts/dev-reload-graph.mjs";
import {
  DevelopmentPackageBuildQueue,
  developmentReloadSignalPath,
  isIgnoredPackageWatchPath,
  isUiLocaleSource,
  writeDevelopmentReloadSignal,
} from "../scripts/watch-packages.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const fixtureDirs = [];

afterEach(() => {
  for (const directory of fixtureDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spirit-dev-package-watch-"));
  fixtureDirs.push(directory);
  return directory;
}

test("package watching ignores build outputs and leaves UI locales to HMR", () => {
  assert.ok(isIgnoredPackageWatchPath("dist/index.js"));
  assert.ok(isIgnoredPackageWatchPath("src/service.test.ts"));
  assert.ok(isIgnoredPackageWatchPath("test/service.ts"));
  assert.ok(!isIgnoredPackageWatchPath("src/service.ts"));
  assert.ok(isUiLocaleSource(repoRoot, path.join(repoRoot, "packages/i18n/src/locales/en.json")));
  assert.ok(
    !isUiLocaleSource(repoRoot, path.join(repoRoot, "packages/i18n/src/cli-locales/en.json")),
  );
});

test("the build queue publishes one idle event after the whole affected batch", async () => {
  const builds = [];
  const idle = [];
  let releaseFirst;
  let notifyFirst;
  const firstStarted = new Promise((resolve) => {
    notifyFirst = resolve;
  });
  const queue = new DevelopmentPackageBuildQueue({
    order: ["a", "b", "c"],
    debounceMs: 0,
    build: async (name) => {
      builds.push(name);
      if (builds.length === 1) {
        notifyFirst();
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
    },
    onIdle: async (names) => idle.push(names),
    onError: (error) => {
      throw error;
    },
  });

  queue.schedule("b");
  queue.schedule("a");
  await firstStarted;
  queue.schedule("c");
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(builds, ["a", "b", "c"]);
  assert.deepEqual(idle, [["a", "b", "c"]]);
  queue.close();
});

test("a shared UI edit rebuilds built-in extensions before one reload signal", async () => {
  const builds = [];
  const idle = [];
  const order = developmentPackageBuildOrder(repoRoot);
  const affected = developmentBuildClosure(["@spiritagent/ui"], repoRoot);
  const queue = new DevelopmentPackageBuildQueue({
    order,
    debounceMs: 0,
    build: async (name) => builds.push(name),
    onIdle: async (names) => idle.push(names),
    onError: (error) => {
      throw error;
    },
  });

  try {
    for (const name of affected) queue.schedule(name);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const expected = order.filter((name) => affected.has(name));
    assert.deepEqual(builds, expected);
    assert.deepEqual(idle, [expected]);
  } finally {
    queue.close();
  }
});

test("a failed build keeps the old runtime and retries on the next edit", async () => {
  const idle = [];
  const errors = [];
  let attempts = 0;
  const queue = new DevelopmentPackageBuildQueue({
    order: ["a"],
    debounceMs: 0,
    build: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("compile failed");
    },
    onIdle: async (names) => idle.push(names),
    onError: (error, name) => errors.push([name, error.message]),
  });

  queue.schedule("a");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(idle, []);
  assert.deepEqual(errors, [["a", "compile failed"]]);

  queue.schedule("a");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(attempts, 2);
  assert.deepEqual(idle, [["a"]]);
  queue.close();
});

test("development builds preserve existing outputs while production cleans them", () => {
  const root = fixture();
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist);
  const output = path.join(dist, "index.js");
  fs.writeFileSync(output, "export {};\n");

  assert.equal(cleanPackageDist({ cwd: root, development: true }), false);
  assert.ok(fs.existsSync(output));
  assert.equal(cleanPackageDist({ cwd: root, development: false }), true);
  assert.ok(!fs.existsSync(dist));
});

test("reload signals replace the previous generation atomically", () => {
  const root = fixture();
  writeDevelopmentReloadSignal(root, ["@spiritagent/i18n"]);
  writeDevelopmentReloadSignal(root, ["@spiritagent/workbench"]);
  const signal = JSON.parse(fs.readFileSync(developmentReloadSignalPath(root), "utf8"));
  assert.deepEqual(signal.builtPackages, ["@spiritagent/workbench"]);
  assert.equal(
    fs
      .readdirSync(path.dirname(developmentReloadSignalPath(root)))
      .filter((file) => file.endsWith(".tmp")).length,
    0,
  );
});
