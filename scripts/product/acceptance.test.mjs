import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  generateProduct,
  productInputs,
  repoRoot,
} from "../../packages/product/scripts/generate.mjs";

function worker(artifact, fixture) {
  const child = fork(
    fileURLToPath(new URL("./acceptance-worker.mjs", import.meta.url)),
    [artifact, fixture],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, NODE_OPTIONS: "", SPIRIT_PRODUCT_QUALITY: "not-a-runtime-setting" },
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const messages = [];
  const waiters = [];
  let failure;
  child.on("message", (message) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else messages.push(message);
  });
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => {
      failure = new Error(`Product worker exited (${code ?? signal}): ${output}`);
      for (const waiter of waiters.splice(0)) waiter.reject(failure);
      resolve({ code, signal });
    }),
  );
  return {
    child,
    next() {
      if (messages.length) return Promise.resolve(messages.shift());
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    async close() {
      if (child.connected) child.send({ type: "close" });
      const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
      try {
        return await exited;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

for (const changedManifest of [false, true]) {
  test(
    `${changedManifest ? "changed" : "repository"} manifest drives isolated users and shared workspace consumers`,
    { timeout: 30000 },
    async () => {
      const parent = path.join(repoRoot, "tmp");
      await mkdir(parent, { recursive: true });
      const fixture = await mkdtemp(path.join(parent, `product-acceptance-${Date.now()}-`));
      const workers = [];
      try {
        for (const input of productInputs) {
          const destination = path.join(fixture, input);
          await mkdir(path.dirname(destination), { recursive: true });
          await cp(path.join(repoRoot, input), destination);
        }
        const manifest = JSON.parse(await readFile(path.join(fixture, "product.json"), "utf8"));
        if (changedManifest)
          Object.assign(manifest, {
            name: "Example Workspace",
            websiteOrigin: "http://localhost:43121",
            downloadOrigin: "http://127.0.0.1:43122",
            workspaceDataFolderName: ".workspace-fixture",
            qualities: {
              stable: { userDataFolderName: ".user-stable", urlProtocol: "example-stable" },
              dev: { userDataFolderName: ".user-dev", urlProtocol: "example-dev" },
            },
          });
        await writeFile(path.join(fixture, "product.json"), JSON.stringify(manifest));
        await writeFile(path.join(fixture, "package.json"), '{"type":"module"}');
        const ready = [];
        for (const quality of ["stable", "dev"]) {
          const outDir = path.join(fixture, quality);
          await generateProduct({ root: fixture, quality, outDir });
          const process = worker(path.join(outDir, "index.js"), fixture);
          workers.push(process);
          ready.push(await process.next());
        }
        const [stable, dev] = ready;
        assert.equal(stable.type, "ready");
        assert.equal(dev.type, "ready");
        assert.equal(stable.product.quality, "stable");
        assert.equal(dev.product.quality, "dev");
        assert.notEqual(stable.buildId, dev.buildId);
        assert.notEqual(stable.dataDir, dev.dataDir);
        assert.equal(stable.workspaceConfig, dev.workspaceConfig);
        assert.deepEqual(stable.sharedConsumers, ["rules", "skills", "mcp", "hooks", "tasks"]);
        assert.deepEqual(dev.sharedConsumers, stable.sharedConsumers);
        assert.deepEqual(stable.persistence, [
          "config",
          "chats",
          "transcripts",
          "rewind",
          "todos",
          "extensions/cli",
          "extensions/desktop",
          "marketplaces",
          "automations",
          "dreams",
        ]);
        assert.deepEqual(dev.persistence, stable.persistence);
        workers[0].child.send({ type: "peer", peer: dev });
        workers[1].child.send({ type: "peer", peer: stable });
        for (const report of await Promise.all(workers.map((process) => process.next()))) {
          assert.deepEqual(report, {
            type: "verified",
            crossTokenRejected: true,
            mixedProductRejected: true,
            legacyAccesses: 0,
          });
        }
        for (const process of workers)
          assert.deepEqual(await process.close(), { code: 0, signal: null });
      } finally {
        await Promise.all(workers.map((process) => process.close()));
        await rm(fixture, { recursive: true, force: true });
      }
    },
  );
}
