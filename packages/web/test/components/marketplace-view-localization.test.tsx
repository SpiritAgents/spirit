/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  };
}

import "./setup";

import { act, fireEvent, render } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next, I18nextProvider } from "react-i18next";
import { expect, test } from "vitest";

import { MarketplaceView } from "@/components/marketplace-view";
import type { DesktopMarketplaceCatalogEntry } from "@/types";

const item = {
  id: "built-in/github",
  sourceId: "built-in",
  sourceName: "built-in",
  name: "github",
  displayName: "GitHub",
  description: "在 Spirit 中处理拉取请求和自动化。",
  keywords: ["拉取请求"],
  category: "development",
  version: "1.0.0",
  reviewStatus: "verified",
  artifactKind: "local",
  installed: false,
  updateAvailable: false,
  supportedHosts: ["desktop"],
} as DesktopMarketplaceCatalogEntry;

const viewProps = {
  extensionsBusy: false,
  onImportExtension: async () => {},
  onInstallMarketplaceExtension: async () => ({ status: "installed" as const }),
  onUpdateExtension: async () => ({ status: "up-to-date" as const }),
  onAddMarketplaceSource: async () => ({ sourceId: "source" }),
  onRemoveMarketplaceSource: async () => {},
  onPickMarketplaceDirectory: async () => null,
  onDeleteExtension: async () => {},
  onSetExtensionEnabled: async () => {},
};

test("localized categories participate in search and update on language changes", async () => {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng: "zh-CN",
    fallbackLng: "en",
    resources: {
      en: {
        translation: {
          marketplace: {
            searchPlaceholder: "Search extensions",
            noMatchesTitle: "No results for “{{query}}”",
            noMatchesDescription: "Check the spelling or try a new search term.",
            categories: { development: "Development", other: "Other" },
          },
        },
      },
      "zh-CN": {
        translation: {
          marketplace: {
            searchPlaceholder: "搜索扩展",
            noMatchesTitle: "未找到“{{query}}”的相关结果",
            noMatchesDescription: "检查拼写或尝试新搜索词。",
            categories: { development: "开发", other: "其他" },
          },
        },
      },
    },
  });
  const snapshot = {
    marketplaceSources: [
      {
        id: "built-in",
        name: "built-in",
        displayName: "Built-in",
        kind: "local" as const,
        locator: "/built-in",
        internal: true,
      },
    ],
    marketplaceCatalogs: { "built-in": [item] },
    marketplaceCatalogAll: [item],
  };
  const view = render(
    <I18nextProvider i18n={i18n}>
      <MarketplaceView {...viewProps} snapshot={snapshot} />
    </I18nextProvider>,
  );
  const rerender = () =>
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MarketplaceView {...viewProps} snapshot={snapshot} />
      </I18nextProvider>,
    );

  fireEvent.change(view.getByPlaceholderText("搜索扩展"), { target: { value: "开发" } });
  expect(view.getByText("GitHub")).toBeTruthy();
  fireEvent.change(view.getByPlaceholderText("搜索扩展"), { target: { value: "不存在" } });
  expect(view.queryByText("GitHub")).toBeNull();
  expect(view.getByText("未找到“不存在”的相关结果")).toBeTruthy();
  expect(view.getByText("检查拼写或尝试新搜索词。")).toBeTruthy();
  fireEvent.change(view.getByPlaceholderText("搜索扩展"), { target: { value: "" } });

  await act(() => i18n.changeLanguage("en"));
  rerender();
  expect(view.getByText("Development")).toBeTruthy();
  fireEvent.change(view.getByPlaceholderText("Search extensions"), {
    target: { value: "Development" },
  });
  expect(view.getByText("GitHub")).toBeTruthy();
});
