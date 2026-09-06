import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assertMarketplaceExtensionName,
  parseExtensionDump,
  parseMarketplaceIndex,
  parseMarketplaceIndexText,
  parseNpmPackageSpecifier,
  resolveMarketplaceExtensionSource,
} from "./schema.js";

function validEntry(): Record<string, unknown> {
  return {
    name: "extension-hello",
    version: "1.0.0",
    source: { source: "npm", package: "@spiritagents/extension-hello@1.0.0" },
    icon: "extensions/extension-hello/icon.svg",
    displayName: "Hello",
    description: "Example Spirit extension.",
    author: { name: "Spirit" },
    category: "developer-tools",
    featured: true,
    reviewStatus: "verified",
    manifest: {
      supportedHosts: ["cli", "desktop"],
      activationEvents: ["onStartup"],
      requestedCapabilities: ["skills"],
      contributes: { skills: true },
    },
  };
}

function validIndex(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "spirit-official",
    displayName: "Spirit Official",
    description: "Official Spirit extension registry.",
    owner: { name: "Spirit", url: "https://spirit.dev" },
    extensions: [validEntry()],
  };
}

test("parseMarketplaceIndex accepts the spec example shape", () => {
  const index = parseMarketplaceIndex(validIndex());
  assert.equal(index.name, "spirit-official");
  assert.equal(index.displayName, "Spirit Official");
  assert.equal(index.owner?.url, "https://spirit.dev");
  assert.equal(index.extensions.length, 1);
  const entry = index.extensions[0]!;
  assert.equal(entry.name, "extension-hello");
  assert.equal(entry.version, "1.0.0");
  assert.deepEqual(entry.source, {
    source: "npm",
    package: "@spiritagents/extension-hello@1.0.0",
  });
  assert.equal(entry.icon, "extensions/extension-hello/icon.svg");
  assert.equal(entry.reviewStatus, "verified");
  assert.equal(entry.featured, true);
  assert.deepEqual(entry.manifest.supportedHosts, ["cli", "desktop"]);
  assert.deepEqual(entry.manifest.requestedCapabilities, ["skills"]);
  assert.equal(entry.manifest.contributes?.skills, true);
});

test("parseMarketplaceIndexText parses raw JSON", () => {
  const index = parseMarketplaceIndexText(JSON.stringify(validIndex()));
  assert.equal(index.name, "spirit-official");
  assert.throws(() => parseMarketplaceIndexText("{ nope"), /not valid JSON/);
});

test("schemaVersion must be 1", () => {
  const doc = validIndex();
  doc["schemaVersion"] = 2;
  assert.throws(() => parseMarketplaceIndex(doc), /schemaVersion must be 1/);
  assert.throws(() => parseMarketplaceIndex("nope"), /must be an object/);
});

test("registry name must be kebab-case", () => {
  const doc = validIndex();
  doc["name"] = "Spirit_Official";
  assert.throws(() => parseMarketplaceIndex(doc), /kebab-case/);
});

test("entry name must be kebab-case", () => {
  assert.equal(assertMarketplaceExtensionName("extension-hello", "name"), "extension-hello");
  assert.equal(assertMarketplaceExtensionName("a", "name"), "a");
  for (const bad of [
    "Hello",
    "-hello",
    "hello-",
    "hello--world",
    "hello_world",
    "hello world",
    "",
  ]) {
    assert.throws(() => assertMarketplaceExtensionName(bad, "name"), /kebab-case|non-empty/, bad);
  }
  const doc = validIndex();
  (doc["extensions"] as Record<string, unknown>[])[0]!["name"] = "Hello World";
  assert.throws(() => parseMarketplaceIndex(doc), /extensions\[0\]\.name.*kebab-case/);
});

test("entry version must be strict semver without pre-release", () => {
  const doc = validIndex();
  (doc["extensions"] as Record<string, unknown>[])[0]!["version"] = "1.0.0-beta";
  assert.throws(() => parseMarketplaceIndex(doc), /extensions\[0\]\.version/);
});

test("duplicate entry names are rejected", () => {
  const doc = validIndex();
  (doc["extensions"] as Record<string, unknown>[]).push(validEntry());
  assert.throws(() => parseMarketplaceIndex(doc), /duplicates/);
});

test("reviewStatus defaults to unverified and rejects unknown values", () => {
  const doc = validIndex();
  const entry = (doc["extensions"] as Record<string, unknown>[])[0]!;
  delete entry["reviewStatus"];
  assert.equal(parseMarketplaceIndex(doc).extensions[0]!.reviewStatus, "unverified");
  entry["reviewStatus"] = "approved";
  assert.throws(() => parseMarketplaceIndex(doc), /reviewStatus must be one of/);
});

test("local source string is validated as a registry-relative path", () => {
  const doc = validIndex();
  const entry = (doc["extensions"] as Record<string, unknown>[])[0]!;
  entry["source"] = "./extensions/extension-hello";
  const parsed = parseMarketplaceIndex(doc);
  assert.equal(parsed.extensions[0]!.source, "extensions/extension-hello");
  entry["source"] = "../escape";
  assert.throws(() => parseMarketplaceIndex(doc), /\.\./);
});

