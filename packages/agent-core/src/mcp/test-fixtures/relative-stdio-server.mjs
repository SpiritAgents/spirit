import { createInterface } from "node:readline";

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(message) {
  if (message.method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "relative-stdio-fixture", version: "0.0.0" },
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
            name: "ping",
            description: "Fixture tool used to verify stdio MCP discovery.",
            inputSchema: { type: "object", additionalProperties: false },
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
  void handle(JSON.parse(trimmed));
});
