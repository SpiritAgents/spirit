/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { MarketplaceInstalledExtensionActions } from "@/components/marketplace-installed-extension-actions";
import type { DesktopExtensionAuthorization, DesktopMarketplaceCatalogEntry } from "@/types";

function renderActions(authorization: DesktopExtensionAuthorization) {
  const item = {
    id: "personal/demo",
    enabled: true,
    installed: true,
    authorizations: [authorization],
  } as DesktopMarketplaceCatalogEntry;
  const onAuthorize = vi.fn();
  const onToggleEnabled = vi.fn();
  const onRequestUninstall = vi.fn();
  const view = render(
    <MarketplaceInstalledExtensionActions
      item={item}
      authorizationVariant="outline"
      onAuthorize={onAuthorize}
      onToggleEnabled={onToggleEnabled}
      onRequestUninstall={onRequestUninstall}
    />,
  );
  return { item, onAuthorize, onToggleEnabled, onRequestUninstall, ...view };
}

describe("MarketplaceInstalledExtensionActions", () => {
  test("an unconfigured authorization stays in the primary action position", () => {
    const authorization = {
      id: "oauth",
      displayName: "OAuth",
      action: "authorize",
      configured: false,
    };
    const { item, onAuthorize, getByRole, queryByRole } = renderActions(authorization);

    const button = getByRole("button", { name: "Authorize" });
    expect(button.getAttribute("data-authorization-configured")).toBe("false");
    expect(button.querySelector("svg.lucide-shield-check")).toBeTruthy();
    fireEvent.click(button);
    expect(onAuthorize).toHaveBeenCalledWith(item, authorization);

    fireEvent.pointerDown(getByRole("button", { name: "More Actions" }), { button: 0 });
    expect(queryByRole("menuitem", { name: "Authorization Options" })).toBeNull();
  });

  test("a configured authorization moves to the overflow menu", () => {
    const authorization = {
      id: "oauth",
      displayName: "OAuth",
      action: "authorize",
      configured: true,
    };
    const { item, onAuthorize, getByRole, queryByRole } = renderActions(authorization);

    expect(queryByRole("button", { name: "Authorize" })).toBeNull();
    fireEvent.pointerDown(getByRole("button", { name: "More Actions" }), { button: 0 });
    const options = getByRole("menuitem", { name: "Authorization Options" });
    expect(options.querySelector("svg.lucide-shield-check")).toBeTruthy();
    fireEvent.click(options);
    expect(onAuthorize).toHaveBeenCalledWith(item, authorization);
  });

  test("multiple configured authorizations include their contribution names", () => {
    const item = {
      id: "personal/demo",
      enabled: true,
      installed: true,
      authorizations: [
        { id: "oauth", displayName: "OAuth", action: "authorize", configured: true },
        { id: "devops", displayName: "DevOps", action: "manage", configured: true },
      ],
    } as DesktopMarketplaceCatalogEntry;
    const { getByRole } = render(
      <MarketplaceInstalledExtensionActions
        item={item}
        authorizationVariant="outline"
        onAuthorize={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRequestUninstall={vi.fn()}
      />,
    );

    fireEvent.pointerDown(getByRole("button", { name: "More Actions" }), { button: 0 });
    expect(getByRole("menuitem", { name: "OAuth Authorization Options" })).toBeTruthy();
    expect(getByRole("menuitem", { name: "DevOps Authorization Options" })).toBeTruthy();
  });
});
