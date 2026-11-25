/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { TurnErrorMessageCard } from "@/components/conversation/turn-error-message-card";
import {
  CHATGPT_MANAGE_USAGE_URL,
  CHATGPT_UPGRADE_PLAN_URL,
} from "@/lib/conversation-turn-error-ui";

test("renders localized copy and Manage Usage secondary action for subscription_sharing_usage_limit_exceeded", () => {
  const onOpenExternalUrl = vi.fn();
  render(
    <TurnErrorMessageCard
      content="raw upstream 429 limit text"
      detail={{
        providerId: "chatgpt",
        code: "subscription_sharing_usage_limit_exceeded",
        status: 429,
      }}
      onOpenExternalUrl={onOpenExternalUrl}
    />,
  );

  expect(screen.queryByText("raw upstream 429 limit text")).toBeNull();
  expect(screen.getByText(/reached your ChatGPT plan usage limit/i)).toBeTruthy();

  const button = screen.getByRole("button", { name: "Manage Usage" });
  fireEvent.click(button);
  expect(onOpenExternalUrl).toHaveBeenCalledWith(CHATGPT_MANAGE_USAGE_URL);
});

test("renders localized copy and Upgrade Plan secondary action for subscription_sharing_user_not_eligible", () => {
  const onOpenExternalUrl = vi.fn();
  render(
    <TurnErrorMessageCard
      content="raw upstream 403 not eligible"
      detail={{
        providerId: "chatgpt",
        code: "subscription_sharing_user_not_eligible",
        status: 403,
      }}
      onOpenExternalUrl={onOpenExternalUrl}
    />,
  );

  expect(screen.queryByText("raw upstream 403 not eligible")).toBeNull();
  expect(screen.getByText(/not eligible for plan usage/i)).toBeTruthy();

  const button = screen.getByRole("button", { name: "Upgrade Plan" });
  fireEvent.click(button);
  expect(onOpenExternalUrl).toHaveBeenCalledWith(CHATGPT_UPGRADE_PLAN_URL);
});

test("maps remaining documented SIWC error codes and preserves non-ChatGPT errors verbatim", () => {
  const { rerender } = render(
    <TurnErrorMessageCard
      content="raw invalid user"
      detail={{ providerId: "chatgpt", code: "subscription_sharing_invalid_user", status: 401 }}
    />,
  );
  expect(screen.getByText(/sign-in is no longer valid/i)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();

  rerender(
    <TurnErrorMessageCard
      content="raw refresh reused"
      detail={{ providerId: "chatgpt", code: "refresh_token_reused", status: 401 }}
    />,
  );
  expect(screen.getByText(/authorization has expired or been revoked/i)).toBeTruthy();

  rerender(
    <TurnErrorMessageCard
      content="raw scope denied"
      detail={{ providerId: "chatgpt", code: "chatpass_v2_scope_not_authorized", status: 403 }}
    />,
  );
  expect(screen.getByText(/plan usage permission is not authorized/i)).toBeTruthy();

  rerender(
    <TurnErrorMessageCard
      content="raw region blocked"
      detail={{ providerId: "chatgpt", status: 403 }}
    />,
  );
  expect(screen.getByText(/region or workspace policy restrictions/i)).toBeTruthy();

  rerender(
    <TurnErrorMessageCard
      content="raw routing down"
      detail={{ providerId: "chatgpt", status: 503 }}
    />,
  );
  expect(screen.getByText(/temporarily unavailable/i)).toBeTruthy();

  rerender(
    <TurnErrorMessageCard
      content="Generic OpenAI API error"
      detail={{ providerId: "openai", status: 403 }}
    />,
  );
  expect(screen.getByText("Generic OpenAI API error")).toBeTruthy();
});
