/** @vitest-environment jsdom */

import "./setup";

import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { MarketplaceSourceTab } from "@/components/marketplace-source-tab";
import type { DesktopMarketplaceSource } from "@/types";

function makeSource(partial: Partial<DesktopMarketplaceSource>): DesktopMarketplaceSource {
  return {
    id: "loopback",
    name: "loopback-market",
    displayName: "Loopback Market",
    kind: "git",
    locator: "http://127.0.0.1:8765/registry.git",
    internal: false,
    ...partial,
  };
}

const noop = () => {};

describe("MarketplaceSourceTab", () => {
  test("active internal source tab keeps data-state on", () => {
    const { getByRole } = render(
      <MarketplaceSourceTab
        source={makeSource({ id: "built-in", internal: true })}
        active
        onSelect={noop}
        onRemove={noop}
      />,
    );
    expect(getByRole("button", { name: "Built-in" }).getAttribute("data-state")).toBe("on");
  });

  test("active custom source tab keeps data-state on inside its context menu", () => {
    // Regression guard: the context menu trigger must not clobber the toggle's
    // data-state through the radix Slot prop merge (the trigger's own
    // data-state="closed" would otherwise win and disable data-[state=on] styles).
    const { getByRole } = render(
      <MarketplaceSourceTab source={makeSource({})} active onSelect={noop} onRemove={noop} />,
    );
    expect(getByRole("button", { name: "Loopback Market" }).getAttribute("data-state")).toBe("on");
  });

  test("inactive custom source tab renders data-state off", () => {
    const { getByRole } = render(
      <MarketplaceSourceTab
        source={makeSource({})}
        active={false}
        onSelect={noop}
        onRemove={noop}
      />,
    );
    expect(getByRole("button", { name: "Loopback Market" }).getAttribute("data-state")).toBe("off");
  });
});
