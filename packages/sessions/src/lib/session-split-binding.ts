import {
  collectPaneSessionPaths,
  countPanes,
  replaceSessionPathInLayout,
  type SplitLayoutNode,
} from "@/lib/conversation-split-layout";
import {
  isForegroundProvisionalSessionPath,
  normalizeSessionPathKey,
} from "@/lib/session-path-kind";

const SESSION_SPLIT_BINDINGS_STORAGE_KEY = "spirit-desktop-session-split-bindings-v1";

function readBindingMap(): Record<string, SplitLayoutNode> {
  try {
    if (typeof localStorage === "undefined") {
      return {};
    }
    const raw = localStorage.getItem(SESSION_SPLIT_BINDINGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, SplitLayoutNode>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBindingMap(map: Record<string, SplitLayoutNode>): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(SESSION_SPLIT_BINDINGS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SESSION_SPLIT_BINDINGS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function summarizeSessionSplitBindings(): Array<{
  key: string;
  paneCount: number;
  paths: string[];
}> {
  const map = readBindingMap();
  return Object.entries(map).map(([key, layout]) => ({
    key: key.split(/[/\\]/).pop() ?? key,
    paneCount: countPanes(layout),
    paths: collectPaneSessionPaths(layout).map((path) => path.split(/[/\\]/).pop() ?? path),
  }));
}

export function readSessionSplitBinding(sessionPath: string): SplitLayoutNode | null {
  if (isForegroundProvisionalSessionPath(sessionPath)) {
    return null;
  }
  const map = readBindingMap();
  const layout = map[normalizeSessionPathKey(sessionPath)];
  if (!layout || countPanes(layout) <= 1) {
    return null;
  }
  return layout;
}

export function persistSessionSplitBinding(layout: SplitLayoutNode): void {
  if (countPanes(layout) <= 1) {
    return;
  }
  const map = readBindingMap();
  for (const path of collectPaneSessionPaths(layout)) {
    if (isForegroundProvisionalSessionPath(path)) {
      continue;
    }
    map[normalizeSessionPathKey(path)] = layout;
  }
  for (const key of Object.keys(map)) {
    if (isForegroundProvisionalSessionPath(key)) {
      delete map[key];
    }
  }
  writeBindingMap(map);
}

/** Replace a stale split-pane provisional path with its promoted stable chat path in all bindings. */
export function remapSessionSplitBindingPath(fromPath: string, toPath: string): void {
  if (normalizeSessionPathKey(fromPath) === normalizeSessionPathKey(toPath)) {
    return;
  }
  const map = readBindingMap();
  const fromKey = normalizeSessionPathKey(fromPath);
  let remappedLayout: SplitLayoutNode | undefined;
  for (const layout of Object.values(map)) {
    if (collectPaneSessionPaths(layout).some((path) => normalizeSessionPathKey(path) === fromKey)) {
      remappedLayout = replaceSessionPathInLayout(layout, fromPath, toPath);
      break;
    }
  }
  if (!remappedLayout) {
    return;
  }
  for (const key of Object.keys(map)) {
    const layout = map[key]!;
    if (collectPaneSessionPaths(layout).some((path) => normalizeSessionPathKey(path) === fromKey)) {
      delete map[key];
    }
  }
  for (const path of collectPaneSessionPaths(remappedLayout)) {
    if (isForegroundProvisionalSessionPath(path)) {
      continue;
    }
    map[normalizeSessionPathKey(path)] = remappedLayout;
  }
  writeBindingMap(map);
}

export function clearSessionSplitBindings(sessionPaths: readonly string[]): void {
  if (sessionPaths.length === 0) {
    return;
  }
  const map = readBindingMap();
  let changed = false;
  for (const sessionPath of sessionPaths) {
    if (map[normalizeSessionPathKey(sessionPath)]) {
      delete map[normalizeSessionPathKey(sessionPath)];
      changed = true;
    }
  }
  if (changed) {
    writeBindingMap(map);
  }
}

/** Drop stale bindings keyed by reused foreground draft paths. */
export function sanitizeSessionSplitBindings(): void {
  const map = readBindingMap();
  let changed = false;
  for (const key of Object.keys(map)) {
    if (isForegroundProvisionalSessionPath(key)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) {
    writeBindingMap(map);
  }
}
