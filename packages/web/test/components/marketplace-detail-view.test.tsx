/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { MarketplaceDetailView } from "@/components/marketplace-detail-view";
import type { DesktopMarketplaceCatalogEntry } from "@/types";

const item = {
  id: "personal/demo",
  displayName: "Demo",
  version: "1.0.0",
  description: "Demo extension",
  reviewStatus: "verified",
  installed: false,
} as DesktopMarketplaceCatalogEntry;

function renderDetail(onBack: () => void) {
  return render(
    <MarketplaceDetailView
      item={item}
      onBack={onBack}
      onInstall={() => {}}
      onUpdate={() => {}}
      onToggleEnabled={() => {}}
      onRequestUninstall={() => {}}
    />,
  );
}

test("Escape returns from the marketplace detail", () => {
  const onBack = vi.fn();
  renderDetail(onBack);

  fireEvent.keyDown(document.body, { key: "Escape" });

  expect(onBack).toHaveBeenCalledTimes(1);
});

test("Escape keeps its editable-field behavior", () => {
  const onBack = vi.fn();
  const { getByRole } = render(
    <>
      <input aria-label="Editable" />
      <MarketplaceDetailView
        item={item}
        onBack={onBack}
        onInstall={() => {}}
        onUpdate={() => {}}
        onToggleEnabled={() => {}}
        onRequestUninstall={() => {}}
      />
    </>,
  );

  fireEvent.keyDown(getByRole("textbox", { name: "Editable" }), { key: "Escape" });

  expect(onBack).not.toHaveBeenCalled();
});

test("Escape does not navigate behind an open dialog", () => {
  const onBack = vi.fn();
  const { getByTestId } = render(
    <>
      <div data-testid="open-dialog" data-slot="dialog-content" data-open />
      <MarketplaceDetailView
        item={item}
        onBack={onBack}
        onInstall={() => {}}
        onUpdate={() => {}}
        onToggleEnabled={() => {}}
        onRequestUninstall={() => {}}
      />
    </>,
  );

  fireEvent.keyDown(getByTestId("open-dialog"), { key: "Escape" });

  expect(onBack).not.toHaveBeenCalled();
});
