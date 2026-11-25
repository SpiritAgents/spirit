/** @vitest-environment jsdom */

import "./setup";

import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AgentMarkdownMessage } from "@/components/agent-markdown-message";
import { AgentLinkPreviewProvider } from "@/components/agent-link-preview-context";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedDark: false }),
}));

function animatedSpans(block: Element) {
  const spans: { element: Element; offset: number; duration: string }[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    const element = text.parentElement?.closest("[data-sd-animate]");
    if (element) {
      spans.push({
        element,
        offset,
        duration: (element as HTMLElement).style.getPropertyValue("--sd-duration"),
      });
    }
    offset += text.data.length;
  }
  return spans;
}

test("streaming Markdown preserves old blocks and animates only newly appended characters", async () => {
  const firstBlock = "First paragraph should remain stable.";
  const secondBlock = "Second paragraph";
  const initialContent = `${firstBlock}\n\n${secondBlock}`;
  const { container, rerender } = render(
    <TooltipProvider>
      <AgentMarkdownMessage content={initialContent} streaming />
    </TooltipProvider>,
  );

  await waitFor(() => {
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll("[data-sd-animate]").length).toBeGreaterThan(0);
  });
  const initialParagraphs = container.querySelectorAll("p");
  const initialFirstTailSpan = animatedSpans(initialParagraphs[1]!)[0]?.element;

  const secondAppend = " starts";
  rerender(
    <TooltipProvider>
      <AgentMarkdownMessage content={`${initialContent}${secondAppend}`} streaming />
    </TooltipProvider>,
  );
  await waitFor(() => expect(container.textContent).toContain("Second paragraph starts"));

  const paragraphsAfterAppend = container.querySelectorAll("p");
  expect(paragraphsAfterAppend[0]).toBe(initialParagraphs[0]);
  expect(paragraphsAfterAppend[1]).toBe(initialParagraphs[1]);
  expect(paragraphsAfterAppend[0]!.querySelector("[data-sd-animate]")).toBeNull();
  const secondSpans = animatedSpans(paragraphsAfterAppend[1]!);
  expect(secondSpans[0]?.element).toBe(initialFirstTailSpan);
  for (const span of secondSpans) {
    expect(span.duration).toBe(span.offset < secondBlock.length ? "0ms" : "160ms");
  }
  expect(secondSpans.some((span) => span.offset >= secondBlock.length)).toBe(true);

  const thirdBlock = "Third paragraph";
  const withThirdBlock = `${initialContent}${secondAppend}\n\n${thirdBlock}`;
  rerender(
    <TooltipProvider>
      <AgentMarkdownMessage content={withThirdBlock} streaming />
    </TooltipProvider>,
  );
  await waitFor(() => expect(container.querySelectorAll("p")).toHaveLength(3));
  const paragraphsWithThird = container.querySelectorAll("p");
  expect(paragraphsWithThird[0]).toBe(initialParagraphs[0]);
  expect(paragraphsWithThird[1]).toBe(initialParagraphs[1]);
  for (const span of animatedSpans(paragraphsWithThird[2]!)) {
    expect(span.duration).toBe("160ms");
  }

  rerender(
    <TooltipProvider>
      <AgentMarkdownMessage content={`${withThirdBlock} arrives`} streaming />
    </TooltipProvider>,
  );
  await waitFor(() => expect(container.textContent).toContain("Third paragraph arrives"));
  const finalParagraphs = container.querySelectorAll("p");
  expect(finalParagraphs[0]).toBe(initialParagraphs[0]);
  expect(finalParagraphs[1]).toBe(initialParagraphs[1]);
  expect(finalParagraphs[2]).toBe(paragraphsWithThird[2]);
  for (const span of animatedSpans(finalParagraphs[2]!)) {
    expect(span.duration).toBe(span.offset < thirdBlock.length ? "0ms" : "160ms");
  }
});

test("streaming defers link preview requests until the final URL", async () => {
  const initialContent = "See https://docs.example.com";
  const fetchDocument = vi.fn(async ({ url }: { url: string }) => ({
    url,
    finalUrl: url,
    headHtml: "",
  }));
  const { rerender } = render(
    <AgentLinkPreviewProvider fetchDocument={fetchDocument}>
      <TooltipProvider>
        <AgentMarkdownMessage content={initialContent} streaming />
      </TooltipProvider>
    </AgentLinkPreviewProvider>,
  );
  await waitFor(() => expect(document.querySelector("a")).not.toBeNull());
  expect(fetchDocument).not.toHaveBeenCalled();

  rerender(
    <AgentLinkPreviewProvider fetchDocument={fetchDocument}>
      <TooltipProvider>
        <AgentMarkdownMessage content={`${initialContent}/api`} streaming />
      </TooltipProvider>
    </AgentLinkPreviewProvider>,
  );
  await waitFor(() => expect(document.querySelector("a")?.getAttribute("href")).toContain("/api"));
  expect(fetchDocument).not.toHaveBeenCalled();

  rerender(
    <AgentLinkPreviewProvider fetchDocument={fetchDocument}>
      <TooltipProvider>
        <AgentMarkdownMessage content={`${initialContent}/api/v2`} streaming={false} />
      </TooltipProvider>
    </AgentLinkPreviewProvider>,
  );
  await waitFor(() => expect(fetchDocument).toHaveBeenCalledTimes(1));
  expect(fetchDocument).toHaveBeenCalledWith({ url: "https://docs.example.com/api/v2" });
});
