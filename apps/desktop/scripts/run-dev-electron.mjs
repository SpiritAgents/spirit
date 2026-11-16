#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { brandedMacExecutable, devElectronDir } from "./dev-electron-bundle.mjs";
import { stopRegisteredDaemons } from "./dev-daemon-lifecycle.mjs";
import {
  developmentNativeSources,
  developmentRestartWatchDirs,
  developmentRuntimeFingerprint,
} from "./dev-reload-graph.mjs";
import { resolveSpiritDataDir } from "../../../packages/config/dist/data-paths.js";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");

/**
 * The main process has no HMR. The dev loop rebuilds dist-electron
 * (tsc --watch) and the main-process packages (turbo watch); restart the app
 * when their outputs change. Renderer-only packages (ui/icons/brand) are
 * deliberately excluded: the Vite dev server serves their sources directly.
 */
const RESTART_WATCH_DIRS = developmentRestartWatchDirs(desktopRoot, repoRoot);
const NATIVE_SOURCES = developmentNativeSources(desktopRoot);
const RESTART_DEBOUNCE_MS = 500;
const RESTART_STABLE_MS = 150;

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
let runningFingerprint;

function spawnElectron(fingerprint) {
  runningFingerprint = fingerprint;
  child = spawn(electron, electronArgs, { stdio: "inherit", windowsHide: false });
  child.on("close", (code, signal) => {
    if (restarting) {
      void (async () => {
        try {
          // Electron must detach while the daemon is still reachable. Once it has
          // exited, no old client remains, so the registered daemon can stop safely.
          await stopRegisteredDaemons(resolveSpiritDataDir());
        } catch (error) {
          console.error("[dev] failed to stop the previous daemon", error);
          process.exit(1);
        }
        restarting = false;
        spawnElectron(developmentRuntimeFingerprint(RESTART_WATCH_DIRS, NATIVE_SOURCES));
      })();
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
let pendingFingerprint;
const changedFiles = new Set();

function scheduleFingerprintCheck(delay) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void (async () => {
      if (restarting) {
        scheduleFingerprintCheck(RESTART_DEBOUNCE_MS);
        return;
      }
      const fingerprint = developmentRuntimeFingerprint(RESTART_WATCH_DIRS, NATIVE_SOURCES);
      if (!fingerprint) {
        pendingFingerprint = undefined;
        scheduleFingerprintCheck(RESTART_DEBOUNCE_MS);
        return;
      }
      if (fingerprint !== pendingFingerprint) {
        pendingFingerprint = fingerprint;
        scheduleFingerprintCheck(RESTART_STABLE_MS);
        return;
      }
      pendingFingerprint = undefined;
      if (fingerprint === runningFingerprint) {
        changedFiles.clear();
        return;
      }

      const shown = [...changedFiles].slice(0, 3).map((f) => path.basename(f));
      const extra =
        changedFiles.size > shown.length ? ` (+${changedFiles.size - shown.length} more)` : "";
      changedFiles.clear();
      console.log(`[dev] restarting electron: ${shown.join(", ")}${extra}`);
      restarting = true;
      child.kill();
    })();
  }, delay);
}

function scheduleRestart(file) {
  changedFiles.add(file);
  pendingFingerprint = undefined;
  scheduleFingerprintCheck(RESTART_DEBOUNCE_MS);
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

spawnElectron(developmentRuntimeFingerprint(RESTART_WATCH_DIRS, NATIVE_SOURCES));

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
