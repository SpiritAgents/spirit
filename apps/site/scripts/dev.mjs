import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { generateProductContent } from "../../../scripts/product/generate-content.mjs";

const siteRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
let pending = Promise.resolve();
let timer;
let child;
let stopping = false;

function fail(error) {
  console.error("Cannot regenerate Site product content:", error);
  process.exitCode = 1;
  stop();
}

function stop(signal = "SIGTERM") {
  stopping = true;
  clearTimeout(timer);
  watcher.close();
  child?.kill(signal);
}

const watcher = watch(new URL("../content/docs", import.meta.url), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    pending = pending.then(() => generateProductContent({ scope: "site" })).catch(fail);
  }, 100);
});
watcher.on("error", fail);
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop());

try {
  pending = generateProductContent({ scope: "site" });
  await pending;
  if (!stopping) {
    child = spawn(
      process.execPath,
      [
        require.resolve("next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        ...process.argv.slice(2),
      ],
      { cwd: siteRoot, stdio: "inherit" },
    );
    child.on("error", fail);
    child.on("exit", (code) => {
      process.exitCode ||= code ?? 0;
      stop();
    });
  }
} catch (error) {
  fail(error);
}
