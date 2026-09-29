/** @vitest-environment jsdom */

import "./setup";

import { act, render, waitFor } from "@testing-library/react";
import { Streamdown } from "streamdown";
import { expect, test, vi } from "vitest";

import { MarkdownImageSource } from "@/components/markdown-image";
import { createMarkdownMessageComponents } from "@/lib/markdown-message-components";
import { streamdownRehypePlugins } from "@/lib/markdown-streamdown-plugins";
import { streamdownUrlTransform } from "@/lib/markdown-url-transform";

const darkPreview = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="white"/></svg>')}`;
const lightPreview = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="black"/></svg>')}`;

test("raw Markdown picture resolves both theme sources through the local image reader", async () => {
  const readLocal = vi.fn(async (filePath: string) =>
    filePath.endsWith("logo-light.svg") ? lightPreview : darkPreview,
  );
  const components = createMarkdownMessageComponents(
    undefined,
    "default",
    undefined,
    undefined,
    "default",
    true,
    readLocal,
    "/workspace",
    "/workspace",
  );
  const { container } = render(
    <Streamdown
      mode="static"
      components={components}
      rehypePlugins={streamdownRehypePlugins}
      urlTransform={streamdownUrlTransform}
    >
      {`<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/brand/assets/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="packages/brand/assets/logo-light.svg">
  <img src="packages/brand/assets/logo-dark.svg" width="120" alt="Spirit">
</picture>`}
    </Streamdown>,
  );

  const sources = container.querySelectorAll("picture > source");
  expect(sources).toHaveLength(2);
  expect(sources[0].getAttribute("srcset")).toBeNull();
  expect(sources[1].getAttribute("srcset")).toBeNull();
  await waitFor(() => {
    expect(sources[0].getAttribute("srcset")).toBe(darkPreview);
    expect(sources[1].getAttribute("srcset")).toBe(lightPreview);
    expect(container.querySelector("picture > img")?.getAttribute("src")).toBe(darkPreview);
  });
  expect(sources[0].getAttribute("media")).toBe("(prefers-color-scheme: dark)");
  expect(sources[1].getAttribute("media")).toBe("(prefers-color-scheme: light)");
  expect(readLocal).toHaveBeenCalledWith("/workspace/packages/brand/assets/logo-dark.svg");
  expect(readLocal).toHaveBeenCalledWith("/workspace/packages/brand/assets/logo-light.svg");
});

test("picture sources preserve density descriptors and remote URLs containing commas", async () => {
  const readLocal = vi.fn(async () => darkPreview);
  const { container } = render(
    <picture>
      <MarkdownImageSource
        srcSet="./logo.svg 1x, https://example.com/logo,large.svg 2x"
        media="(min-width: 600px)"
        readLocalImagePreviewDataUrl={readLocal}
        localImageBaseDir="/workspace"
        localImageAllowedRootDir="/workspace"
      />
    </picture>,
  );
  await waitFor(() => {
    expect(container.querySelector("source")?.getAttribute("srcset")).toBe(
      `${darkPreview} 1x, https://example.com/logo,large.svg 2x`,
    );
  });
  expect(readLocal).toHaveBeenCalledExactlyOnceWith("/workspace/logo.svg");
});

test("picture sources reject unsafe URLs and paths outside the allowed workspace", async () => {
  const readLocal = vi.fn(async () => darkPreview);
  const { container } = render(
    <picture>
      <MarkdownImageSource
        srcSet="../../outside.svg 1x, http://example.com/logo.svg 2x, //example.com/logo.svg 3x, javascript:alert(1) 4x, data:image/png;base64,abc 5x, ./logo.svg 6x"
        readLocalImagePreviewDataUrl={readLocal}
        localImageBaseDir="/workspace/docs"
        localImageAllowedRootDir="/workspace"
      />
    </picture>,
  );
  await waitFor(() => {
    expect(container.querySelector("source")?.getAttribute("srcset")).toBe(`${darkPreview} 6x`);
  });
  expect(readLocal).toHaveBeenCalledExactlyOnceWith("/workspace/docs/logo.svg");
});

test("an unavailable source leaves the fallback image available", async () => {
  const readLocal = vi.fn(async () => {
    throw new Error("Image unavailable");
  });
  const { container } = render(
    <picture>
      <MarkdownImageSource
        srcSet="./missing.svg"
        readLocalImagePreviewDataUrl={readLocal}
        localImageBaseDir="/workspace"
      />
      <img src={darkPreview} alt="Fallback" />
    </picture>,
  );
  await act(async () => {});
  expect(readLocal).toHaveBeenCalledExactlyOnceWith("/workspace/missing.svg");
  expect(container.querySelector("source")?.getAttribute("srcset")).toBeNull();
  expect(container.querySelector("img")?.getAttribute("src")).toBe(darkPreview);
});

test("picture sources use the managed image reader", async () => {
  const reference = "spirit://generated/image/preview.png";
  const readManaged = vi.fn(async () => darkPreview);
  const { container } = render(
    <picture>
      <MarkdownImageSource
        srcSet={`${reference} 2x`}
        readManagedImagePreviewDataUrl={readManaged}
      />
    </picture>,
  );
  await waitFor(() => {
    expect(container.querySelector("source")?.getAttribute("srcset")).toBe(`${darkPreview} 2x`);
  });
  expect(readManaged).toHaveBeenCalledExactlyOnceWith(reference);
});

test("picture sources ignore late results after srcset changes", async () => {
  let resolveFirst!: (value: string | null) => void;
  const readLocal = vi.fn((filePath: string) =>
    filePath.endsWith("first.svg")
      ? new Promise<string | null>((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve(lightPreview),
  );
  const { container, rerender } = render(
    <MarkdownImageSource
      srcSet="./first.svg"
      readLocalImagePreviewDataUrl={readLocal}
      localImageBaseDir="/workspace"
    />,
  );
  expect(container.querySelector("source")?.getAttribute("srcset")).toBeNull();
  rerender(
    <MarkdownImageSource
      srcSet="./second.svg"
      readLocalImagePreviewDataUrl={readLocal}
      localImageBaseDir="/workspace"
    />,
  );
  await waitFor(() => {
    expect(container.querySelector("source")?.getAttribute("srcset")).toBe(lightPreview);
  });
  await act(async () => resolveFirst(darkPreview));
  expect(container.querySelector("source")?.getAttribute("srcset")).toBe(lightPreview);
});
