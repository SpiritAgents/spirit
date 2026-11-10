/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

// jsdom has no exit animations, so Radix unmounts closed content immediately.
// Stub the dialog shell to stay mounted and record `open`, pinning our side of
// the contract: the payload survives after visibility flips.
const dialogState = vi.hoisted(() => ({ open: undefined as boolean | undefined }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => {
    dialogState.open = open;
    return <div>{children}</div>;
  },
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooterActions: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useHostApi", () => ({
  useHostApi: () => ({ api: null, error: "", ready: true }),
}));

import { WorkspaceCapabilityTrustDialog } from "@/components/workspace-capability-trust-dialog";

const PENDING = {
  workspaceRoot: "/repo",
  contentHash: "hooks-hash",
  hashChanged: false,
  hooks: [{ event: "sessionStart", command: "hooks/x.sh", resolvedPath: "/repo/hooks/x.sh" }],
};

test("content payload survives after the dialog starts closing", () => {
  const { rerender } = render(
    <WorkspaceCapabilityTrustDialog pending={PENDING} onReply={() => {}} />,
  );
  expect(dialogState.open).toBe(true);
  expect(screen.getByText("sessionStart")).toBeTruthy();

  // The payload clears the moment the user replies; the content must keep
  // rendering through the exit animation instead of blanking out.
  rerender(<WorkspaceCapabilityTrustDialog pending={undefined} onReply={() => {}} />);
  expect(dialogState.open).toBe(false);
  expect(screen.getByText("sessionStart")).toBeTruthy();
  expect(screen.getByText("Trust workspace capabilities?")).toBeTruthy();

  // A later request still replaces the latched payload.
  rerender(
    <WorkspaceCapabilityTrustDialog
      pending={{ ...PENDING, hooks: [{ ...PENDING.hooks[0], command: "hooks/y.sh" }] }}
      onReply={() => {}}
    />,
  );
  expect(dialogState.open).toBe(true);
  expect(screen.getByText("hooks/y.sh")).toBeTruthy();
});
