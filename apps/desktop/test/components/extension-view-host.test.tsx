/** @vitest-environment jsdom */

import "./setup";

import { act, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ExtensionViewHost } from "@/components/extension-view-host";
import {
  closeAllOpenExtensionViews,
  openExtensionView,
} from "@/lib/extension-view-runtime";

afterEach(() => {
  closeAllOpenExtensionViews();
});

test("iframe is sandboxed to scripts only and uses the View default-export srcdoc", async () => {
  act(() => {
    void openExtensionView({
      requestId: "req-host",
      extensionId: "built-in/demo",
      viewId: "main",
      viewUrl: "spirit://extension-ui/view?extensionId=built-in%2Fdemo&viewId=main",
      title: "Demo View",
    });
  });

  await act(async () => {
    render(<ExtensionViewHost />);
  });
  const iframe = document.querySelector("iframe");
  expect(iframe).toBeTruthy();
  expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
  expect(iframe?.srcdoc).toContain("default-export function View({ params, close })");
});
