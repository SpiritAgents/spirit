import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
for (const entry of [
  "packages/server/dist/src/daemon.js",
  "apps/desktop/dist-electron/src/host/storage.js",
]) {
  try {
    await access(path.join(root, entry));
  } catch (error) {
    throw new Error(
      `Build server dependencies and Desktop TypeScript before product:verify (missing ${entry})`,
      { cause: error },
    );
  }
}
await mkdir(path.join(root, "tmp"), { recursive: true });
const fixture = await mkdtemp(path.join(root, "tmp", `product-validation-${Date.now()}-`));
const home = path.join(fixture, "home");
await mkdir(home);
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(fixture, "appdata"),
  XDG_DATA_HOME: path.join(fixture, "xdg"),
  TMPDIR: fixture,
  TEMP: fixture,
  TMP: fixture,
  SPIRIT_DATA_DIR: path.join(home, "data"),
  CARGO_HOME: process.env.CARGO_HOME ?? path.join(homedir(), ".cargo"),
  RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(homedir(), ".rustup"),
  CARGO_NET_OFFLINE: "true",
  COREPACK_ENABLE_NETWORK: "0",
  npm_config_offline: "true",
  TURBO_TELEMETRY_DISABLED: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
};
for (const key of ["SPIRIT_SERVER_DATA_DIR", "SPIRIT_SERVER_URL", "SPIRIT_SERVER_TOKEN"])
  delete env[key];
try {
  const child = spawn(
    process.execPath,
    [
      "--test",
      "packages/product/test/product.test.mjs",
      "scripts/product/generate-content.test.mjs",
      "scripts/product/acceptance.test.mjs",
      "scripts/product/source-audit.test.mjs",
      "scripts/release/product-release.test.mjs",
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status, signal) =>
      signal ? reject(new Error(`Product verification stopped by ${signal}`)) : resolve(status),
    );
  });
  process.exitCode = code ?? 1;
} finally {
  await rm(fixture, { recursive: true, force: true });
}
