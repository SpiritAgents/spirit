#!/usr/bin/env node
/**
 * Headless smoke test for the extension marketplace: drives the real CLI
 * command face (CLI → daemon `host.*` RPC → host-internal) against local-only
 * fixtures. Fully offline; npm artifact paths are covered by unit tests.
 *
 * Fixture: `<repoRoot>/.marketplace/` in the spec registry layout
 * (`.spirit/marketplace.json` + `extensions/<name>/`). The directory is
 * git-ignored locally (`.git/info/exclude`) and regenerated when missing.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, ".marketplace");
const cliBin = path.join(
  repoRoot,
  "target",
  "debug",
  `spirit${process.platform === "win32" ? ".exe" : ""}`,
);

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#666"/></svg>\n';

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}${detail ? `: ${detail}` : ""}`);
  }
}

/** Regenerate the fixture registry when missing (spec layout). */
function ensureFixture() {
  const indexPath = path.join(fixtureRoot, ".spirit", "marketplace.json");
  if (existsSync(indexPath)) {
    return;
  }
  console.log("[smoke] fixture missing; generating .marketplace/");
  const contentDir = path.join(fixtureRoot, "extensions", "i-am-a-extension");
  mkdirSync(path.join(contentDir, "skills", "demo-skill"), { recursive: true });
  writeFileSync(path.join(contentDir, "icon.svg"), ICON_SVG, "utf8");
  writeFileSync(
    path.join(contentDir, "package.json"),
    `${JSON.stringify({ name: "i-am-a-extension", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(contentDir, "skills", "demo-skill", "SKILL.md"),
    "---\nname: demo-skill\ndescription: Demo skill contributed by the smoke fixture extension.\n---\n\nDo the demo thing.\n",
    "utf8",
  );
  writeFixtureIndex("1.0.0");
}

function writeFixtureIndex(version) {
  const doc = {
    schemaVersion: 1,
    name: "smoke-registry",
    displayName: "Smoke Registry",
    description: "Local fixture registry for the extension marketplace smoke test.",
    owner: { name: "Spirit" },
    extensions: [
      {
        name: "i-am-a-extension",
        version,
        source: "./extensions/i-am-a-extension",
        icon: "extensions/i-am-a-extension/icon.svg",
        displayName: "I Am A Extension",
        description: "Smoke fixture extension with a skills contribution.",
        author: { name: "Spirit" },
        categories: ["developer-tools"],
        reviewStatus: "verified",
        manifest: {
          supportedHosts: ["cli", "desktop"],
          activationEvents: ["onStartup"],
          requestedCapabilities: ["skills"],
          contributes: { skills: true },
        },
      },
      {
        name: "i-am-unverified",
        version: "0.1.0",
        source: "./extensions/i-am-unverified",
        displayName: "I Am Unverified",
        description: "Smoke fixture extension without review.",
        reviewStatus: "unverified",
        manifest: { supportedHosts: ["cli", "desktop"] },
      },
    ],
  };
  mkdirSync(path.join(fixtureRoot, ".spirit"), { recursive: true });
  writeFileSync(
    path.join(fixtureRoot, ".spirit", "marketplace.json"),
    `${JSON.stringify(doc, null, 2)}\n`,
    "utf8",
  );
  const unverifiedDir = path.join(fixtureRoot, "extensions", "i-am-unverified");
  mkdirSync(unverifiedDir, { recursive: true });
  writeFileSync(
    path.join(unverifiedDir, "package.json"),
    `${JSON.stringify({ name: "i-am-unverified", version: "0.1.0" }, null, 2)}\n`,
    "utf8",
  );
}

function build() {
  console.log("[smoke] building server and CLI…");
  execFileSync("pnpm", ["run", "build:server"], { cwd: repoRoot, stdio: "inherit" });
  execFileSync("cargo", ["build", "-p", "spirit"], { cwd: repoRoot, stdio: "inherit" });
}

function runCli(dataDir, args, { expectFail = false } = {}) {
  try {
    const stdout = execFileSync(cliBin, args, {
      cwd: repoRoot,
      env: { ...process.env, SPIRIT_DATA_DIR: dataDir },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    if (expectFail) {
      return { ok: true, output: stdout, expectedFailure: true };
    }
    return { ok: true, output: stdout };
  } catch (error) {
    if (expectFail) {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      return { ok: true, output, expectedFailure: true };
    }
    return {
      ok: false,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`,
    };
  }
}

