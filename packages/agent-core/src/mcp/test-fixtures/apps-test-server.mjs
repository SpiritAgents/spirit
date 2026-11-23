import { createInterface } from "node:readline";

let inFlightSlowOps = 0;
let maxConcurrentSlowOps = 0;

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
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "apps-test-server", version: "1.0.0" },
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
            name: "show_dashboard",
            description: "Display an interactive dashboard",
            inputSchema: {
              type: "object",
              properties: { project: { type: "string" } },
              required: ["project"],
            },
            _meta: {
              ui: {
                resourceUri: "ui://demo/dashboard",
                visibility: ["model", "app"],
              },
            },
          },
          {
            name: "app_only_refresh",
            description: "Refresh dashboard data from the interactive UI",
            inputSchema: {
              type: "object",
              properties: { filter: { type: "string" } },
            },
            annotations: {
              readOnlyHint: true,
              openWorldHint: false,
            },
            _meta: {
              ui: {
                visibility: ["app"],
              },
            },
          },
          {
            name: "app_only_mutate",
            description: "Mutate dashboard state from the interactive UI",
            inputSchema: {
              type: "object",
              properties: { action: { type: "string" } },
            },
            annotations: {
              readOnlyHint: false,
              openWorldHint: false,
            },
            _meta: {
              ui: {
                visibility: ["app"],
              },
            },
          },
          {
            name: "model_only_helper",
            description: "Helper restricted to the model",
            inputSchema: { type: "object", properties: {} },
            _meta: {
              ui: {
                visibility: ["model"],
              },
            },
          },
          {
            name: "plain_tool",
            description: "Standard tool without UI",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "slow_app_op",
            description: "Slow app-only operation for concurrency limit testing",
            inputSchema: {
              type: "object",
              properties: { delayMs: { type: "number" } },
            },
            annotations: {
              readOnlyHint: true,
              openWorldHint: false,
            },
            _meta: {
              ui: {
                visibility: ["app"],
              },
            },
          },
        ],
      },
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
            uri: "ui://demo/dashboard",
            name: "dashboard-ui",
            mimeType: "text/html;profile=mcp-app",
            description: "Interactive dashboard HTML bundle",
          },
          {
            uri: "data://demo/readme",
            name: "readme-doc",
            mimeType: "text/plain",
            description: "Regular text resource visible to the model",
          },
        ],
      },
    });
    return;
  }

  if (message.method === "resources/read") {
    const uri = message.params?.uri;
    if (uri === "ui://demo/dashboard") {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          contents: [
            {
              uri: "ui://demo/dashboard",
              mimeType: "text/html;profile=mcp-app",
              text: "<!doctype html><html><body><h1>Demo Dashboard</h1></body></html>",
              _meta: {
                ui: {
                  csp: {
                    connectDomains: ["https://api.example.com"],
                    resourceDomains: ["https://cdn.example.com"],
                  },
                  permissions: {
                    clipboardWrite: {},
                  },
                  domain: "demo-dashboard.invalid",
                  prefersBorder: true,
                },
              },
            },
          ],
        },
      });
      return;
    }
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        contents: [
          {
            uri: uri ?? "data://demo/readme",
            mimeType: "text/plain",
            text: "Hello from plain MCP resource",
          },
        ],
      },
    });
    return;
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (name === "show_dashboard") {
      const project = String(args.project ?? "unknown");
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: `Dashboard ready for ${project}` }],
          structuredContent: {
            project,
            metrics: { openIssues: 3, passingChecks: 12 },
          },
        },
      });
      return;
    }
    if (name === "app_only_refresh") {
      const filter = String(args.filter ?? "all");
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: `refreshed:${filter}` }],
          structuredContent: { filter, count: 7 },
        },
      });
      return;
    }
    if (name === "app_only_mutate") {
      const action = String(args.action ?? "none");
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: `mutated:${action}` }],
          structuredContent: { action, mutated: true },
        },
      });
      return;
    }
    if (name === "model_only_helper") {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "model-only-ok" }] },
      });
      return;
    }
    if (name === "plain_tool") {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "plain-ok" }] },
      });
      return;
    }
    if (name === "slow_app_op") {
      inFlightSlowOps += 1;
      if (inFlightSlowOps > maxConcurrentSlowOps) {
        maxConcurrentSlowOps = inFlightSlowOps;
      }
      const delayMs = typeof args.delayMs === "number" ? args.delayMs : 60;
      setTimeout(() => {
        const snapshot = maxConcurrentSlowOps;
        inFlightSlowOps -= 1;
        writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: `max=${snapshot}` }],
            structuredContent: { maxConcurrent: snapshot },
          },
        });
      }, delayMs);
    }
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
