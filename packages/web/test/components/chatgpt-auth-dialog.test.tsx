/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ProviderConnectDialog } from "@/components/settings/models/provider-connect-dialog";
import type { CompleteChatGptOAuthResponse } from "@spiritagent/api/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("chatgpt preset renders Vercel-style browser OAuth modal, allows reopening auth URL, and closes on connect", async () => {
  const completion = deferred<CompleteChatGptOAuthResponse>();
  const onOpenChange = vi.fn();
  const onBeginChatGptOAuth = vi.fn().mockResolvedValue({
    sessionId: "sess-1",
    authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=abc",
  });
  const onCompleteChatGptOAuth = vi.fn().mockReturnValue(completion.promise);
  const onCancelChatGptOAuth = vi.fn().mockResolvedValue({ ok: true as const });
  const onOpenExternalUrl = vi.fn().mockResolvedValue(undefined);

  render(
    <ProviderConnectDialog
      provider="chatgpt"
      providerPresets={[{ id: "chatgpt", label: "ChatGPT" }]}
      open={true}
      onOpenChange={onOpenChange}
      busy={false}
      previewBusy={false}
      onAddModel={vi.fn().mockResolvedValue(undefined)}
      onAddProviderModels={vi.fn().mockResolvedValue(undefined)}
      onPreviewModels={vi.fn().mockResolvedValue({ modelIds: [], fromCache: false })}
      onBeginChatGptOAuth={onBeginChatGptOAuth}
      onCompleteChatGptOAuth={onCompleteChatGptOAuth}
      onCancelChatGptOAuth={onCancelChatGptOAuth}
      onOpenExternalUrl={onOpenExternalUrl}
    />,
  );

  expect(screen.getByRole("dialog", { name: "Connect ChatGPT" })).toBeTruthy();

  await waitFor(() => {
    expect(screen.getByText("Waiting for browser authorization")).toBeTruthy();
  });

  const reopenButton = screen.getByRole("button", { name: "Open ChatGPT Authorization Page" });
  fireEvent.click(reopenButton);
  expect(onOpenExternalUrl).toHaveBeenCalledWith(
    "https://auth.openai.com/api/accounts/authorize?state=abc",
  );

  completion.resolve({
    phase: "connected",
    email: "user@example.test",
    modelCount: 2,
    snapshot: {} as never,
  });

  await waitFor(() => {
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

test("chatgpt OAuth dialog shows localized error and requests consent on retry after missing plan scope", async () => {
  const onBeginChatGptOAuth = vi
    .fn()
    .mockResolvedValueOnce({
      sessionId: "sess-1",
      authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=1",
    })
    .mockResolvedValueOnce({
      sessionId: "sess-2",
      authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=2",
    });
  const secondCompletion = deferred<CompleteChatGptOAuthResponse>();
  const onCompleteChatGptOAuth = vi
    .fn()
    .mockResolvedValueOnce({
      phase: "error",
      code: "chatpass_v2_scope_not_authorized",
      message: "Missing scope",
    })
    .mockReturnValueOnce(secondCompletion.promise);
  const onCancelChatGptOAuth = vi.fn().mockResolvedValue({ ok: true as const });
  const onOpenChange = vi.fn();

  render(
    <ProviderConnectDialog
      provider="chatgpt"
      providerPresets={[{ id: "chatgpt", label: "ChatGPT" }]}
      open={true}
      onOpenChange={onOpenChange}
      busy={false}
      previewBusy={false}
      onAddModel={vi.fn().mockResolvedValue(undefined)}
      onAddProviderModels={vi.fn().mockResolvedValue(undefined)}
      onPreviewModels={vi.fn().mockResolvedValue({ modelIds: [], fromCache: false })}
      onBeginChatGptOAuth={onBeginChatGptOAuth}
      onCompleteChatGptOAuth={onCompleteChatGptOAuth}
      onCancelChatGptOAuth={onCancelChatGptOAuth}
      onOpenExternalUrl={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).toContain(
      "ChatGPT plan usage permission was not granted",
    );
  });

  fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
  await waitFor(() => {
    expect(onBeginChatGptOAuth).toHaveBeenNthCalledWith(2, {
      providerId: "chatgpt",
      promptConsent: true,
    });
  });

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancelChatGptOAuth).toHaveBeenCalledWith({ sessionId: "sess-2" });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