test("resolveMarketplaceExtensionSource handles both forms and rejects unknown backends", () => {
  assert.deepEqual(resolveMarketplaceExtensionSource("./extensions/a", "source"), {
    kind: "local",
    path: "extensions/a",
  });
  assert.deepEqual(
    resolveMarketplaceExtensionSource({ source: "npm", package: "@s/a@1.2.3" }, "source"),
    { kind: "npm", packageName: "@s/a", version: "1.2.3" },
  );
  assert.throws(
    () => resolveMarketplaceExtensionSource({ source: "git", url: "x" }, "source"),
    /must be "npm"/,
  );
  assert.throws(() => resolveMarketplaceExtensionSource(42, "source"), /must be/);
});

test("parseNpmPackageSpecifier requires pinned name@x.y.z", () => {
  assert.deepEqual(parseNpmPackageSpecifier("@scope/name@1.2.3", "package"), {
    packageName: "@scope/name",
    version: "1.2.3",
  });
  assert.deepEqual(parseNpmPackageSpecifier("name@0.0.1", "package"), {
    packageName: "name",
    version: "0.0.1",
  });
  for (const bad of [
    "name",
    "name@latest",
    "name@^1.0.0",
    "name@1.0",
    "@scope/@1.0.0",
    "Na me@1.0.0",
  ]) {
    assert.throws(
      () => parseNpmPackageSpecifier(bad, "package"),
      /pinned|invalid|valid semver/,
      bad,
    );
  }
});

test("icon must be a registry-relative SVG path", () => {
  const doc = validIndex();
  const entry = (doc["extensions"] as Record<string, unknown>[])[0]!;
  entry["icon"] = "extensions/a/icon.png";
  assert.throws(() => parseMarketplaceIndex(doc), /SVG/);
  entry["icon"] = "/abs/icon.svg";
  assert.throws(() => parseMarketplaceIndex(doc), /absolute/);
});

test("manifest requires non-empty supportedHosts of known kinds", () => {
  const doc = validIndex();
  const entry = (doc["extensions"] as Record<string, unknown>[])[0]!;
  entry["manifest"] = { ...(entry["manifest"] as object), supportedHosts: [] };
  assert.throws(() => parseMarketplaceIndex(doc), /supportedHosts must be a non-empty array/);
  entry["manifest"] = { ...(entry["manifest"] as object), supportedHosts: ["web"] };
  assert.throws(() => parseMarketplaceIndex(doc), /supportedHosts\[0\]/);
});

test("instruction contributions must agree with requestedCapabilities", () => {
  const doc = validIndex();
  const entry = (doc["extensions"] as Record<string, unknown>[])[0]!;
  entry["manifest"] = {
    supportedHosts: ["cli"],
    requestedCapabilities: [],
    contributes: { skills: true },
  };
  assert.throws(() => parseMarketplaceIndex(doc), /contributes\.skills but is missing skills/);
  entry["manifest"] = {
    supportedHosts: ["cli"],
    requestedCapabilities: ["mcp"],
  };
  assert.throws(() => parseMarketplaceIndex(doc), /declares the mcp capability but is missing/);
});

test("desktop/cli contributions must agree with desktop-ui/cli-ui capabilities", () => {
  const doc = validIndex();
  const entry = (doc["extensions"] as Record<string, unknown>[])[0]!;
  entry["manifest"] = {
    supportedHosts: ["desktop"],
    contributes: { desktop: {} },
  };
  assert.throws(() => parseMarketplaceIndex(doc), /contributes\.desktop but is missing desktop-ui/);
  entry["manifest"] = {
    supportedHosts: ["desktop"],
    requestedCapabilities: ["desktop-ui"],
    contributes: { desktop: {} },
  };
  assert.equal(
    parseMarketplaceIndex(doc).extensions[0]!.manifest.contributes?.["desktop-ui"],
    undefined,
  );
});

test("displayName and description are required list-level metadata", () => {
  const doc = validIndex();
  const entry = (doc["extensions"] as Record<string, unknown>[])[0]!;
  delete entry["displayName"];
  assert.throws(() => parseMarketplaceIndex(doc), /displayName must be a non-empty string/);
  entry["displayName"] = "Hello";
  delete entry["description"];
  assert.throws(() => parseMarketplaceIndex(doc), /description must be a non-empty string/);
});

test("parseExtensionDump validates the install-record schema", () => {
  const dump = parseExtensionDump({
    schemaVersion: 1,
    name: "extension-hello",
    version: "1.0.0",
    sourceId: "built-in",
    displayName: "Hello",
    description: "Example Spirit extension.",
    icon: ".spirit/icon.svg",
    manifest: {
      supportedHosts: ["cli"],
      requestedCapabilities: ["skills"],
      contributes: { skills: true },
    },
  });
  assert.equal(dump.sourceId, "built-in");
  assert.equal(dump.name, "extension-hello");
  assert.equal(dump.icon, ".spirit/icon.svg");

  assert.throws(
    () => parseExtensionDump({ schemaVersion: 2, name: "x" }),
    /schemaVersion must be 1/,
  );
  assert.throws(
    () =>
      parseExtensionDump({
        schemaVersion: 1,
        name: "extension-hello",
        version: "1.0.0",
        displayName: "Hello",
        description: "x",
        manifest: { supportedHosts: ["cli"] },
      }),
    /sourceId must be a non-empty string/,
  );
});
