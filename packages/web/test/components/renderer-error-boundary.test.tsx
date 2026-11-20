/** @vitest-environment jsdom */

import "./setup";

import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { RendererErrorBoundary } from "@/components/renderer-error-boundary";
import { reportFatalRendererError } from "@/lib/renderer-error-reporting";

vi.mock("@/lib/renderer-error-reporting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/renderer-error-reporting")>()),
  reportFatalRendererError: vi.fn(),
}));

test("reports fatal render errors with the component stack and keeps diagnostics visible", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  function BrokenComponent(): never {
    throw new Error("render exploded");
  }

  render(
    <RendererErrorBoundary>
      <BrokenComponent />
    </RendererErrorBoundary>,
  );

  expect(screen.getByRole("alert").textContent).toContain("render exploded");
  expect(vi.mocked(reportFatalRendererError)).toHaveBeenCalledWith(
    expect.objectContaining({ message: "render exploded" }),
    expect.stringContaining("BrokenComponent"),
  );
  consoleError.mockRestore();
});