function killDaemon(dataDir) {
  const instancesDir = path.join(dataDir, "server", "instances");
  if (!existsSync(instancesDir)) {
    return;
  }
  for (const file of readdirSync(instancesDir)) {
    try {
      const record = JSON.parse(readFileSync(path.join(instancesDir, file), "utf8"));
      if (Number.isInteger(record.pid) && record.pid > 0) {
        process.kill(record.pid);
      }
    } catch {
      // best effort
    }
  }
}

async function main() {
  ensureFixture();
  build();

  const dataDir = mkdtempSync(path.join(tmpdir(), "spirit-marketplace-smoke-"));
  const secondRegistry = mkdtempSync(path.join(tmpdir(), "spirit-marketplace-smoke-b-"));
  console.log(`[smoke] data dir: ${dataDir}`);

  try {
    // 1. add the local path source
    let result = runCli(dataDir, ["extension", "marketplace", "add", "./.marketplace"]);
    check("marketplace add", result.ok && result.output.includes("Smoke Registry"), result.output);

    // 2. list + detail: entries, icon path, declaration
    result = runCli(dataDir, ["extension", "marketplace", "list"]);
    check(
      "marketplace list shows built-in, personal, and the added source",
      result.ok &&
        result.output.includes("Built-in") &&
        result.output.includes("Personal") &&
        result.output.includes("Smoke Registry"),
      result.output,
    );

    // 3. install: local copy + dump content
    result = runCli(dataDir, ["extension", "install", "i-am-a-extension"]);
    check("install verified entry", result.ok && result.output.includes("Installed extension"), result.output);

    // 4. installed state + (source id, name) identity on disk
    const sourceId = Buffer.from(fixtureRoot, "utf8").toString("base64url");
    const installDir = path.join(dataDir, "extensions", "cli", sourceId, "i-am-a-extension");
    const dumpPath = path.join(installDir, ".spirit", "extension.json");
    check(
      "install dir is source-scoped and the dump carries identity + source id",
      existsSync(dumpPath),
    );
    if (existsSync(dumpPath)) {
      const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
      check(
        "dump content: name/version/sourceId/manifest",
        dump.name === "i-am-a-extension" &&
          dump.version === "1.0.0" &&
          dump.sourceId === sourceId &&
          dump.manifest.contributes?.skills === true,
        JSON.stringify(dump),
      );
      check(
        "registry icon copied into the install dir",
        existsSync(path.join(installDir, ".spirit", "icon.svg")),
      );
      check(
        "declared skill content installed",
        existsSync(path.join(installDir, "skills", "demo-skill", "SKILL.md")),
      );
    }

    // 5. bump the fixture version → update → overwrite install
    writeFixtureIndex("1.1.0");
    result = runCli(dataDir, ["extension", "update", "i-am-a-extension"]);
    check(
      "update reinstalls the newer entry",
      result.ok && result.output.includes("version: 1.1.0"),
      result.output,
    );
    if (existsSync(dumpPath)) {
      const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
      check("dump version after update", dump.version === "1.1.0", JSON.stringify(dump));
    }
    writeFixtureIndex("1.0.0");

    // 6. ZIP import → Personal: index upsert + no update semantics
    const zipBase64 = Buffer.from(
      zipSync({
        ".spirit/extension.json": new TextEncoder().encode(
          `${JSON.stringify(
            {
              schemaVersion: 1,
              name: "zip-imported",
              version: "0.3.0",
              sourceId: "self-declared",
              displayName: "Zip Imported",
              description: "ZIP import smoke fixture.",
              manifest: { supportedHosts: ["cli", "desktop"] },
            },
            null,
            2,
          )}\n`,
        ),
        "note.txt": new TextEncoder().encode("hello from zip\n"),
      }),
    );
    const zipPath = path.join(dataDir, "zip-imported.zip");
    writeFileSync(zipPath, zipBase64);
    result = runCli(dataDir, ["extension", "import", zipPath]);
    check(
      "ZIP import installs under the personal source",
      result.ok && result.output.includes("personal/zip-imported"),
      result.output,
    );
    const personalIndexPath = path.join(
      dataDir,
      "marketplaces",
      "personal",
      ".spirit",
      "marketplace.json",
    );
    check("personal registry index upserted", existsSync(personalIndexPath));
    if (existsSync(personalIndexPath)) {
      const personalIndex = JSON.parse(readFileSync(personalIndexPath, "utf8"));
      const entry = personalIndex.extensions.find((item) => item.name === "zip-imported");
      check(
        "personal entry is unverified with a local source",
        entry?.reviewStatus === "unverified" && entry?.source === "./extensions/zip-imported",
        JSON.stringify(entry),
      );
    }
    result = runCli(dataDir, ["extension", "update", "personal/zip-imported"]);
    check(
      "personal entries have no update semantics",
      result.ok && result.output.includes("up to date"),
      result.output,
    );

    // 7. conflict: a second source with the same name → error + --marketplace resolves
    const secondIndexDir = path.join(secondRegistry, ".spirit");
    mkdirSync(secondIndexDir, { recursive: true });
    writeFileSync(
      path.join(secondIndexDir, "marketplace.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          name: "smoke-registry-b",
          displayName: "Smoke Registry B",
          extensions: [
            {
              name: "i-am-a-extension",
              version: "2.0.0",
              source: "./extensions/i-am-a-extension",
              displayName: "I Am A Extension (B)",
              description: "Conflicting fixture extension from registry B.",
              reviewStatus: "verified",
              manifest: { supportedHosts: ["cli", "desktop"] },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    cpSync(
      path.join(fixtureRoot, "extensions", "i-am-a-extension"),
      path.join(secondRegistry, "extensions", "i-am-a-extension"),
      { recursive: true },
    );
    result = runCli(dataDir, ["extension", "marketplace", "add", secondRegistry]);
    check("add second source", result.ok, result.output);

    result = runCli(dataDir, ["extension", "remove", `${sourceId}/i-am-a-extension`]);
    check("remove the first install", result.ok, result.output);

    result = runCli(dataDir, ["extension", "install", "i-am-a-extension"], { expectFail: true });
    check(
      "same name in two sources is an explicit conflict",
      result.output.includes("multiple marketplaces") &&
        result.output.includes("smoke-registry") &&
        result.output.includes("smoke-registry-b"),
      result.output,
    );
    result = runCli(dataDir, [
      "extension",
      "install",
      "i-am-a-extension",
      "--marketplace",
      "smoke-registry-b",
    ]);
    check(
      "--marketplace disambiguates",
      result.ok && result.output.includes("version: 2.0.0"),
      result.output,
    );

    // review gate: the unverified fixture entry requires acknowledgement
    result = runCli(dataDir, ["extension", "install", "i-am-unverified"], { expectFail: true });
    check(
      "unverified entry hits the review gate",
      result.output.includes("Review required") || result.output.includes("review"),
      result.output,
    );
    result = runCli(dataDir, ["extension", "install", "i-am-unverified", "--review-acknowledged"]);
    check("review acknowledgement installs", result.ok, result.output);

    // 8. cleanup: remove extension + sources
    result = runCli(dataDir, ["extension", "marketplace", "remove", "smoke-registry-b"]);
    check("marketplace remove", result.ok, result.output);
    result = runCli(dataDir, ["extension", "marketplace", "remove", "smoke-registry"]);
    check("marketplace remove first source", result.ok, result.output);
    result = runCli(dataDir, ["extension", "marketplace", "list"]);
    check(
      "sources back to built-in + personal",
      result.ok && !result.output.includes("Smoke Registry"),
      result.output,
    );
  } finally {
    writeFixtureIndex("1.0.0");
    killDaemon(dataDir);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(secondRegistry, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`[smoke] ${failures} check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("[smoke] extension marketplace: all checks passed");
}

await main();
