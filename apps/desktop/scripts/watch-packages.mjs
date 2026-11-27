#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  developmentBuildClosure,
  developmentPackageBuildOrder,
  developmentWatchPackageNames,
} from "./dev-reload-graph.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const SPIRIT_SCOPE = "@spiritagent/";

export function developmentReloadSignalPath(desktopRoot) {
  return path.join(desktopRoot, ".turbo", "dev-runtime-reload.json");
}

export function isUiLocaleSource(repoRoot, file) {
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  return /^packages\/i18n\/src\/locales\/[^/]+\.json$/u.test(relative);
}

export function isIgnoredPackageWatchPath(relativeFile) {
  const file = relativeFile.toString().split(path.sep).join("/");
  if (!file) return true;
  if (
    /(?:^|\/)(?:dist|node_modules|\.turbo|\.git|coverage|test|tests|__tests__)(?:\/|$)/u.test(file)
  ) {
    return true;
  }
  return /(?:\.tsbuildinfo|\.log|\.map|\.DS_Store|\.(?:test|spec)\.[cm]?[jt]sx?)$/u.test(file);
}

/** Serializes affected builds and emits one idle notification per settled batch. */
export class DevelopmentPackageBuildQueue {
  constructor({ order, build, onIdle, onError, debounceMs = 120 }) {
    this.order = order;
    this.build = build;
    this.onIdle = onIdle;
    this.onError = onError;
    this.debounceMs = debounceMs;
    this.pending = new Set();
    this.completed = new Set();
    this.timer = undefined;
    this.running = false;
    this.closed = false;
  }

  schedule(name) {
    if (this.closed || !this.order.includes(name)) return;
    this.pending.add(name);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.drain(), this.debounceMs);
  }

  async drain() {
    if (this.running || this.closed || this.pending.size === 0) return;
    clearTimeout(this.timer);
    this.running = true;
    let failed = false;
    try {
      while (!this.closed && this.pending.size > 0) {
        const batch = this.order.filter((name) => this.pending.has(name));
        this.pending.clear();
        for (const [index, name] of batch.entries()) {
          try {
            await this.build(name);
            this.completed.add(name);
          } catch (error) {
            for (const remaining of batch.slice(index)) this.pending.add(remaining);
            this.onError(error, name);
            failed = true;
            break;
          }
        }
        if (failed) break;
      }
    } finally {
      this.running = false;
    }
    if (!failed && !this.closed && this.pending.size === 0) {
      const built = [...this.completed];
      this.completed.clear();
      await this.onIdle(built);
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }
}

export function writeDevelopmentReloadSignal(desktopRoot, builtPackages) {
  const signal = developmentReloadSignalPath(desktopRoot);
  fs.mkdirSync(path.dirname(signal), { recursive: true });
  const temporary = `${signal}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporary,
    `${JSON.stringify({ version: 1, builtPackages, writtenAt: Date.now() })}\n`,
  );
  fs.renameSync(temporary, signal);
}

function runPackageBuild(name) {
  return new Promise((resolve, reject) => {
    console.log(`[dev] rebuilding ${name}`);
    const child = spawn("pnpm", ["--filter", name, "run", "build"], {
      cwd: repoRoot,
      env: { ...process.env, SPIRIT_DEV_BUILD: "1" },
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} build exited with ${signal ?? `code ${code}`}`));
    });
  });
}

function main() {
  const names = developmentWatchPackageNames(repoRoot);
  const queue = new DevelopmentPackageBuildQueue({
    order: developmentPackageBuildOrder(repoRoot),
    build: runPackageBuild,
    onIdle: async (built) => {
      if (built.length === 0) return;
      writeDevelopmentReloadSignal(desktopRoot, built);
      console.log(`[dev] runtime build settled: ${built.join(", ")}`);
    },
    onError: (error, name) => {
      console.error(`[dev] ${name} build failed; keeping the current Electron runtime`, error);
    },
  });
  const watchers = [];

  for (const name of names) {
    const packageRoot = path.join(repoRoot, "packages", name.slice(SPIRIT_SCOPE.length));
    const watcher = fs.watch(packageRoot, { recursive: true }, (_event, file) => {
      if (!file || isIgnoredPackageWatchPath(file)) return;
      const absolute = path.join(packageRoot, file.toString());
      if (isUiLocaleSource(repoRoot, absolute)) return;
      for (const affected of developmentBuildClosure([name], repoRoot)) queue.schedule(affected);
    });
    watchers.push(watcher);
  }

  const globalInputs = [
    { file: path.join(repoRoot, "product.json"), packages: names },
    {
      file: path.join(repoRoot, "scripts", "product", "generate-content.mjs"),
      packages: ["@spiritagent/extensions"],
    },
  ];
  for (const input of globalInputs) {
    const watcher = fs.watch(input.file, () => {
      for (const name of developmentBuildClosure(input.packages, repoRoot)) queue.schedule(name);
    });
    watchers.push(watcher);
  }

  console.log(`[dev] watching ${names.length} runtime and extension packages`);

  function close() {
    queue.close();
    for (const watcher of watchers) watcher.close();
  }
  process.once("SIGINT", () => close());
  process.once("SIGTERM", () => close());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
