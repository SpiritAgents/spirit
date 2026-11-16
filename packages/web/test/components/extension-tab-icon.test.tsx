/** @vitest-environment jsdom */

import "./setup";

import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { ExtensionTabIcon } from "@/components/extension-tab-icon";

test("Spirit, packaged, and runtime icons share one render surface", () => {
  const { container, rerender } = render(
    <ExtensionTabIcon extensionId="personal/demo" icon={{ type: "spirit", name: "globe" }} />,
  );
  expect(container.querySelector("svg.spirit-icon-globe")).toBeTruthy();

  rerender(
    <ExtensionTabIcon
      extensionId="personal/demo"
      icon={{ type: "file", path: "assets/icon.svg" }}
    />,
  );
  const packaged = container.querySelector("img");
  expect(packaged?.getAttribute("src")).toBe(
    "spirit://extension-ui/tab-icon/personal%2Fdemo/assets/icon.svg",
  );
  expect(container.querySelector("svg")).toBeNull();

  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  rerender(<ExtensionTabIcon extensionId="personal/demo" icon={{ type: "image", dataUrl }} />);
  expect(container.querySelector("img")?.getAttribute("src")).toBe(dataUrl);
});

test("monochrome packaged icons inherit native tab color instead of baking in a theme", () => {
  const { container } = render(
    <ExtensionTabIcon
      extensionId="personal/demo"
      icon={{ type: "file", path: "icons/notes.svg", monochrome: true }}
      className="size-4"
    />,
  );
  const icon = container.querySelector("span")!;
  expect(icon.style.backgroundColor).toBe("currentcolor");
  expect(icon.style.maskImage).toContain("icons/notes.svg");
  expect(container.querySelector("img")).toBeNull();
});
