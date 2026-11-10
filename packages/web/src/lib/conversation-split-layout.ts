export type SplitDirection = "horizontal" | "vertical";

export type SplitLayoutLeafNode = {
  kind: "leaf";
  paneId: string;
  sessionPath: string;
};

export type SplitLayoutSplitNode = {
  kind: "split";
  splitId: string;
  direction: SplitDirection;
  ratio: number;
  first: SplitLayoutNode;
  second: SplitLayoutNode;
};

export type SplitLayoutNode = SplitLayoutLeafNode | SplitLayoutSplitNode;

export const DEFAULT_SPLIT_RATIO = 0.5;
const MIN_SPLIT_RATIO = 0.15;
const MAX_SPLIT_RATIO = 0.85;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_SPLIT_RATIO;
  }
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function createLeafNode(paneId: string, sessionPath: string): SplitLayoutLeafNode {
  return {
    kind: "leaf",
    paneId,
    sessionPath,
  };
}

export function createSinglePaneLayout(paneId: string, sessionPath: string): SplitLayoutLeafNode {
  return createLeafNode(paneId, sessionPath);
}

export function countPanes(node: SplitLayoutNode): number {
  if (node.kind === "leaf") {
    return 1;
  }
  return countPanes(node.first) + countPanes(node.second);
}

export function collectPaneSessionPaths(node: SplitLayoutNode): string[] {
  if (node.kind === "leaf") {
    return [node.sessionPath];
  }
  return [...collectPaneSessionPaths(node.first), ...collectPaneSessionPaths(node.second)];
}

export function collectSplitLayoutLeaves(node: SplitLayoutNode): SplitLayoutLeafNode[] {
  if (node.kind === "leaf") {
    return [node];
  }
  return [...collectSplitLayoutLeaves(node.first), ...collectSplitLayoutLeaves(node.second)];
}

function normalizeSessionPathKey(sessionPath: string): string {
  return sessionPath.replace(/\\/g, "/").toLowerCase();
}

/** Leaves whose sessionPath duplicates an earlier leaf in the same layout tree. */
export function findDuplicateSessionPathLeaves(node: SplitLayoutNode): SplitLayoutLeafNode[] {
  const seen = new Set<string>();
  const duplicates: SplitLayoutLeafNode[] = [];
  for (const leaf of collectSplitLayoutLeaves(node)) {
    const key = normalizeSessionPathKey(leaf.sessionPath);
    if (seen.has(key)) {
      duplicates.push(leaf);
      continue;
    }
    seen.add(key);
  }
  return duplicates;
}

export function findLeafByPaneId(
  node: SplitLayoutNode,
  paneId: string,
): SplitLayoutLeafNode | undefined {
  if (node.kind === "leaf") {
    return node.paneId === paneId ? node : undefined;
  }
  return findLeafByPaneId(node.first, paneId) ?? findLeafByPaneId(node.second, paneId);
}

export function findLeafBySessionPath(
  node: SplitLayoutNode,
  sessionPath: string,
): SplitLayoutLeafNode | undefined {
  const target = normalizeSessionPathKey(sessionPath);
  for (const leaf of collectSplitLayoutLeaves(node)) {
    if (normalizeSessionPathKey(leaf.sessionPath) === target) {
      return leaf;
    }
  }
  return undefined;
}

export function findWorkspaceToolsAnchorPaneId(node: SplitLayoutNode): string {
  if (node.kind === "leaf") {
    return node.paneId;
  }
  const child = node.direction === "horizontal" ? node.second : node.first;
  return findWorkspaceToolsAnchorPaneId(child);
}

/** Top-left pane in the layout tree; hosts the session sidebar toggle in split view. */
export function findSessionSidebarAnchorPaneId(node: SplitLayoutNode): string {
  if (node.kind === "leaf") {
    return node.paneId;
  }
  return findSessionSidebarAnchorPaneId(node.first);
}

export function updateLeafSessionPath(
  node: SplitLayoutNode,
  paneId: string,
  sessionPath: string,
): SplitLayoutNode {
  if (node.kind === "leaf") {
    return node.paneId === paneId ? { ...node, sessionPath } : node;
  }
  return {
    ...node,
    first: updateLeafSessionPath(node.first, paneId, sessionPath),
    second: updateLeafSessionPath(node.second, paneId, sessionPath),
  };
}

export function replaceSessionPathInLayout(
  node: SplitLayoutNode,
  fromPath: string,
  toPath: string,
): SplitLayoutNode {
  const fromKey = normalizeSessionPathKey(fromPath);
  if (node.kind === "leaf") {
    return normalizeSessionPathKey(node.sessionPath) === fromKey
      ? { ...node, sessionPath: toPath }
      : node;
  }
  return {
    ...node,
    first: replaceSessionPathInLayout(node.first, fromPath, toPath),
    second: replaceSessionPathInLayout(node.second, fromPath, toPath),
  };
}

