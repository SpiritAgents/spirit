/** @vitest-environment jsdom */

import "./setup";

import { act, render } from "@testing-library/react";
import { expect, test } from "vitest";

import { ImageGenerationToolCard } from "@/components/tool-call/image-generation-tool-card";
import { rememberLocalFilePreviewDataUrl } from "@spiritagent/ui/composer";
import type { ToolBlockSnapshot } from "@/types";

function toolFor(imagePath: string): ToolBlockSnapshot {
  return {
    callId: "call-1",
    name: "generate_image",
    phase: "succeeded",
    imagePaths: [imagePath],
  } as unknown as ToolBlockSnapshot;
}

test("shows the shared-cache entry a sibling consumer fetched while this card was loading", async () => {
  const imagePath = "/tmp/cache-race-test/picture.png";
  let resolveOwnRead: (dataUrl: string | null) => void = () => {};
  const ownRead = () =>
    new Promise<string | null>((resolve) => {
      resolveOwnRead = resolve;
    });

  const makeView = () => (
    <ImageGenerationToolCard
      tool={toolFor(imagePath)}
      readLocalImagePreviewDataUrl={ownRead}
      saveLocalImageAs={async () => ({ status: "saved" })}
    />
  );
  const rendered = render(makeView());
  expect(rendered.container.querySelector("img")).toBeNull();

  // A sibling consumer of the same path resolves first and fills the shared preview cache.
  act(() => {
    rememberLocalFilePreviewDataUrl(imagePath, "data:image/png;base64,YWJj");
  });
  rendered.rerender(makeView());
  expect(rendered.container.querySelector("img")).not.toBeNull();

  // This card's own read resolves late; the shared entry keeps showing regardless.
  resolveOwnRead(null);
});
