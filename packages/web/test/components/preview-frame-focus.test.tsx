/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { FileContentPreviewFrame } from "@/components/file-content-preview-frame";
import { FileDiffPreviewFrame } from "@/components/file-diff-preview-frame";

test("content preview header keeps rounded focus geometry in both collapse states", () => {
  render(
    <FileContentPreviewFrame relativePath="docs/example.md" languageId="markdown" content="a" />,
  );
  const trigger = screen.getByTitle("docs/example.md");
  expect(trigger.className).toContain("rounded-md");
  expect(trigger.className).toContain("aria-expanded:rounded-b-none");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("diff preview header uses the same rounded focus geometry", () => {
  render(
    <FileDiffPreviewFrame
      relativePath="docs/example.md"
      languageId="markdown"
      original="a"
      modified="b"
      defaultOpen={false}
    />,
  );
  const trigger = screen.getByTitle("docs/example.md");
  expect(trigger.className).toContain("rounded-md");
  expect(trigger.className).toContain("aria-expanded:rounded-b-none");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});
