import assert from "node:assert/strict";
import { test } from "vitest";

import { buildMcpServerConfigFromRequest } from "../../../../packages/sessions/dist/host/mcp-config.js";

function stdioRequest(endpoint) {
  return {
    name: "server",
    transportType: "stdio",
    endpoint,
    metadata: "",
    capabilities: { tools: true, prompts: false, resources: false },
  };
}

test("stdio command keeps Windows path backslashes intact", () => {
  const config = buildMcpServerConfigFromRequest(
    stdioRequest(String.raw`C:\tools\server.exe --port 3000`),
  );
  assert.equal(config.transport.type, "stdio");
  assert.equal(config.transport.command, String.raw`C:\tools\server.exe`);
  assert.deepEqual(config.transport.args, ["--port", "3000"]);
});

test("stdio command keeps UNC path backslashes intact", () => {
  const config = buildMcpServerConfigFromRequest(
    stdioRequest(String.raw`\\fileserver\share\bin\mcp.exe`),
  );
  assert.equal(config.transport.command, String.raw`\\fileserver\share\bin\mcp.exe`);
});

test("quoted Windows paths with spaces keep backslashes", () => {
  const config = buildMcpServerConfigFromRequest(
    stdioRequest(String.raw`"C:\Program Files\node\node.exe" "C:\my tools\server.js" --verbose`),
  );
  assert.equal(config.transport.command, String.raw`C:\Program Files\node\node.exe`);
  assert.deepEqual(config.transport.args, [String.raw`C:\my tools\server.js`, "--verbose"]);
});

test("escaped quote inside quotes still yields a literal quote", () => {
  const config = buildMcpServerConfigFromRequest(
    stdioRequest(String.raw`node --eval "say \"hi\""`),
  );
  assert.equal(config.transport.command, "node");
  assert.deepEqual(config.transport.args, ["--eval", 'say "hi"']);
});

test("unclosed quote is rejected", () => {
  assert.throws(() => buildMcpServerConfigFromRequest(stdioRequest('node "unterminated')));
});
