import assert from "node:assert/strict";
import { test } from "vitest";

import {
  parseProviderToolSpiritUiPreview,
  providerToolInputJsonFromRequest,
} from "../../dist-electron/src/host/provider-tool-preview.js";

test("parseProviderToolSpiritUiPreview reads the declared label and suppressExpand", () => {
  const ui = parseProviderToolSpiritUiPreview(
    JSON.stringify({
      query: "DeepSeek",
      status: "completed",
      _spiritUi: {
        label: "Web Search",
        inputExcerpt: "DeepSeek",
        headlineDetail: "DeepSeek",
        outputExcerpt: "1. https://www.deepseek.com/",
        suppressExpand: true,
      },
    }),
  );
  assert.deepEqual(ui, {
    label: "Web Search",
    suppressExpand: true,
    inputExcerpt: "DeepSeek",
    headlineDetail: "DeepSeek",
    outputExcerpt: "1. https://www.deepseek.com/",
  });
});

test("parseProviderToolSpiritUiPreview returns undefined without a _spiritUi block", () => {
  assert.equal(parseProviderToolSpiritUiPreview('{"query":"x"}'), undefined);
  assert.equal(parseProviderToolSpiritUiPreview("not json"), undefined);
  assert.equal(parseProviderToolSpiritUiPreview('{"_spiritUi":"nope"}'), undefined);
});

test("parseProviderToolSpiritUiPreview keeps the in-band built-in card fields", () => {
  const ui = parseProviderToolSpiritUiPreview(
    JSON.stringify({
      status: "completed",
      _spiritUi: {
        inputExcerpt: "deepseek",
        internalActionType: "search",
        sourceCount: 2,
        detailLines: ["1. https://a.example", "2. https://b.example"],
      },
    }),
  );
  assert.equal(ui?.label, undefined);
  assert.equal(ui?.suppressExpand, false);
  assert.equal(ui?.internalActionType, "search");
  assert.equal(ui?.sourceCount, 2);
  assert.deepEqual(ui?.detailLines, ["1. https://a.example", "2. https://b.example"]);
});

test("providerToolInputJsonFromRequest pretty-prints the call arguments JSON", () => {
  assert.equal(
    providerToolInputJsonFromRequest({
      name: "web_search",
      argumentsJson: '{"query":"DeepSeek","max_results":5}',
    }),
    '{\n  "query": "DeepSeek",\n  "max_results": 5\n}',
  );
  assert.equal(providerToolInputJsonFromRequest({ name: "web_search" }), undefined);
  assert.equal(providerToolInputJsonFromRequest(undefined), undefined);
  assert.equal(
    providerToolInputJsonFromRequest({ name: "web_search", argumentsJson: "{truncated" }),
    "{truncated",
  );
});
