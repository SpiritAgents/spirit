/** @vitest-environment jsdom */

import "./setup";

import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ProviderPickerRowButton } from "@/components/settings/models/provider-picker-rows";

test("provider picker rows use a fixed sparkle icon for every provider", () => {
  const { container } = render(
    <>
      <ProviderPickerRowButton row={{ id: "provider-a", label: "Provider A" }} onSelect={vi.fn()} />
      <ProviderPickerRowButton row={{ id: "provider-b", label: "Provider B" }} onSelect={vi.fn()} />
    </>,
  );

  const icons = container.querySelectorAll("button svg.lucide-sparkles");
  expect(icons).toHaveLength(2);
  for (const icon of icons) {
    expect(icon.getAttribute("class")).toContain("size-4");
    expect(icon.getAttribute("class")).toContain("shrink-0");
  }
});
