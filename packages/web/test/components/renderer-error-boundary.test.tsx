/** @vitest-environment jsdom */

import "./setup";

import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { RendererErrorBoundary } from "@/components/renderer-error-boundary";
import { reportFatalRendererError } from "@/lib/renderer-error-reporting";

vi.mock("@/lib/renderer-error-reporting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/renderer-error-reporting")>()),
  reportFatalRendererError: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function BrokenComponent(): never {
  throw new Error("render exploded");
}

test("reports fatal production render errors with the component stack and keeps diagnostics visible", () => {
  vi.stubEnv("PROD", true);
  vi.spyOn(console, "error").mockImplementation(() => {});

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
});

test("keeps development render errors in the document for HMR recovery", () => {
  vi.stubEnv("PROD", false);
  vi.spyOn(console, "error").mockImplementation(() => {});

  render(
    <RendererErrorBoundary>
      <BrokenComponent />
    </RendererErrorBoundary>,
  );

  expect(screen.getByRole("alert").textContent).toContain("render exploded");
  expect(vi.mocked(reportFatalRendererError)).not.toHaveBeenCalled();
});
