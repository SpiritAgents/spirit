import { createInterface } from "node:readline";

let clientCapabilities = {};
let callCount = 0;
let dynamicToolEnabled = false;
let nextServerRequestId = 1;
const pendingServerResponses = new Map();

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendServerRequest(method, params) {
  const id = `srv-${nextServerRequestId++}`;
  return new Promise((resolve) => {
    pendingServerResponses.set(id, resolve);
    writeMessage({ jsonrpc: "2.0", id, method, params });
  });
}

function handle(message) {
  if (message.id !== undefined && message.method === undefined) {
    const resolver = pendingServerResponses.get(message.id);
    if (resolver) {
      pendingServerResponses.delete(message.id);
      resolver(message.result ?? message.error);
    }
    return;
  }

  if (message.method === "initialize") {
    clientCapabilities = message.params?.capabilities ?? {};
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
        serverInfo: { name: "pool-test-fixture", version: "0.0.0" },
      },
    });
    return;
  }

  if (message.method === "notifications/initialized" || message.method === "ping") {
    if (message.id !== undefined) {
      writeMessage({ jsonrpc: "2.0", id: message.id, result: {} });
    }
    return;
  }

  if (message.method === "tools/list") {
    const tools = [
      {
        name: "ping_info",
        description: "Return process pid, call counter, and negotiated extensions",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "crash_now",
        description: "Exit immediately to simulate server crash",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "enable_dynamic_tool",
        description: "Add a dynamic tool and emit notifications/tools/list_changed",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "delayed_open_ui",
        description: "Wait delayMs then send spirit/ui/open back to the host",
        inputSchema: {
          type: "object",
          properties: {
            delayMs: { type: "number" },
            viewId: { type: "string" },
          },
        },
      },
    ];
    if (dynamicToolEnabled) {
      tools.push({
        name: "dynamic_tool",
        description: "Dynamically registered after tools/list_changed",
        inputSchema: { type: "object", properties: {} },
      });
    }
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools },
    });
    return;
  }

  if (message.method === "resources/list") {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        resources: [
          {
            uri: "test://status",
            name: "status",
            mimeType: "application/json",
          },
        ],
      },
    });
    return;
  }

  if (message.method === "resources/read") {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        contents: [
          {
            uri: message.params?.uri ?? "test://status",
            mimeType: "application/json",
            text: JSON.stringify({
              pid: process.pid,
              envTag: process.env.POOL_TAG ?? null,
              extensions: clientCapabilities.extensions ?? null,
            }),
          },
        ],
      },
    });
    return;
  }

  if (message.method === "tools/call") {
    if (message.params?.name === "crash_now") {
      process.exit(1);
    }
    if (message.params?.name === "enable_dynamic_tool") {
      dynamicToolEnabled = true;
      writeMessage({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      });
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "enabled" }] },
      });
      return;
    }
    if (message.params?.name === "delayed_open_ui") {
      const delayMs = Number(message.params?.arguments?.delayMs ?? 0);
      const viewId = String(message.params?.arguments?.viewId ?? "settings");
      setTimeout(async () => {
        const uiResult = await sendServerRequest("spirit/ui/open", { viewId });
        writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(uiResult) }],
          },
        });
      }, delayMs);
      return;
    }
    callCount += 1;
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              pid: process.pid,
              callCount,
              envTag: process.env.POOL_TAG ?? null,
              extensions: clientCapabilities.extensions ?? null,
            }),
          },
        ],
      },
    });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  handle(JSON.parse(trimmed));
});
