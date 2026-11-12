import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const styles = await readFile(new URL("../../src/styles.css", import.meta.url), "utf8");
const normalizedStyles = styles.replace(/\s+/g, " ");

test("browser and macOS fullscreen chrome preserve the shared top content padding", () => {
  assert.match(styles, /--spirit-chrome-controls-padding: 0\.625rem/);
  assert.match(
    styles,
    /html:not\(\.spirit-desktop-native\) \[data-spirit-surface="layout-chrome"]/,
  );
  assert.match(
    styles,
    /html:not\(\.spirit-desktop-native\) \[data-spirit-surface="workspace-tool-tabs"]/,
  );
  assert.match(
    styles,
    /html\.spirit-desktop-darwin\.spirit-desktop-darwin-fullscreen \{[^}]*--spirit-macos-titlebar-chrome-pad-top: var\(--spirit-chrome-controls-padding\)/s,
  );
  assert.match(
    styles,
    /html\.spirit-desktop-darwin\.spirit-desktop-darwin-fullscreen\s+\[data-spirit-surface="layout-chrome"]\[data-session-sidebar-open="false"] \{\s+padding-left: var\(--spirit-chrome-controls-padding\);/s,
  );
  assert.ok(
    normalizedStyles.includes(
      "1.75rem + var(--spirit-chrome-controls-padding) + var(--spirit-chrome-controls-padding)",
    ),
  );
});