export function updateSplitRatio(
  node: SplitLayoutNode,
  splitId: string,
  ratio: number,
): SplitLayoutNode {
  if (node.kind === "leaf") {
    return node;
  }
  if (node.splitId === splitId) {
    return { ...node, ratio: clampSplitRatio(ratio) };
  }
  return {
    ...node,
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio),
  };
}

export type SplitRatioUpdate = {
  splitId: string;
  ratio: number;
};

export function updateSplitRatios(
  node: SplitLayoutNode,
  updates: readonly SplitRatioUpdate[],
): SplitLayoutNode {
  return updates.reduce(
    (layout, update) => updateSplitRatio(layout, update.splitId, update.ratio),
    node,
  );
}

/** Perpendicular divider intersection within one split container (fractions 0–1). */
export type SplitJunctionSpec = {
  id: string;
  xRatio: number;
  yRatio: number;
  /** Vertical divider lines — updated from pointer X in this container. */
  xSplitIds: readonly string[];
  /** Horizontal divider lines — updated from pointer Y in this container. */
  ySplitIds: readonly string[];
};

const JUNCTION_MERGE_EPSILON = 0.002;

function mergeAxisAlignedJunctions(junctions: SplitJunctionSpec[]): SplitJunctionSpec[] {
  if (junctions.length !== 2) {
    return junctions;
  }
  const [first, second] = junctions;
  if (Math.abs(first.xRatio - second.xRatio) < JUNCTION_MERGE_EPSILON) {
    return [
      {
        id: `${first.id}:merged`,
        xRatio: first.xRatio,
        yRatio: first.yRatio,
        xSplitIds: first.xSplitIds,
        ySplitIds: [...new Set([...first.ySplitIds, ...second.ySplitIds])],
      },
    ];
  }
  if (Math.abs(first.yRatio - second.yRatio) < JUNCTION_MERGE_EPSILON) {
    return [
      {
        id: `${first.id}:merged`,
        xRatio: first.xRatio,
        yRatio: first.yRatio,
        xSplitIds: [...new Set([...first.xSplitIds, ...second.xSplitIds])],
        ySplitIds: first.ySplitIds,
      },
    ];
  }
  return junctions;
}

export function collectSplitJunctions(node: SplitLayoutSplitNode): SplitJunctionSpec[] {
  const junctions: SplitJunctionSpec[] = [];

  if (node.direction === "horizontal") {
    if (node.first.kind === "split" && node.first.direction === "vertical") {
      junctions.push({
        id: `${node.splitId}:first`,
        xRatio: node.ratio,
        yRatio: node.first.ratio,
        xSplitIds: [node.splitId],
        ySplitIds: [node.first.splitId],
      });
    }
    if (node.second.kind === "split" && node.second.direction === "vertical") {
      junctions.push({
        id: `${node.splitId}:second`,
        xRatio: node.ratio,
        yRatio: node.second.ratio,
        xSplitIds: [node.splitId],
        ySplitIds: [node.second.splitId],
      });
    }
    return mergeAxisAlignedJunctions(junctions);
  }

  if (node.first.kind === "split" && node.first.direction === "horizontal") {
    junctions.push({
      id: `${node.splitId}:first`,
      xRatio: node.first.ratio,
      yRatio: node.ratio,
      xSplitIds: [node.first.splitId],
      ySplitIds: [node.splitId],
    });
  }
  if (node.second.kind === "split" && node.second.direction === "horizontal") {
    junctions.push({
      id: `${node.splitId}:second`,
      xRatio: node.second.ratio,
      yRatio: node.ratio,
      xSplitIds: [node.second.splitId],
      ySplitIds: [node.splitId],
    });
  }
  return mergeAxisAlignedJunctions(junctions);
}

export function splitPaneAt(
  node: SplitLayoutNode,
  paneId: string,
  direction: SplitDirection,
  newPane: SplitLayoutLeafNode,
): SplitLayoutNode {
  if (node.kind === "leaf") {
    if (node.paneId !== paneId) {
      return node;
    }
    const splitId = `split-${paneId}-${newPane.paneId}`;
    return {
      kind: "split",
      splitId,
      direction,
      ratio: DEFAULT_SPLIT_RATIO,
      first: node,
      second: newPane,
    };
  }

  return {
    ...node,
    first: splitPaneAt(node.first, paneId, direction, newPane),
    second: splitPaneAt(node.second, paneId, direction, newPane),
  };
}

function promoteSingleChildSplit(node: SplitLayoutSplitNode): SplitLayoutNode {
  const firstCount = countPanes(node.first);
  const secondCount = countPanes(node.second);
  if (firstCount === 0) {
    return node.second;
  }
  if (secondCount === 0) {
    return node.first;
  }
  return node;
}

