/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ModelsSettingsPanel } from "@/components/settings/models/models-settings-panel";
import { OnboardingConnectControls } from "@/components/onboarding/onboarding-connect-step";
import type { CompleteChatGptOAuthResponse } from "@spiritagent/api/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("StrictMode: clicking ChatGPT in Settings opens OAuth modal, calls begin exactly once, allows reopening URL, and closes on connect", async () => {
  const completion = deferred<CompleteChatGptOAuthResponse>();
  const onBeginChatGptOAuth = vi.fn().mockResolvedValue({
    sessionId: "sess-1",
    authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=abc",
  });
  const onCompleteChatGptOAuth = vi.fn().mockReturnValue(completion.promise);
  const onCancelChatGptOAuth = vi.fn().mockResolvedValue({ ok: true as const });
  const onOpenExternalUrl = vi.fn().mockResolvedValue(undefined);

  render(
    <StrictMode>
      <ModelsSettingsPanel
        settings={{ activeModel: { providerId: "", name: "" } } as never}
        snapshot={
          {
            config: {
              providers: [],
              models: [],
              activeModel: { providerId: "", name: "" },
              providerPickerPresets: [{ id: "chatgpt", label: "ChatGPT" }],
            },
          } as never
        }
        modelsBusy={false}
        modelsPreviewBusy={false}
        onSavePatch={vi.fn().mockResolvedValue(undefined)}
        onAddModel={vi.fn().mockResolvedValue(undefined)}
        onAddProviderModels={vi.fn().mockResolvedValue(undefined)}
        onPreviewModels={vi.fn().mockResolvedValue({ modelIds: [], fromCache: false })}
        onRemoveModel={vi.fn().mockResolvedValue(undefined)}
        onDisconnectProvider={vi.fn().mockResolvedValue(undefined)}
        onBeginChatGptOAuth={onBeginChatGptOAuth}
        onCompleteChatGptOAuth={onCompleteChatGptOAuth}
        onCancelChatGptOAuth={onCancelChatGptOAuth}
        onOpenExternalUrl={onOpenExternalUrl}
      />
    </StrictMode>,
  );

  fireEvent.click(screen.getByRole("button", { name: /Connect Provider/i }));
  fireEvent.click(await screen.findByRole("button", { name: "ChatGPT" }));

  expect(screen.getByRole("dialog", { name: "Connect ChatGPT" })).toBeTruthy();

  await waitFor(() => {
    expect(screen.getByText("Waiting for browser authorization")).toBeTruthy();
  });

  expect(onBeginChatGptOAuth).toHaveBeenCalledTimes(1);

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
    expect(screen.queryByRole("dialog", { name: "Connect ChatGPT" })).toBeNull();
  });
});

test("StrictMode: OOBE ChatGPT OAuth shows localized error, requests consent on retry, and cancels cleanly", async () => {
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

  render(
    <StrictMode>
      <OnboardingConnectControls
        modelsBusy={false}
        modelsPreviewBusy={false}
        providerPickerPresets={[{ id: "chatgpt", label: "ChatGPT" }]}
        onAddModel={vi.fn().mockResolvedValue(undefined)}
        onAddProviderModels={vi.fn().mockResolvedValue(undefined)}
        onPreviewModels={vi.fn().mockResolvedValue({ modelIds: [], fromCache: false })}
        onBeginChatGptOAuth={onBeginChatGptOAuth}
        onCompleteChatGptOAuth={onCompleteChatGptOAuth}
        onCancelChatGptOAuth={onCancelChatGptOAuth}
        onOpenExternalUrl={vi.fn().mockResolvedValue(undefined)}
      />
    </StrictMode>,
  );

  fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));

  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).toContain(
      "ChatGPT plan usage permission was not granted",
    );
  });
  expect(onBeginChatGptOAuth).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
  await waitFor(() => {
    expect(onBeginChatGptOAuth).toHaveBeenCalledTimes(2);
    expect(onBeginChatGptOAuth).toHaveBeenNthCalledWith(2, {
      providerId: "chatgpt",
      promptConsent: true,
    });
  });

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancelChatGptOAuth).toHaveBeenCalledWith({ sessionId: "sess-2" });
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Connect ChatGPT" })).toBeNull();
  });
});
