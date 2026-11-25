/** @vitest-environment jsdom */

import "./setup";

import type { MouseEvent as ReactMouseEvent } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { AgentInlineLink } from "@/components/agent-inline-link";
import { AgentLinkPreviewCard } from "@/components/agent-link-preview-card";
import { AgentLinkPreviewProvider } from "@/components/agent-link-preview-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parseAgentLinkPreviewDocument } from "@/lib/agent-link-preview";

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedDark: false }),
}));

const originalHitTest = document.elementFromPoint;

beforeEach(() => {
  document.elementFromPoint = vi.fn(
    () => document.querySelector("[data-slot='tooltip-trigger']") as HTMLElement,
  );
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "mouse";
      }
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.elementFromPoint = originalHitTest;
});

function previewDocument(headHtml: string, finalUrl = "https://spirit.dev/docs/start") {
  return { url: finalUrl, finalUrl, headHtml };
}

const fullHead = `
  <meta property="og:title" content="OG title">
  <meta property="og:description" content="OG description">
  <meta property="og:image" content="/og.png">
  <link rel="icon" href="/site.svg">
`;

test("metadata uses the requested title, description, and image fallback order", () => {
  expect(parseAgentLinkPreviewDocument(previewDocument(fullHead))).toMatchObject({
    title: "OG title",
    description: "OG description",
    imageUrl: "https://spirit.dev/og.png",
  });
  expect(
    parseAgentLinkPreviewDocument(
      previewDocument(`
        <meta name="twitter:title" content="Twitter title">
        <meta name="twitter:description" content="Twitter description">
        <meta name="twitter:image" content="/twitter.png">
        <title>Document title</title>
      `),
    ),
  ).toMatchObject({ title: "Twitter title", description: "Twitter description" });
  expect(
    parseAgentLinkPreviewDocument(previewDocument('<meta name="twitter:image" content="/x.png">'))
      .imageUrl,
  ).toBeUndefined();
  expect(
    parseAgentLinkPreviewDocument(
      previewDocument(
        '<title>Document title</title><meta name="description" content="Meta description">',
      ),
    ),
  ).toMatchObject({ title: "Document title", description: "Meta description" });
});

test("the whole preview card navigates and a failed OG image leaves no placeholder", () => {
  const onClick = vi.fn((event: ReactMouseEvent<HTMLAnchorElement>) => event.preventDefault());
  const preview = parseAgentLinkPreviewDocument(previewDocument(fullHead));
  const { container } = render(
    <AgentLinkPreviewCard
      href="https://spirit.dev/docs/start?from=agent"
      preview={preview}
      resolvedDark={false}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
    />,
  );
  const card = container.querySelector("[data-agent-link-preview-card]")!;
  expect(card.getAttribute("href")).toBe("https://spirit.dev/docs/start?from=agent");
  expect(card.getAttribute("target")).toBe("_blank");
  expect(card.getAttribute("rel")).toBe("noopener noreferrer");
  expect(card.textContent).toContain("OG title");
  expect(card.textContent).toContain("OG description");
  expect(card.textContent).toContain("spirit.dev");
  expect(card.textContent).not.toContain("/docs/start");
  expect(card.className).toContain("transition-none");
  expect(card.className).toContain("hover:brightness-[0.96]");
  expect(card.className).toContain("dark:hover:brightness-[0.92]");
  expect(container.querySelector("button")).toBeNull();

  fireEvent.click(screen.getByText("OG title"));
  expect(onClick).toHaveBeenCalledTimes(1);
  const image = container.querySelector("[data-agent-link-og-image]")!;
  expect(image.className).toContain("h-auto");
  expect(image.className).toContain("w-full");
  fireEvent.error(image);
  expect(container.querySelector("[data-agent-link-og-image]")).toBeNull();
});

test("missing metadata renders only the domain footer with a currentColor fallback", () => {
  const { container } = render(
    <AgentLinkPreviewCard href="https://spirit.dev/docs" preview={null} resolvedDark={false} />,
  );
  const card = container.querySelector("[data-agent-link-preview-card]")!;
  expect(card.textContent).toBe("spirit.dev");
  expect(container.querySelector("[data-agent-link-og-image]")).toBeNull();
  const globe = container.querySelector("[data-agent-link-favicon='fallback']")!;
  expect(globe.getAttribute("stroke")).toBe("currentColor");
  expect(globe.parentElement?.className).not.toContain("text-foreground");
  expect(container.querySelector("[data-agent-link-preview-footer]")?.className).toContain(
    "text-muted-foreground",
  );
});

