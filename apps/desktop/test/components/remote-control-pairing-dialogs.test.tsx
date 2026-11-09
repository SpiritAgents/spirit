/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { RemoteControlPairingDialogs } from "@/components/settings/panels/remote-control-pairing-dialogs";

const enrollment = {
  pairingId: "pending-1",
  token: "fake-token",
  url: "http://127.0.0.1:7788/?token=fake-token",
  qrCodeSvg: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
};
const pending = {
  id: "pending-1",
  origin: "http://127.0.0.1:7788",
  ownerClientId: "desktop-test",
  createdAt: "2026-01-02T03:04:05.000Z",
  request: {
    requestedAt: "2026-01-02T03:04:05.000Z",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    ip: "127.0.0.1",
  },
};

test("introducing stays informational until Continue", () => {
  const onContinue = vi.fn();
  render(
    <RemoteControlPairingDialogs
      stage="intro"
      enrollment={null}
      pending={undefined}
      busy={false}
      onDismissIntro={() => {}}
      onContinue={onContinue}
      onCancel={() => {}}
      onApprove={() => {}}
      onReject={() => {}}
    />,
  );
  expect(screen.getByText("Pair Spirit Remote Control")).toBeTruthy();
  expect(screen.getByText("Collaborate Anywhere")).toBeTruthy();
  expect(screen.getByText("Control Access")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

test("shows a separate approval dialog over the QR pairing dialog", () => {
  const onReject = vi.fn();
  render(
    <RemoteControlPairingDialogs
      stage="qr"
      enrollment={enrollment}
      pending={pending}
      busy={false}
      onDismissIntro={() => {}}
      onContinue={() => {}}
      onCancel={() => {}}
      onApprove={() => {}}
      onReject={onReject}
    />,
  );
  expect(screen.getByText("Scan the QR Code or Enter the URL to Pair This Device")).toBeTruthy();
  expect(screen.getByText("Allow Edge on Mac to control your Spirit?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  expect(onReject).toHaveBeenCalledWith("pending-1");
});

test("temporarily switches the enrollment copy icon to a checkmark", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(
    <RemoteControlPairingDialogs
      stage="qr"
      enrollment={enrollment}
      pending={undefined}
      busy={false}
      onDismissIntro={() => {}}
      onContinue={() => {}}
      onCancel={() => {}}
      onApprove={() => {}}
      onReject={() => {}}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy Pairing URL" }));
  });
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
  expect(writeText).toHaveBeenCalledWith(enrollment.url);
  await act(async () => {
    vi.advanceTimersByTime(1500);
  });
  expect(screen.getByRole("button", { name: "Copy Pairing URL" })).toBeTruthy();
  vi.useRealTimers();
});
