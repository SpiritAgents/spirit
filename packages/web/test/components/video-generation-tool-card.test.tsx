/** @vitest-environment jsdom */

import "./setup";

import { act, render } from "@testing-library/react";
import { expect, test } from "vitest";

import { VideoGenerationToolCard } from "@/components/tool-call/video-generation-tool-card";
import { rememberLocalFilePreviewDataUrl } from "@spiritagent/ui/composer";
import type { ToolBlockSnapshot } from "@/types";

function toolFor(videoPath: string): ToolBlockSnapshot {
  return {
    callId: "call-1",
    name: "generate_video",
    phase: "succeeded",
    videoPaths: [videoPath],
  } as unknown as ToolBlockSnapshot;
}

test("shows the shared-cache entry a sibling consumer fetched while this card was loading", async () => {
  const videoPath = "/tmp/cache-race-test/movie.mp4";
  const ownRead = () => new Promise<string | null>(() => {});

  const makeView = () => (
    <VideoGenerationToolCard
      tool={toolFor(videoPath)}
      readLocalVideoPreviewUrl={ownRead}
      readManagedVideoPreviewUrl={ownRead}
    />
  );
  const rendered = render(makeView());
  expect(rendered.container.querySelector("video")).toBeNull();

  // A sibling consumer of the same path resolves first and fills the shared preview cache.
  act(() => {
    rememberLocalFilePreviewDataUrl(videoPath, "data:video/mp4;base64,YWJj");
  });
  rendered.rerender(makeView());

  expect(rendered.container.querySelector("video")).not.toBeNull();
});
