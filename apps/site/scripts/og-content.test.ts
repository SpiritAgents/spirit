import assert from "node:assert/strict";
import test from "node:test";

import type { Root } from "fumadocs-core/page-tree";

import { messagesByLocale } from "@/i18n/messages";
import { getDocsGroupNames, getRootSectionTitle } from "@/lib/og/content";

test("root sections use existing short navigation labels", () => {
  assert.equal(getRootSectionTitle(messagesByLocale["en-US"], "download"), "Download");
  assert.equal(getRootSectionTitle(messagesByLocale["en-US"], "docs"), "Docs");
  assert.equal(getRootSectionTitle(messagesByLocale["en-US"], "changelog"), "Changelog");
  assert.equal(getRootSectionTitle(messagesByLocale["zh-CN"], "docs"), "文档");
  assert.equal(getRootSectionTitle(messagesByLocale["en-US"], "blog"), null);
  assert.equal(getRootSectionTitle(messagesByLocale["en-US"], "unknown"), null);
});

test("docs group names preserve folder order and omit ungrouped pages", () => {
  const tree = {
    children: [
      { type: "page", name: "Providers", url: "/docs/providers" },
      {
        type: "folder",
        name: "Customize",
        children: [
          {
            type: "folder",
            name: "Group 2",
            children: [
              { type: "page", name: "Extensions", url: "/docs/customize/group-2/extensions" },
            ],
          },
        ],
      },
    ],
  } as Root;

  assert.deepEqual(getDocsGroupNames(tree, "/docs/customize/group-2/extensions"), [
    "Customize",
    "Group 2",
  ]);
  assert.deepEqual(getDocsGroupNames(tree, "/docs/providers"), []);
  assert.deepEqual(getDocsGroupNames(tree, "/docs/missing"), []);
});
