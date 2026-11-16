/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { MarketplaceInformationSection } from "@/components/marketplace-information-section";
import type { DesktopMarketplaceCatalogEntry } from "@/types";

function makeItem(email?: string): DesktopMarketplaceCatalogEntry {
  return {
    version: "1.0.0",
    homepage: "https://example.com/",
    author: { name: "Alice", email },
  } as DesktopMarketplaceCatalogEntry;
}

afterEach(() => {
  Reflect.deleteProperty(window, "spiritDesktop");
});

test("renders Contact after Website and opens each destination through its own bridge", () => {
  const openBrowserUrl = vi.fn();
  const openEmailComposer = vi.fn();
  Object.defineProperty(window, "spiritDesktop", {
    configurable: true,
    value: { openBrowserUrl, openEmailComposer },
  });

  const { getByRole, getByText } = render(
    <MarketplaceInformationSection item={makeItem("  alice+tag@example.com  ")} />,
  );
  const section = getByRole("region", { name: "Information" });
  const labels = within(section)
    .getAllByText(/^(Author|Version|Website|Contact)$/)
    .map((element) => element.textContent);
  expect(labels).toEqual(["Author", "Version", "Website", "Contact"]);

  fireEvent.click(getByRole("button", { name: "example.com" }));
  expect(openBrowserUrl).toHaveBeenCalledWith("https://example.com/");
  expect(openEmailComposer).not.toHaveBeenCalled();

  fireEvent.click(getByRole("button", { name: "alice+tag@example.com" }));
  expect(openEmailComposer).toHaveBeenCalledWith("alice+tag@example.com");
  expect(getByText("Contact")).toBeTruthy();
});

test("omits Contact when the author email is blank", () => {
  const { queryByText } = render(<MarketplaceInformationSection item={makeItem("   ")} />);

  expect(queryByText("Contact")).toBeNull();
});
