/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import { resources } from "../locales.js";
import { VercelAuthorizationView } from "./components/vercel-authorization-view.js";

const i18n = i18next.createInstance();
await i18n.init({ resources, lng: "en", fallbackLng: "en", interpolation: { escapeValue: false } });
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (children: ReactNode) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;

test("waiting for the browser shows a spinner beside normal-size status text", () => {
  const close = vi.fn();
  const openExternal = vi.fn(async () => {});
  render(
    wrap(
      <VercelAuthorizationView
        state={{ phase: "waiting", authorizationUrl: "https://vercel.com/oauth/authorize?x=1" }}
        close={close}
        openExternal={openExternal}
      />,
    ),
  );
  const status = screen.getByText("Waiting for browser authorization");
  const row = status.parentElement!;
  expect(row.classList.contains("text-sm")).toBe(true);
  expect(row.firstElementChild?.getAttribute("data-slot")).toBe("spinner");
  expect(row.lastElementChild).toBe(status);
  fireEvent.click(screen.getByRole("button", { name: "Open Vercel Authorization Page" }));
  expect(openExternal).toHaveBeenCalledWith("https://vercel.com/oauth/authorize?x=1");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledWith({ dismissed: true });
});

test("a connected account can be disconnected", () => {
  const close = vi.fn();
  render(
    wrap(
      <VercelAuthorizationView
        state={{ phase: "connected", username: "fixture-account" }}
        close={close}
        openExternal={async () => {}}
      />,
    ),
  );
  expect(screen.getByText("Connected as @fixture-account")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(close).toHaveBeenCalledWith({ disconnect: true });
});

test("a connection without an account label still reads as connected", () => {
  render(
    wrap(
      <VercelAuthorizationView
        state={{ phase: "connected" }}
        close={() => {}}
        openExternal={async () => {}}
      />,
    ),
  );
  expect(screen.getByText("Connected to Vercel")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
});

test("errors are announced and only invalid credentials offer disconnect", () => {
  const { rerender } = render(
    wrap(
      <VercelAuthorizationView
        state={{ phase: "error", message: "Vercel authorization was denied." }}
        close={() => {}}
        openExternal={async () => {}}
      />,
    ),
  );
  expect(screen.getByRole("alert").textContent).toBe("Vercel authorization was denied.");
  expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  rerender(
    wrap(
      <VercelAuthorizationView
        state={{ phase: "error", message: "Stored authorization is invalid.", canDisconnect: true }}
        close={() => {}}
        openExternal={async () => {}}
      />,
    ),
  );
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
});

test("the view follows the page locale", async () => {
  await act(() => i18n.changeLanguage("zh-CN"));
  render(
    wrap(
      <VercelAuthorizationView
        state={{ phase: "waiting", authorizationUrl: "https://vercel.com/oauth/authorize" }}
        close={() => {}}
        openExternal={async () => {}}
      />,
    ),
  );
  expect(screen.getByText("等待浏览器授权")).toBeTruthy();
  expect(screen.getByRole("button", { name: "打开 Vercel 授权页面" })).toBeTruthy();
  await act(() => i18n.changeLanguage("en"));
});
