/** @vitest-environment jsdom */

import "./setup";

import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { MarketplaceContributionGroups } from "@/components/marketplace-contribution-groups";

describe("MarketplaceContributionGroups", () => {
  test("resolved skills render their names and descriptions", () => {
    const { getByText, queryByText } = render(
      <MarketplaceContributionGroups
        item={{
          instructionContributions: {
            skills: [{ name: "hello-loopback", description: "Demo skill." }],
          },
        }}
      />,
    );
    expect(getByText("Skills")).toBeTruthy();
    expect(getByText("Hello Loopback")).toBeTruthy();
    expect(getByText("Demo skill.")).toBeTruthy();
    expect(queryByText("Declared in the Marketplace Index")).toBeNull();
  });

  test("declared-but-unresolved capabilities render a muted placeholder row", () => {
    // An http-index entry before install: the marketplace index declares the
    // capability, but the package files are not locally readable.
    const { getByText } = render(
      <MarketplaceContributionGroups item={{ requestedCapabilities: ["skills"] }} />,
    );
    expect(getByText("Skills")).toBeTruthy();
    const placeholder = getByText("Declared in the Marketplace Index");
    expect(placeholder.className).toContain("text-muted-foreground");
  });

  test("resolved contributions win over the declaration placeholder", () => {
    const { getByText, queryByText } = render(
      <MarketplaceContributionGroups
        item={{
          requestedCapabilities: ["skills"],
          instructionContributions: {
            skills: [{ name: "hello-loopback", description: "Demo skill." }],
          },
        }}
      />,
    );
    expect(getByText("Hello Loopback")).toBeTruthy();
    expect(queryByText("Declared in the Marketplace Index")).toBeNull();
  });

  test("contributed tools render from the inline manifest declaration", () => {
    const { getByText } = render(
      <MarketplaceContributionGroups
        item={{ contributedTools: [{ name: "read-file", description: "Read a file." }] }}
      />,
    );
    expect(getByText("Tools")).toBeTruthy();
    expect(getByText("Read File")).toBeTruthy();
    expect(getByText("Read a file.")).toBeTruthy();
  });

  test("nothing declared and nothing resolved renders nothing", () => {
    const { container } = render(<MarketplaceContributionGroups item={{}} />);
    expect(container.firstChild).toBeNull();
  });
});
