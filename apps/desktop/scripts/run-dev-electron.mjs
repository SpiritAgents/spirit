#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { brandedMacExecutable, devElectronDir } from "./dev-electron-bundle.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");

/**
 * The main process has no HMR. The dev loop rebuilds dist-electron
 * (tsc --watch) and the main-process packages (turbo watch); restart the app
 * when their outputs change. Renderer-only packages (ui/icons/brand) are
 * deliberately excluded: the Vite dev server serves their sources directly.
 */
const RESTART_WATCH_DIRS = [
  path.join(desktopRoot, "dist-electron"),
  ...["host-internal", "agent-core", "server", "extension-toolkit"].map((pkg) =>
    path.join(repoRoot, "packages", pkg, "dist"),
  ),
];
const RESTART_DEBOUNCE_MS = 500;

function resolveElectronExec() {
  if (process.platform === "darwin") {
    const execPath = brandedMacExecutable(devElectronDir(desktopRoot));
    if (!fs.existsSync(execPath)) {
      console.error(
        "[dev] branded Electron.app missing; run scripts/ensure-dev-electron-bundle.mjs first",
      );
      process.exit(1);
    }
    return execPath;
  }
  const require = createRequire(import.meta.url);
  return require("electron");
}

const electron = resolveElectronExec();
const electronArgs = process.argv.slice(2);

let child = null;
let restarting = false;

function spawnElectron() {
  child = spawn(electron, electronArgs, { stdio: "inherit", windowsHide: false });
  child.on("close", (code, signal) => {
    if (restarting) {
      restarting = false;
      spawnElectron();
      return;
    }
    if (code === null) {
      console.error(electron, "exited with signal", signal);
      process.exit(1);
    }
    process.exit(code);
  });
}

let debounceTimer = null;
const changedFiles = new Set();

function scheduleRestart(file) {
  changedFiles.add(file);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const shown = [...changedFiles].slice(0, 3).map((f) => path.basename(f));
    const extra =
      changedFiles.size > shown.length ? ` (+${changedFiles.size - shown.length} more)` : "";
    changedFiles.clear();
    console.log(`[dev] restarting electron: ${shown.join(", ")}${extra}`);
    restarting = true;
    child.kill();
  }, RESTART_DEBOUNCE_MS);
}

for (const dir of RESTART_WATCH_DIRS) {
  if (!fs.existsSync(dir)) {
    continue;
  }
  fs.watch(dir, { recursive: true }, (_event, filename) => {
    if (filename) {
      scheduleRestart(path.join(dir, filename));
    }
  });
}

spawnElectron();

function handleTerminationSignal(signal) {
  process.on(signal, () => {
    if (child && !child.killed) {
      child.kill(signal);
    }
  });
}

handleTerminationSignal("SIGINT");
handleTerminationSignal("SIGTERM");
handleTerminationSignal("SIGUSR2");
