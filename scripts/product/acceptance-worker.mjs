import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [artifact, fixture] = process.argv.slice(2);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const home = path.join(fixture, "home");
const workspace = path.join(fixture, "workspace");
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(fixture, "appdata"),
  XDG_DATA_HOME: path.join(fixture, "xdg"),
  TMPDIR: fixture,
  TEMP: fixture,
  TMP: fixture,
});
for (const name of [
  "SPIRIT_DATA_DIR",
  "SPIRIT_SERVER_DATA_DIR",
  "SPIRIT_SERVER_URL",
  "SPIRIT_SERVER_TOKEN",
])
  delete process.env[name];
await fsp.mkdir(home, { recursive: true });
await fsp.mkdir(workspace, { recursive: true });
process.chdir(workspace);
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (
      specifier === "@spiritagent/product" ||
      result.url === pathToFileURL(path.join(repo, "packages/product/dist/index.js")).href
    ) {
      return { ...result, url: pathToFileURL(artifact).href };
    }
    return result;
  },
});
const { product, PRODUCT_BUILD_ID } = await import(pathToFileURL(artifact).href);
const dataDir = path.join(home, product.userDataFolderName);
const workspaceData = path.join(workspace, product.workspaceDataFolderName);
const legacy = [
  path.join(home, "Library/Application Support", product.name),
  path.join(process.env.APPDATA, product.name),
  path.join(process.env.XDG_DATA_HOME, product.name),
];
for (const directory of legacy) {
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(path.join(directory, "config.json"), '{"legacy":"must-not-read"}');
}
let legacyAccesses = 0;
const originals = [];
for (const module of [fs, fsp]) {
  for (const name of [
    "readFile",
    "readFileSync",
    "readdir",
    "readdirSync",
    "open",
    "openSync",
    "stat",
    "statSync",
    "lstat",
    "lstatSync",
    "access",
    "accessSync",
    "existsSync",
    "realpath",
    "realpathSync",
    "mkdir",
    "mkdirSync",
    "writeFile",
    "writeFileSync",
    "rm",
    "rmSync",
    "unlink",
    "unlinkSync",
    "rename",
    "renameSync",
    "cp",
    "copyFile",
  ]) {
    if (typeof module[name] !== "function") continue;
    const original = module[name];
    originals.push(() => {
      module[name] = original;
    });
    module[name] = function (...args) {
      for (const value of args.slice(
        0,
        name.startsWith("rename") || name === "cp" || name === "copyFile" ? 2 : 1,
      )) {
        const candidate =
          value instanceof URL
            ? fileURLToPath(value)
            : typeof value === "string"
              ? path.resolve(value)
              : undefined;
        if (
          candidate &&
          legacy.some((root) => candidate === root || candidate.startsWith(root + path.sep))
        ) {
          legacyAccesses++;
          throw new Error(`Unexpected old-root access by ${name}`);
        }
      }
      return Reflect.apply(original, this, args);
    };
  }
}
syncBuiltinESMExports();
const load = (relative) => import(pathToFileURL(path.join(repo, relative)).href);
let daemon;
try {
  const host = await load("packages/host-internal/dist/index.js");
  const { startDaemon } = await load("packages/server/dist/src/daemon.js");
  const { ServerRpcClient, ProductBuildMismatchError } = await load(
    "packages/server/dist/src/client.js",
  );
  const { readCurrentToken } = await load("packages/server/dist/src/auth-token.js");
  const { listInstances } = await load("packages/server/dist/src/instance-registry.js");
  assert.equal(host.resolveSpiritDataDir(), dataDir);
  assert.equal(host.loadSpiritConfig(dataDir), undefined);
  assert.deepEqual(await listInstances(dataDir), []);
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(path.join(workspaceData, "skills/shared"), { recursive: true });
  await fsp.mkdir(path.join(dataDir, "skills", product.quality), { recursive: true });
  const skill = (name) =>
    `---\nname: ${name}\ndescription: Controlled fixture\n---\nFixture instructions\n`;
  await fsp.writeFile(path.join(workspaceData, "skills/shared/SKILL.md"), skill("shared"));
  await fsp.writeFile(
    path.join(dataDir, "skills", product.quality, "SKILL.md"),
    skill(product.quality),
  );
  await fsp.writeFile(path.join(workspaceData, "rule.md"), "shared workspace rule");
  await fsp.writeFile(path.join(dataDir, "rule.md"), product.quality);
  const mcp = (command) =>
    JSON.stringify({ servers: { fixture: { transport: { type: "stdio", command } } } });
  await fsp.writeFile(path.join(workspaceData, "mcp.json"), mcp("workspace-command"));
  await fsp.writeFile(path.join(dataDir, "mcp.json"), mcp(product.quality));
  const hooks = (command) => JSON.stringify({ version: 1, hooks: { preToolUse: [{ command }] } });
  await fsp.writeFile(path.join(workspaceData, "hooks.json"), hooks("workspace-command"));
  await fsp.writeFile(path.join(dataDir, "hooks.json"), hooks(product.quality));
  await fsp.writeFile(path.join(workspaceData, "tasks.json"), '{"schemaVersion":1,"tasks":[]}');
  const context = { spiritDataDir: dataDir, workspaceRoot: workspace };
  const rules = await host.discoverRuleEntries(context);
  assert.ok(rules.some((rule) => rule.content === "shared workspace rule"));
  assert.ok(rules.some((rule) => rule.content === product.quality));
  const skills = await host.discoverSkillEntries(context);
  assert.deepEqual(
    skills.map((skill) => skill.source.name).sort(),
    [product.quality, "shared"].sort(),
  );
  const configs = host.createMcpConfigSource(dataDir, workspace).read(true);
  assert.equal(configs.user.servers.fixture.transport.command, product.quality);
  assert.equal(configs.workspace.servers.fixture.transport.command, "workspace-command");
  assert.equal(host.listHookListItems({ ...context, workspaceBinding: "project" }).length, 2);
  assert.deepEqual(
    (await host.loadTaskFiles(context)).map((file) => file.path),
    [path.join(workspaceData, "tasks.json")],
  );
  const config = {
    schemaVersion: 1,
    providers: [],
    activeModel: { providerId: "", name: "" },
    fixture: product.quality,
  };
  await host.saveSpiritConfig(dataDir, config);
  assert.equal(host.loadSpiritConfig(dataDir).fixture, product.quality);
  const desktopStorage = await load("apps/desktop/dist-electron/src/host/storage.js");
  const rewind = await load("apps/desktop/dist-electron/src/host/rewind.js");
  const { DesktopMessageTimeline } = await load(
    "apps/desktop/dist-electron/src/host/message-timeline.js",
  );
  const { normalizeTimelineSnapshotForPersistence } = await load(
    "apps/desktop/dist-electron/src/host/chat-schema.js",
  );
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({ allocateMessageId: () => nextMessageId++ });
  timeline.beginUserTurn("Controlled persistence fixture");
  const desktopMessageTimeline = normalizeTimelineSnapshotForPersistence(timeline.snapshot());
  assert.equal(desktopStorage.spiritDataDir(), dataDir);
  const sessionKey = await desktopStorage.saveStoredSession(undefined, {
    chatSchemaVersion: 2,
    llmHistory: [],
    subagentSessions: [],
    loopEnabled: false,
    desktopMessageTimeline,
    savedAtUnixMs: 1,
    sessionDisplayName: product.quality,
    workspaceRoot: workspace,
  });
  assert.equal(path.dirname(sessionKey), path.join(dataDir, "chats"));
  const session = await desktopStorage.loadStoredSession(sessionKey);
  assert.equal(session.sessionDisplayName, product.quality);
  assert.equal((await desktopStorage.listStoredSessions())[0].path, sessionKey);
  const checkpoint = { archive: { messages: [] }, desktopMessageTimeline };
  await rewind.saveRewindCheckpointSnapshot(
    dataDir,
    session.rewind.sessionId,
    "fixture",
    checkpoint,
  );
  assert.deepEqual(
    await rewind.loadRewindCheckpointSnapshot(dataDir, session.rewind.sessionId, "fixture"),
    checkpoint,
  );
  const transcript = {
    export_version: 1,
    kind: "session_transcript",
    exported_at_unix_ms: 1,
    message_count: 0,
    messages: [],
  };
  const transcriptDir = await host.persistSessionTranscript(dataDir, transcript, { sessionKey });
  assert.equal(transcriptDir, host.resolveTranscriptSessionDir(dataDir, sessionKey));
  assert.deepEqual(
    JSON.parse(await fsp.readFile(path.join(transcriptDir, "transcript.json"), "utf8")),
    transcript,
  );
  const todos = { spiritDataDir: dataDir, scope: { sessionKey } };
  await host.createHostTodoStore(todos).write([{ title: product.quality, status: "pending" }]);
  assert.equal((await host.createHostTodoStore(todos).list())[0].title, product.quality);
  for (const hostKind of ["cli", "desktop"]) {
    const extension = { spiritDataDir: dataDir, hostKind };
    await host
      .createFileExtensionStateStore(extension)
      .saveSettings("fixture", { quality: product.quality });
    assert.deepEqual(await host.createFileExtensionStateStore(extension).loadSettings("fixture"), {
      quality: product.quality,
    });
    assert.equal(
      host.resolveExtensionPaths(extension).extensionsDir,
      path.join(dataDir, "extensions", hostKind),
    );
  }
  await host.ensurePersonalMarketplace(dataDir);
  assert.equal(host.personalRegistryRoot(dataDir), path.join(dataDir, "marketplaces", "personal"));
  assert.equal((await host.readPersonalMarketplaceIndex(dataDir)).name, "personal");
  const automation = await host.createHostAutomationStore(dataDir).create({
    title: "Fixture",
    overview: "No execution",
    trigger: { kind: "time", schedule: { kind: "hourly" } },
    workspaceRoot: workspace,
    modelRef: { providerId: "fixture", name: "fixture" },
    approvalLevel: "default",
  });
  assert.equal(
    (await host.createHostAutomationStore(dataDir).get(automation.id)).definition.title,
    "Fixture",
  );
  const dream = {
    spiritDataDir: dataDir,
    scope: { workspaceRoot: workspace, gitBranch: "fixture" },
  };
  const record = await host
    .createHostDreamStore(dream)
    .record({ title: "Fixture", summary: product.quality });
  assert.equal((await host.createHostDreamStore(dream).read(record.id)).summary, product.quality);
  const privateData = path.join(fixture, "electron");
  const { configureElectronProductStorage } = await load(
    "apps/desktop/dist-electron/electron/product-storage.js",
  );
  const privatePaths = [];
  configureElectronProductStorage({
    setName: (name) => assert.equal(name, product.name),
    getPath: () => privateData,
    setPath: (kind, value) => privatePaths.push([kind, value]),
  });
  assert.deepEqual(privatePaths, [
    ["userData", path.join(privateData, product.name)],
    ["sessionData", path.join(privateData, product.name)],
  ]);
  daemon = await startDaemon({
    dataDir,
    version: "0.0.0-fixture",
    idleExitGraceMs: null,
    log: () => {},
  });
  const token = await readCurrentToken(dataDir);
  const own = new ServerRpcClient({ url: daemon.url, token });
  await own.connect();
  await own.call("server.initialize", {
    clientKind: "cli",
    clientId: product.quality,
    workspaceRoot: workspace,
  });
  const metadata = await own.call("host.loadCliMetadata", {
    workspaceRoot: workspace,
    hostKind: "cli",
  });
  assert.ok(metadata.ruleEntries.some((rule) => rule.content === product.quality));
  assert.ok(metadata.skillEntries.some((skill) => skill.source.name === "shared"));
  own.close();
  assert.equal((await listInstances(dataDir)).length, 1);
  process.send({
    type: "ready",
    product,
    buildId: PRODUCT_BUILD_ID,
    dataDir,
    url: daemon.url,
    workspaceConfig: workspaceData,
    sharedConsumers: ["rules", "skills", "mcp", "hooks", "tasks"],
    persistence: [
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
    ],
  });
  for await (const message of messages()) {
    if (message.type === "close") break;
    if (message.type !== "peer") throw new Error("Unknown acceptance command");
    assert.notEqual(token, await readCurrentToken(message.peer.dataDir));
    const wrongToken = new ServerRpcClient({ url: message.peer.url, token });
    try {
      await assert.rejects(wrongToken.connect());
    } finally {
      wrongToken.close();
    }
    const wrongProduct = new ServerRpcClient({
      url: message.peer.url,
      token: await readCurrentToken(message.peer.dataDir),
    });
    try {
      await assert.rejects(wrongProduct.connect(), ProductBuildMismatchError);
    } finally {
      wrongProduct.close();
    }
    assert.equal((await listInstances(dataDir))[0].instanceId, daemon.instanceId);
    assert.equal(legacyAccesses, 0);
    process.send({
      type: "verified",
      crossTokenRejected: true,
      mixedProductRejected: true,
      legacyAccesses,
    });
  }
} finally {
  await daemon?.close();
  for (const restore of originals) restore();
  syncBuiltinESMExports();
  for (const directory of legacy)
    assert.equal(
      await fsp.readFile(path.join(directory, "config.json"), "utf8"),
      '{"legacy":"must-not-read"}',
    );
  process.disconnect();
}

async function* messages() {
  const { on } = await import("node:events");
  for await (const [message] of on(process, "message")) yield message;
}
