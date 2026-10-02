import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [directory, fixtureParent, expectedBuildId] = process.argv.slice(2);
if (!directory || !fixtureParent || !expectedBuildId) {
  throw new Error(
    "Usage: probe-deployment.mjs <deployed server> <fixture parent> <product build id>",
  );
}
const root = path.resolve(directory);
const fixture = await mkdtemp(path.join(path.resolve(fixtureParent), "deployment-probe-"));
const home = path.join(fixture, "home");
await mkdir(home);
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.APPDATA = path.join(fixture, "appdata");
process.env.XDG_DATA_HOME = path.join(fixture, "xdg-data");
delete process.env.SPIRIT_DATA_DIR;
delete process.env.SPIRIT_SERVER_DATA_DIR;
process.chdir(fixture);

// An enclosing checkout must not supply a dependency missing from the package.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (resolved.url.startsWith("node:")) return resolved;
    if (!resolved.url.startsWith("file:")) {
      throw new Error(`Unexpected deployed module URL: ${resolved.url}`);
    }
    const relative = path.relative(root, fileURLToPath(resolved.url));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Runtime dependency escaped deployment: ${specifier} -> ${resolved.url}`);
    }
    return resolved;
  },
});

const require = createRequire(path.join(root, "package.json"));
const load = (file) => import(pathToFileURL(file).href);
let daemon;
let client;
try {
  const { product, PRODUCT_BUILD_ID } = await load(require.resolve("@spiritagent/product"));
  assert.equal(PRODUCT_BUILD_ID, expectedBuildId);
  const { resolveSpiritDataDir } = await load(require.resolve("@spiritagent/host-internal"));
  const { startDaemon } = await load(path.join(root, "dist/src/daemon.js"));
  const { readCurrentToken } = await load(path.join(root, "dist/src/auth-token.js"));
  const { ServerRpcClient } = await load(path.join(root, "dist/src/client.js"));
  const dataDir = resolveSpiritDataDir();
  assert.equal(dataDir, path.join(home, product.userDataFolderName));
  daemon = await startDaemon({
    dataDir,
    version: "0.0.0-probe",
    idleExitGraceMs: null,
    log: () => {},
  });
  client = new ServerRpcClient({ url: daemon.url, token: await readCurrentToken(dataDir) });
  await client.connect();
  const health = await client.call("server.health");
  assert.equal(health.productBuildId, expectedBuildId);
  assert.equal(client.instanceId, daemon.instanceId);
  console.log(JSON.stringify({ product, productBuildId: health.productBuildId, standalone: true }));
} finally {
  client?.close();
  await daemon?.close();
  await rm(fixture, { recursive: true, force: true });
}
