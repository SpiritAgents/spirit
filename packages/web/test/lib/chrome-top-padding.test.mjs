import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const styles = await readFile(new URL("../../src/styles.css", import.meta.url), "utf8");
const composerDock = await readFile(
  new URL("../../src/components/conversation/composer-dock.tsx", import.meta.url),
  "utf8",
);
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
    /html\.spirit-desktop-darwin\.spirit-desktop-darwin-fullscreen\s+\[data-spirit-surface="layout-chrome"]\[data-thread-sidebar-open="false"] \{\s+padding-left: var\(--spirit-chrome-controls-padding\);/s,
  );
  assert.ok(
    normalizedStyles.includes(
      "1.75rem + var(--spirit-chrome-controls-padding) + var(--spirit-chrome-controls-padding)",
    ),
  );
});

test("empty-session composer centering compensates for --spirit-layout-chrome-height across all chrome modes", () => {
  assert.match(styles, /:root \{[^}]*--spirit-layout-chrome-height: 2rem;/s);
  assert.match(
    styles,
    /html\.spirit-desktop-darwin \{[^}]*--spirit-layout-chrome-height: var\(--spirit-macos-titlebar-inset\);/s,
  );
  assert.match(
    styles,
    /html:not\(\.spirit-desktop-native\) \{[^}]*--spirit-layout-chrome-height: calc\(1\.75rem \+ var\(--spirit-chrome-controls-padding\)\);/s,
  );
  assert.match(
    styles,
    /html\.spirit-desktop-darwin\.spirit-desktop-darwin-fullscreen \{[^}]*--spirit-layout-chrome-height: calc\(1\.75rem \+ var\(--spirit-chrome-controls-padding\)\);/s,
  );
  assert.match(
    composerDock,
    /pb-\[calc\(var\(--spirit-layout-chrome-height,2rem\)\+env\(safe-area-inset-bottom,0px\)\)\]/,
  );
});
