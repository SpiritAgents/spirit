/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AgentLinkFavicon } from "@/components/agent-link-favicon";
import { AgentInlineLink } from "@/components/agent-inline-link";
import { AgentLinkPreviewProvider } from "@/components/agent-link-preview-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  agentLinkIconCandidates,
  parseAgentLinkPreviewDocument,
  resolveAgentLinkAssetUrl,
} from "@/lib/agent-link-preview";

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedDark: false }),
}));

function previewDocument(headHtml: string, finalUrl = "https://spirit.dev/docs/start") {
  return { url: finalUrl, finalUrl, headHtml };
}

const themedIcons = `
  <link rel="icon" href="/light.svg" media="(prefers-color-scheme: light)">
  <link rel="icon" href="/dark.svg" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/default.svg">
  <link rel="icon" type="image/png" href="/default.png">
  <link rel="apple-touch-icon" href="/apple.png">
`;

test("icon candidates follow the app theme, SVG priority, and bitmap fallbacks", () => {
  const preview = parseAgentLinkPreviewDocument(previewDocument(themedIcons));
  expect(agentLinkIconCandidates(preview, false)).toEqual([
    "https://spirit.dev/light.svg",
    "https://spirit.dev/default.svg",
    "https://spirit.dev/default.png",
    "https://spirit.dev/apple.png",
    "https://spirit.dev/dark.svg",
    "https://spirit.dev/favicon.ico",
  ]);
  expect(agentLinkIconCandidates(preview, true)).toEqual([
    "https://spirit.dev/dark.svg",
    "https://spirit.dev/default.svg",
    "https://spirit.dev/default.png",
    "https://spirit.dev/apple.png",
    "https://spirit.dev/light.svg",
    "https://spirit.dev/favicon.ico",
  ]);
});

test("preview assets reject private renderer targets before any image request", () => {
  for (const url of [
    "http://127.0.0.1/og.png",
    "http://localhost/icon.svg",
    "http://192.168.1.20/icon.png",
    "http://169.254.169.254/latest",
    "http://[fe80::1]/icon.svg",
    "http://[::ffff:127.0.0.1]/icon.svg",
    "http://metadata.internal/icon.svg",
    "http://service.home.arpa/icon.svg",
  ]) {
    expect(resolveAgentLinkAssetUrl(url, "https://spirit.dev")).toBeUndefined();
  }
  const preview = parseAgentLinkPreviewDocument(
    previewDocument(
      '<meta property="og:image" content="http://127.0.0.1/og.png"><link rel="icon" href="http://localhost/icon.svg">',
    ),
  );
  expect(preview.imageUrl).toBeUndefined();
  expect(preview.icons).toEqual([]);
  expect(agentLinkIconCandidates(preview, false)).toEqual(["https://spirit.dev/favicon.ico"]);
  expect(resolveAgentLinkAssetUrl("https://cdn.example.com/og.png", "https://spirit.dev")).toBe(
    "https://cdn.example.com/og.png",
  );
  expect(resolveAgentLinkAssetUrl("http://127.0.0.1/fixture", "https://spirit.dev", true)).toBe(
    "http://127.0.0.1/fixture",
  );
});

test("loopback preview assets are limited to the page's own origin", () => {
  const finalUrl = "http://127.0.0.1:4175/e2e/page";
  const preview = parseAgentLinkPreviewDocument(
    previewDocument(
      '<meta property="og:image" content="/og.png"><link rel="icon" href="/icon.svg">',
      finalUrl,
    ),
  );
  expect(preview.imageUrl).toBe("http://127.0.0.1:4175/og.png");
  expect(agentLinkIconCandidates(preview, false)).toEqual([
    "http://127.0.0.1:4175/icon.svg",
    "http://127.0.0.1:4175/favicon.ico",
  ]);
  expect(resolveAgentLinkAssetUrl("http://127.0.0.1:4176/other.png", finalUrl)).toBeUndefined();
  expect(resolveAgentLinkAssetUrl("http://localhost:4175/other.png", finalUrl)).toBeUndefined();
});

test("favicon loading falls back from declared SVG to origin bitmap and currentColor Globe", () => {
  const preview = parseAgentLinkPreviewDocument(
    previewDocument('<link rel="icon" type="image/svg+xml" href="/site.svg">'),
  );
  const { container } = render(<AgentLinkFavicon preview={preview} resolvedDark={false} />);
  const image = () => container.querySelector("img");
  expect(image()?.getAttribute("src")).toBe("https://spirit.dev/site.svg");
  fireEvent.error(image()!);
  expect(image()?.getAttribute("src")).toBe("https://spirit.dev/favicon.ico");
  fireEvent.error(image()!);
  expect(image()).toBeNull();
  const globe = container.querySelector("[data-agent-link-favicon='fallback']");
  expect(globe?.getAttribute("stroke")).toBe("currentColor");
});