function removeLeaf(node: SplitLayoutNode, paneId: string): SplitLayoutNode | null {
  if (node.kind === "leaf") {
    return node.paneId === paneId ? null : node;
  }

  const nextFirst = removeLeaf(node.first, paneId);
  const nextSecond = removeLeaf(node.second, paneId);

  if (!nextFirst && !nextSecond) {
    return null;
  }
  if (!nextFirst) {
    return nextSecond;
  }
  if (!nextSecond) {
    return nextFirst;
  }

  const nextNode: SplitLayoutSplitNode = {
    ...node,
    first: nextFirst,
    second: nextSecond,
  };
  return promoteSingleChildSplit(nextNode);
}

export function closePane(node: SplitLayoutNode, paneId: string): SplitLayoutNode | null {
  if (node.kind === "leaf") {
    return node.paneId === paneId ? null : node;
  }
  return removeLeaf(node, paneId);
}

export type PaneRepositionZone = "before" | "after" | "above" | "below";

/** Drop target that swaps sibling panes instead of wrapping a new split. */
export type PaneSwapZone = "swap";

export type PaneDropZone = PaneRepositionZone | PaneSwapZone;

function wrapWithSplit(
  target: SplitLayoutNode,
  incoming: SplitLayoutLeafNode,
  zone: PaneRepositionZone,
): SplitLayoutSplitNode {
  const horizontal = zone === "before" || zone === "after";
  const placeIncomingFirst = zone === "before" || zone === "above";
  const splitId = `split-${incoming.paneId}-${target.kind === "leaf" ? target.paneId : target.splitId}`;
  return {
    kind: "split",
    splitId,
    direction: horizontal ? "horizontal" : "vertical",
    ratio: DEFAULT_SPLIT_RATIO,
    first: placeIncomingFirst ? incoming : target,
    second: placeIncomingFirst ? target : incoming,
  };
}

function replaceLeaf(
  node: SplitLayoutNode,
  paneId: string,
  replacement: SplitLayoutNode,
): SplitLayoutNode {
  if (node.kind === "leaf") {
    return node.paneId === paneId ? replacement : node;
  }
  return {
    ...node,
    first: replaceLeaf(node.first, paneId, replacement),
    second: replaceLeaf(node.second, paneId, replacement),
  };
}

/** Split a target pane by wrapping it with a new leaf at the given drop zone (sidebar session drag). */
export function splitPaneAtZone(
  node: SplitLayoutNode,
  targetPaneId: string,
  zone: PaneRepositionZone,
  newLeaf: SplitLayoutLeafNode,
): SplitLayoutNode {
  const targetLeaf = findLeafByPaneId(node, targetPaneId);
  if (!targetLeaf) {
    return node;
  }
  const replacement = wrapWithSplit(targetLeaf, newLeaf, zone);
  return replaceLeaf(node, targetPaneId, replacement);
}

export function repositionPane(
  node: SplitLayoutNode,
  sourcePaneId: string,
  targetPaneId: string,
  zone: PaneRepositionZone,
): SplitLayoutNode | null {
  if (sourcePaneId === targetPaneId) {
    return node;
  }

  const sourceLeaf = findLeafByPaneId(node, sourcePaneId);
  if (!sourceLeaf) {
    return node;
  }

  const withoutSource = closePane(node, sourcePaneId);
  if (!withoutSource) {
    return node;
  }

  const targetLeaf = findLeafByPaneId(withoutSource, targetPaneId);
  if (!targetLeaf) {
    return node;
  }

  const replacement = wrapWithSplit(targetLeaf, sourceLeaf, zone);
  return replaceLeaf(withoutSource, targetPaneId, replacement);
}

function containsPane(node: SplitLayoutNode, paneId: string): boolean {
  return findLeafByPaneId(node, paneId) !== undefined;
}

/** Swap two panes that share the same immediate split parent (e.g. left/right siblings). */
export function swapAdjacentPanes(
  node: SplitLayoutNode,
  paneAId: string,
  paneBId: string,
): SplitLayoutNode {
  if (paneAId === paneBId) {
    return node;
  }
  if (node.kind === "leaf") {
    return node;
  }

  const aInFirst = containsPane(node.first, paneAId);
  const aInSecond = containsPane(node.second, paneAId);
  const bInFirst = containsPane(node.first, paneBId);
  const bInSecond = containsPane(node.second, paneBId);

  if ((aInFirst && bInSecond) || (bInFirst && aInSecond)) {
    return {
      ...node,
      first: node.second,
      second: node.first,
      ratio: clampSplitRatio(1 - node.ratio),
    };
  }

  const nextFirst = swapAdjacentPanes(node.first, paneAId, paneBId);
  const nextSecond = swapAdjacentPanes(node.second, paneAId, paneBId);
  if (nextFirst === node.first && nextSecond === node.second) {
    return node;
  }
  return {
    ...node,
    first: nextFirst,
    second: nextSecond,
  };
}

export function createPaneId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
