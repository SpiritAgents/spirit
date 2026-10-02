import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { product } from "@spiritagent/product";
import { readProduct } from "../../../packages/product/scripts/generate.mjs";

const require = createRequire(import.meta.url);
const siteRoot = fileURLToPath(new URL("../", import.meta.url));
const stable = await readProduct("stable");
const dev = await readProduct("dev");
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const address = reservation.address();
assert.ok(address && typeof address === "object");
const { port } = address;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);

const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: siteRoot, stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(child, "exit");
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});
try {
  const deadline = Date.now() + 20_000;
  while (!output.includes("Ready in")) {
    if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
      throw new Error(`Site did not become ready: ${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  let checked = 0;
  for (const locale of ["en-US", "zh-CN", "zh-TW", "ja", "ko", "de", "fr", "es", "pt-BR", "ru"]) {
    for (const suffix of ["", "/index.md", "/docs/config", "/docs/config.md"]) {
      const response = await fetch(`http://127.0.0.1:${port}/${locale}${suffix}`, {
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      });
      assert.equal(response.status, 200, `${locale}${suffix}`);
      const body = await response.text();
      assert.ok(!body.includes("{{product."), `${locale}${suffix}: unresolved product value`);
      if (suffix.startsWith("/docs/")) {
        assert.ok(body.includes(stable.userDataFolderName), `${locale}${suffix}: Stable root`);
        assert.ok(body.includes(dev.userDataFolderName), `${locale}${suffix}: Dev root`);
        assert.ok(body.includes("%USERPROFILE%"), `${locale}${suffix}: Windows home`);
      } else {
        assert.ok(body.includes(product.name), `${locale}${suffix}: product name`);
      }
      checked++;
    }
  }
  console.log(`Checked ${checked} HTML/Markdown responses from the production Site on loopback.`);
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await exited;
}
