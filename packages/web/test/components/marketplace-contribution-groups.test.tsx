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
            skills: [
              { name: "hello-loopback", displayName: "Hello Loopback", summary: "Demo skill." },
            ],
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
            skills: [
              { name: "hello-loopback", displayName: "Hello Loopback", summary: "Demo skill." },
            ],
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
        item={{
          contributedTools: [
            { name: "read-file", displayName: "Read File", summary: "Read a file." },
          ],
        }}
      />,
    );
    expect(getByText("Tools")).toBeTruthy();
    expect(getByText("Read File")).toBeTruthy();
    expect(getByText("Read a file.")).toBeTruthy();
  });

  test("desktop views render in the Desktop contribution group", () => {
    const { getByText } = render(
      <MarketplaceContributionGroups
        item={{ desktopViews: [{ id: "enable", path: "ui/enable.html" }] }}
      />,
    );
    expect(getByText("Desktop")).toBeTruthy();
    expect(getByText("Views")).toBeTruthy();
  });

  test("desktop tabs render each declared name and icon", () => {
    const { container, getByText } = render(
      <MarketplaceContributionGroups
        item={{
          id: "personal/demo",
          desktopTabs: [
            {
              id: "notes",
              name: "Workspace Notes",
              path: "notes.html",
              icon: { type: "spirit", name: "globe" },
              defaultScope: "workspace",
            },
            {
              id: "preview",
              name: "Preview",
              path: "preview.html",
              icon: { type: "file", path: "assets/preview.svg" },
              defaultScope: "window-shared",
            },
          ],
        }}
      />,
    );
    expect(getByText("Workspace Notes")).toBeTruthy();
    expect(getByText("Preview")).toBeTruthy();
    const spiritIcon = container.querySelector("svg.spirit-icon-globe");
    expect(spiritIcon).toBeTruthy();
    expect(spiritIcon?.classList.contains("text-foreground")).toBe(true);
    expect(spiritIcon?.classList.contains("text-muted-foreground")).toBe(false);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "spirit://extension-ui/tab-icon/personal%2Fdemo/assets/preview.svg",
    );
    expect(container.querySelector("img")?.classList.contains("text-muted-foreground")).toBe(false);
    expect(container.querySelector("img")?.classList.contains("text-foreground")).toBe(true);
  });

  test("nothing declared and nothing resolved renders nothing", () => {
    const { container } = render(<MarketplaceContributionGroups item={{}} />);
    expect(container.firstChild).toBeNull();
  });

  test("capability rows sit on the page without a card surface", () => {
    const { container, getByText } = render(
      <MarketplaceContributionGroups
        item={{
          instructionContributions: {
            skills: [
              { name: "hello-loopback", displayName: "Hello Loopback", summary: "Demo skill." },
            ],
          },
        }}
      />,
    );
    expect(getByText("Hello Loopback")).toBeTruthy();
    expect(container.querySelector(".rounded-lg")).toBeNull();
    expect(container.querySelector(".divide-y")).toBeNull();
  });
});

test("authorizations render explicit names without runtime configuration state", () => {
  const { getByText, queryByText } = render(
    <MarketplaceContributionGroups
      item={{
        authorizations: [
          { id: "oauth", displayName: "OAuth", action: "authorize", configured: true },
        ],
      }}
    />,
  );
  expect(getByText("Authorization")).toBeTruthy();
  expect(getByText("OAuth")).toBeTruthy();
  expect(queryByText("Oauth")).toBeNull();
  expect(queryByText("Configured")).toBeNull();
  expect(document.querySelector("svg.lucide-shield-check")).toBeTruthy();
  expect(
    document.querySelector("svg.lucide-shield-check")?.classList.contains("text-foreground"),
  ).toBe(true);
});

test("Automation trigger contributions render their names and descriptions", () => {
  const { getByText } = render(
    <MarketplaceContributionGroups
      item={{
        automationTriggers: [
          {
            kind: "extension:personal/demo/activity",
            extensionId: "personal/demo",
            contributionId: "activity",
            name: "Repository Activity",
            description: "React to new repository activity.",
            configuration: "menu",
            inputSchema: { type: "object" },
            icon: { type: "spirit", name: "globe" },
          },
        ],
      }}
    />,
  );
  expect(getByText("Automation Triggers")).toBeTruthy();
  expect(getByText("Repository Activity")).toBeTruthy();
  expect(getByText("React to new repository activity.")).toBeTruthy();
});

test("monochrome file contributions use the shared theme-aware icon renderer", () => {
  const { container } = render(
    <MarketplaceContributionGroups
      item={{
        id: "personal/demo",
        desktopTabs: [
          {
            id: "notes",
            name: "Notes",
            path: "ui/notes.html",
            defaultScope: "window-shared",
            icon: { type: "file", path: "icons/notes.svg", monochrome: true },
          },
        ],
      }}
    />,
  );
  const icon = container.querySelector<HTMLElement>('[style*="mask-image"]');
  expect(icon?.style.maskImage).toContain("icons/notes.svg");
  expect(icon?.style.backgroundColor).toBe("currentcolor");
  expect(container.querySelector("img")).toBeNull();
});