test("hovering an agent link opens the complete interactive tooltip", async () => {
  vi.useFakeTimers();
  const onClick = vi.fn((event: ReactMouseEvent<HTMLAnchorElement>) => event.preventDefault());
  const fetchDocument = vi.fn(async () => previewDocument(fullHead));
  render(
    <TooltipProvider>
      <AgentLinkPreviewProvider fetchDocument={fetchDocument}>
        <p>
          <AgentInlineLink
            href="https://spirit.dev/docs/start"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClick}
          >
            https://spirit.dev/docs/start
          </AgentInlineLink>
        </p>
      </AgentLinkPreviewProvider>
    </TooltipProvider>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const trigger = screen.getByRole("link", { name: "https://spirit.dev/docs/start" });
  expect(trigger.parentElement?.tagName).toBe("P");
  fireEvent.pointerMove(trigger, { pointerType: "mouse", clientX: 20, clientY: 20 });
  fireEvent.pointerOver(trigger, { pointerType: "mouse", clientX: 20, clientY: 20 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

  const tooltip = screen.getByRole("tooltip");
  expect(tooltip.className).toContain("w-80");
  expect(tooltip.className).toContain("p-0");
  expect(tooltip.textContent).toContain("OG title");
  expect(tooltip.textContent).toContain("OG description");
  expect(tooltip.textContent).toContain("spirit.dev");
  expect(tooltip.querySelector("[data-agent-link-og-image]")).not.toBeNull();
  expect(tooltip.querySelector("button")).toBeNull();
  fireEvent.click(tooltip.querySelector("[data-agent-link-preview-card]")!);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("switching to a loading link never renders the previous site's preview", async () => {
  vi.useFakeTimers();
  let resolveAnthropic: ((document: ReturnType<typeof previewDocument>) => void) | undefined;
  const anthropicDocument = new Promise<ReturnType<typeof previewDocument>>((resolve) => {
    resolveAnthropic = resolve;
  });
  const openAiDocument = previewDocument(
    '<meta property="og:title" content="OpenAI title"><meta property="og:image" content="/openai.png">',
    "https://openai.com/",
  );
  const fetchDocument = vi.fn(({ url }: { url: string }) => {
    if (url === "https://openai.com/") return Promise.resolve(openAiDocument);
    if (url === "https://anthropic.com/") return anthropicDocument;
    throw new Error(`Unexpected URL: ${url}`);
  });
  render(
    <TooltipProvider>
      <AgentLinkPreviewProvider fetchDocument={fetchDocument}>
        <AgentInlineLink href="https://openai.com/">https://openai.com/</AgentInlineLink>
        <AgentInlineLink href="https://anthropic.com/">https://anthropic.com/</AgentInlineLink>
      </AgentLinkPreviewProvider>
    </TooltipProvider>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const openAiTrigger = screen.getByRole("link", { name: "https://openai.com/" });
  const anthropicTrigger = screen.getByRole("link", { name: "https://anthropic.com/" });
  document.elementFromPoint = vi.fn((x: number) => (x < 30 ? openAiTrigger : anthropicTrigger));

  fireEvent.pointerMove(openAiTrigger, { pointerType: "mouse", clientX: 20, clientY: 20 });
  fireEvent.pointerOver(openAiTrigger, { pointerType: "mouse", clientX: 20, clientY: 20 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(screen.getByRole("tooltip").textContent).toContain("OpenAI title");

  fireEvent.pointerMove(anthropicTrigger, { pointerType: "mouse", clientX: 40, clientY: 20 });
  fireEvent.pointerOver(anthropicTrigger, { pointerType: "mouse", clientX: 40, clientY: 20 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const loadingTooltip = screen.getByRole("tooltip");
  expect(loadingTooltip.textContent).toContain("anthropic.com");
  expect(loadingTooltip.textContent).not.toContain("OpenAI title");
  expect(loadingTooltip.querySelector("[data-agent-link-og-image]")).toBeNull();

  resolveAnthropic?.(
    previewDocument(
      '<meta property="og:title" content="Anthropic title"><meta property="og:image" content="/anthropic.png">',
      "https://anthropic.com/",
    ),
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByRole("tooltip").textContent).toContain("Anthropic title");
  expect(screen.getByRole("tooltip").textContent).not.toContain("OpenAI title");
  expect(screen.getByRole("tooltip").querySelector("[data-agent-link-og-image]")).not.toBeNull();
});