test("bare labels preserve the full URL and streaming animation nodes", async () => {
  const fetchDocument = vi.fn(async () => previewDocument('<link rel="icon" href="/default.svg">'));
  const children = [
    <span key="protocol" data-testid="protocol" data-sd-animate>
      https://
    </span>,
    <span key="domain" data-sd-animate>
      spirit.dev
    </span>,
  ];
  render(
    <TooltipProvider>
      <AgentLinkPreviewProvider fetchDocument={fetchDocument}>
        <AgentInlineLink href="https://spirit.dev" target="_blank">
          {children}
        </AgentInlineLink>
        <AgentInlineLink href="https://spirit.dev">{children}</AgentInlineLink>
      </AgentLinkPreviewProvider>
    </TooltipProvider>,
  );

  await waitFor(() =>
    expect(document.querySelectorAll("[data-agent-link-favicon='site']")).toHaveLength(2),
  );
  expect(fetchDocument).toHaveBeenCalledTimes(1);
  const links = screen.getAllByRole("link");
  expect(links[0]!.textContent).toBe("https://spirit.dev");
  expect(links[1]!.textContent).toBe("https://spirit.dev");
  expect(screen.getAllByTestId("protocol")[0]!.textContent).toBe("https://");
  expect(document.querySelectorAll("[data-sd-animate]").length).toBeGreaterThan(0);
  expect(links[0]!.className).toContain("no-underline");
  expect(links[0]!.querySelector("span.underline")).not.toBeNull();
});

test("custom labels and non-HTTP links retain their existing content", async () => {
  const fetchDocument = vi.fn(async () => previewDocument(""));
  const { container } = render(
    <TooltipProvider>
      <AgentLinkPreviewProvider fetchDocument={fetchDocument}>
        <AgentInlineLink href="https://spirit.dev/docs">Read the documentation</AgentInlineLink>
        <AgentInlineLink href="#local">Local section</AgentInlineLink>
      </AgentLinkPreviewProvider>
    </TooltipProvider>,
  );
  expect(screen.getByRole("link", { name: "Read the documentation" }).textContent).toBe(
    "Read the documentation",
  );
  expect(screen.getByRole("link", { name: "Local section" }).textContent).toBe("Local section");
  expect(screen.getByRole("link", { name: "Local section" }).querySelector("img, svg")).toBeNull();
  await waitFor(() => expect(fetchDocument).toHaveBeenCalledTimes(1));
  expect(container.querySelectorAll("[data-agent-link-favicon]")).toHaveLength(1);
});

test("failed metadata loads are cached per URL and retain a fixed-size Globe", async () => {
  const fetchDocument = vi.fn(async () => {
    throw new Error("unavailable");
  });
  const { container, rerender } = render(
    <TooltipProvider>
      <AgentLinkPreviewProvider fetchDocument={fetchDocument}>
        <AgentInlineLink href="https://spirit.dev">https://spirit.dev</AgentInlineLink>
        <AgentInlineLink href="https://spirit.dev">https://spirit.dev</AgentInlineLink>
      </AgentLinkPreviewProvider>
    </TooltipProvider>,
  );
  await waitFor(() =>
    expect(container.querySelectorAll("[data-agent-link-favicon='fallback']")).toHaveLength(2),
  );
  expect(fetchDocument).toHaveBeenCalledTimes(1);
  rerender(
    <TooltipProvider>
      <AgentLinkPreviewProvider fetchDocument={fetchDocument}>
        <AgentInlineLink href="https://spirit.dev">https://spirit.dev</AgentInlineLink>
        <AgentInlineLink href="https://spirit.dev">https://spirit.dev</AgentInlineLink>
        <AgentInlineLink href="https://spirit.dev">https://spirit.dev</AgentInlineLink>
      </AgentLinkPreviewProvider>
    </TooltipProvider>,
  );
  await waitFor(() =>
    expect(container.querySelectorAll("[data-agent-link-favicon='fallback']")).toHaveLength(3),
  );
  expect(fetchDocument).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[data-agent-link-favicon='fallback']")?.classList).toContain(
    "size-3.5",
  );
});
