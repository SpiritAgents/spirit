/** @vitest-environment jsdom */

import "./setup";

import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { ConversationNavPlaceholder } from "@/components/conversation/conversation-nav-placeholder";

test("nav placeholder renders the shared delayed-fade spinner", () => {
  const { container } = render(<ConversationNavPlaceholder />);
  const root = container.querySelector("[data-spirit-surface='conversation-nav-placeholder']");
  expect(root).not.toBeNull();
  const spinner = container.querySelector("[data-slot='spinner']");
  expect(spinner).not.toBeNull();
  expect(spinner?.classList.contains("animate-spin")).toBe(true);
  expect(spinner?.classList.contains("spirit-nav-placeholder-fade")).toBe(true);
  expect(spinner?.getAttribute("stroke-width")).toBe("1.75");
});
