import { afterEach, describe, expect, it } from "vitest";
import { createDesktopHttpHost, type DesktopHttpHost } from "./http-host.js";

describe("createDesktopHttpHost MCP Apps companion sandbox", () => {
  let host: DesktopHttpHost | undefined;

  afterEach(async () => {
    if (host) {
      await host.stop();
      host = undefined;
    }
  });

  it("serves cross-origin sandbox proxy on a separate loopback port and routes MCP App API endpoints", async () => {
    const invoked: Array<{ command: string; payload: unknown }> = [];
    host = createDesktopHttpHost({
      host: "127.0.0.1",
      port: 0,
      auth: {
        async requestAccess(token) {
          if (token === "test-token") {
            return {
              code: "OK",
              device: {
                id: "dev-1",
                name: "Test",
                createdAt: new Date().toISOString(),
                lastSeenAt: new Date().toISOString(),
              },
            };
          }
          return { code: "TOKEN_REQUIRED" };
        },
      },
      async invokeHostCommand(command, payload) {
        invoked.push({ command, payload });
        if (command === "bootstrap") {
          return { sessionListRevision: 7, workspaceRoot: "/tmp/ws" };
        }
        if (command === "mcpAppReadResource") {
          return {
            uri: "ui://demo/widget",
            mimeType: "text/html;profile=mcp-app",
            text: "<p>ok</p>",
          };
        }
        if (command === "mcpAppCallTool") {
          return { status: "ok", result: { content: [{ type: "text", text: "done" }] } };
        }
        if (command === "mcpAppUpdateModelContext") {
          return { ok: true };
        }
        return {};
      },
      logger: { log() {}, error() {} },
    });

    const state = await host.start();
    expect(state.running).toBe(true);
    expect(state.url).toBeDefined();
    expect(state.sandboxUrl).toBeDefined();

    const mainOrigin = new URL(state.url!).origin;
    const sandboxOrigin = new URL(state.sandboxUrl!).origin;
    expect(sandboxOrigin).not.toBe(mainOrigin);

    const sandboxRes = await fetch(state.sandboxUrl!);
    expect(sandboxRes.status).toBe(200);
    expect(sandboxRes.headers.get("content-type")).toContain("text/html");
    expect(sandboxRes.headers.get("content-security-policy")).toContain("frame-ancestors");
    expect(sandboxRes.headers.get("content-security-policy")).toContain(mainOrigin);
    expect(sandboxRes.headers.get("x-content-type-options")).toBe("nosniff");
    const sandboxHtml = await sandboxRes.text();
    expect(sandboxHtml).toContain("ui/notifications/sandbox-proxy-ready");

    const otherPathRes = await fetch(`${sandboxOrigin}/api/health`);
    expect(otherPathRes.status).toBe(404);

    const bootstrapRes = await fetch(`${state.url}/api/bootstrap`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(bootstrapRes.status).toBe(200);
    const bootstrapBody = (await bootstrapRes.json()) as {
      sessionListRevision: number;
      mcpAppSandboxUrl?: string;
    };
    expect(bootstrapBody.mcpAppSandboxUrl).toBe(state.sandboxUrl);

    const readRes = await fetch(`${state.url}/api/mcp-apps/read-resource`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ server: "demo", uri: "ui://demo/widget" }),
    });
    expect(readRes.status).toBe(200);
    expect(await readRes.json()).toMatchObject({ uri: "ui://demo/widget" });

    const callRes = await fetch(`${state.url}/api/mcp-apps/call-tool`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ server: "demo", tool: "refresh", arguments: { step: 1 } }),
    });
    expect(callRes.status).toBe(200);
    expect(await callRes.json()).toEqual({
      status: "ok",
      result: { content: [{ type: "text", text: "done" }] },
    });

    const ctxRes = await fetch(`${state.url}/api/mcp-apps/update-model-context`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ appId: "app-1", server: "demo", text: "selected: item-2" }),
    });
    expect(ctxRes.status).toBe(200);

    expect(invoked.map((item) => item.command)).toEqual([
      "bootstrap",
      "mcpAppReadResource",
      "mcpAppCallTool",
      "mcpAppUpdateModelContext",
    ]);

    await host.stop();
    host = undefined;
    await expect(fetch(state.sandboxUrl!)).rejects.toThrow();
  });
});
