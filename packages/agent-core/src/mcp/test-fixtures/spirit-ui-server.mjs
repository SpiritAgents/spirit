import { createInterface } from "node:readline";

let nextOutboundId = 1000;
const pending = new Map();
let clientCapabilities = {};

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendRequest(method, params) {
  const id = nextOutboundId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    writeMessage({ jsonrpc: "2.0", id, method, params });
  });
}

async function handle(message) {
  if (message.id !== undefined && pending.has(message.id)) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message ?? "spirit/ui/open failed"));
      return;
    }
    waiter.resolve(message.result);
    return;
  }

  if (message.method === "initialize") {
    clientCapabilities = message.params?.capabilities ?? {};
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "spirit-ui-fixture", version: "0.0.0" },
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
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "demo",
            description: "Open an owned view when the client advertises spirit/ui",
            inputSchema: {
              type: "object",
              properties: { viewId: { type: "string" } },
            },
          },
        ],
      },
    });
    return;
  }

  if (message.method === "tools/call") {
    const viewId =
      typeof message.params?.arguments?.viewId === "string"
        ? message.params.arguments.viewId
        : "own";
    if (!clientCapabilities.experimental?.["spirit/ui"]) {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: JSON.stringify({ kind: "skipped" }) }] },
      });
      return;
    }
    try {
      const ui = await sendRequest("spirit/ui/open", {
        viewId,
        params: message.params?.arguments ?? {},
      });
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: JSON.stringify(ui) }] },
      });
    } catch (error) {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: `error:${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        },
      });
    }
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  void handle(JSON.parse(trimmed));
});
