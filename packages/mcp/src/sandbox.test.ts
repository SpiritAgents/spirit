import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  buildMcpAppInnerCsp,
  buildMcpAppSandboxOuterCsp,
  buildMcpAppSandboxProxyHtml,
  sanitizeMcpAppCspSource,
} from "./sandbox.js";

describe("MCP Apps sandbox proxy and CSP builder", () => {
  it("sanitizes CSP sources and rejects wildcards, non-https non-loopback, and injection attempts", () => {
    assert.equal(sanitizeMcpAppCspSource("https://api.example.com/v1"), "https://api.example.com");
    assert.equal(sanitizeMcpAppCspSource("http://127.0.0.1:8080/foo"), "http://127.0.0.1:8080");
    assert.equal(sanitizeMcpAppCspSource("http://localhost:3000"), "http://localhost:3000");

    assert.equal(sanitizeMcpAppCspSource("*"), undefined);
    assert.equal(sanitizeMcpAppCspSource("https://*.example.com"), undefined);
    assert.equal(sanitizeMcpAppCspSource("http://evil.example.com"), undefined);
    assert.equal(sanitizeMcpAppCspSource("javascript:alert(1)"), undefined);
    assert.equal(sanitizeMcpAppCspSource("https://ok.example; script-src *"), undefined);
  });

  it("defaults inner CSP to connect-src 'none' and merges valid declared domains", () => {
    const strictDefault = buildMcpAppInnerCsp();
    assert.ok(strictDefault.includes("default-src 'none'"));
    assert.ok(strictDefault.includes("connect-src 'none'"));
    assert.ok(strictDefault.includes("frame-src 'none'"));
    assert.ok(strictDefault.includes("object-src 'none'"));

    const expanded = buildMcpAppInnerCsp({
      connectDomains: ["https://api.example.com", "http://evil.example"],
      resourceDomains: ["https://cdn.example.com"],
      frameDomains: ["https://embed.example.com"],
    });
    assert.ok(expanded.includes("connect-src https://api.example.com"));
    assert.ok(!expanded.includes("evil.example"));
    assert.ok(expanded.includes("img-src data: blob: https://cdn.example.com"));
    assert.ok(expanded.includes("frame-src https://embed.example.com"));
  });

  it("generates outer CSP and sandbox proxy HTML that never grants allow-same-origin", () => {
    const outerCsp = buildMcpAppSandboxOuterCsp([
      "http://127.0.0.1:7788",
      "http://localhost:7788",
      "http://[::1]:7788",
    ]);
    assert.ok(
      outerCsp.includes(
        "frame-ancestors http://127.0.0.1:7788 http://localhost:7788 http://[::1]:7788",
      ),
    );
    assert.ok(outerCsp.includes("object-src 'none'"));
    assert.ok(outerCsp.includes("form-action 'none'"));
    // Outer CSP must not clamp inner srcdoc directives (inherited via CSP3), so per-resource
    // connectDomains/resourceDomains/blob scripts in the inner <meta> CSP remain effective.
    assert.ok(!outerCsp.includes("connect-src 'none'"));
    assert.ok(!outerCsp.includes("default-src 'none'"));

    const html = buildMcpAppSandboxProxyHtml({ allowedParentOrigins: ["http://127.0.0.1:7788"] });
    assert.ok(html.includes("ui/notifications/sandbox-proxy-ready"));
    assert.ok(html.includes("ui/notifications/sandbox-resource-ready"));
    assert.ok(html.includes('["http://127.0.0.1:7788"]'));
    assert.ok(html.includes('new Set(["allow-scripts", "allow-forms"])'));
    assert.ok(!html.includes('"allow-same-origin"'));
    assert.ok(html.includes("new DOMParser().parseFromString"));
    assert.ok(html.includes("applyOuterFrameSrcCsp"));
    assert.ok(html.includes('frame.addEventListener("load"'));
    assert.ok(!html.includes("if (!ALLOWED_PARENT_ORIGINS.length)"));

    assert.ok(buildMcpAppSandboxOuterCsp([]).includes("frame-ancestors 'none'"));
    assert.ok(buildMcpAppSandboxOuterCsp(["file:"]).includes("frame-ancestors file:"));
  });
});
