export type WorkspaceGroupRectMeasurement = {
  top: number;
  height: number;
};

/** Matches the sidebar workspace header row h-8; the probe point is the header row center */
export const WORKSPACE_GROUP_ROW_PROBE_INSET_Y = 16;

export function clampWorkspaceGroupPointerY(
  order: readonly string[],
  layoutTops: ReadonlyMap<string, number>,
  heights: ReadonlyMap<string, number>,
  pointerY: number,
): number {
  if (order.length <= 1) {
    return pointerY;
  }
  const firstTop = layoutTops.get(order[0]!);
  const lastTop = layoutTops.get(order[order.length - 1]!);
  const lastHeight = heights.get(order[order.length - 1]!) ?? 0;
  if (firstTop === undefined || lastTop === undefined) {
    return pointerY;
  }
  return Math.min(lastTop + lastHeight, Math.max(firstTop, pointerY));
}

export function clampWorkspaceGroupReorderProbeY(
  order: readonly string[],
  layoutTops: ReadonlyMap<string, number>,
  probeY: number,
): number {
  if (order.length <= 1) {
    return probeY;
  }
  const firstTop = layoutTops.get(order[0]!);
  const lastTop = layoutTops.get(order[order.length - 1]!);
  if (firstTop === undefined || lastTop === undefined) {
    return probeY;
  }
  const minProbeY = firstTop + WORKSPACE_GROUP_ROW_PROBE_INSET_Y;
  const maxProbeY = lastTop + WORKSPACE_GROUP_ROW_PROBE_INSET_Y;
  return Math.min(maxProbeY, Math.max(minProbeY, probeY));
}

export function getWorkspaceGroupDragOffsetBounds(
  order: readonly string[],
  layoutTops: ReadonlyMap<string, number>,
  draggedLayoutTop: number,
): { minOffset: number; maxOffset: number } {
  if (order.length <= 1) {
    return { minOffset: 0, maxOffset: 0 };
  }
  const firstTop = layoutTops.get(order[0]!);
  const lastTop = layoutTops.get(order[order.length - 1]!);
  if (firstTop === undefined || lastTop === undefined) {
    return { minOffset: -Infinity, maxOffset: Infinity };
  }
  return {
    minOffset: firstTop - draggedLayoutTop,
    maxOffset: lastTop - draggedLayoutTop,
  };
}

export function clampWorkspaceGroupDragOffsetY(
  order: readonly string[],
  layoutTops: ReadonlyMap<string, number>,
  draggedLayoutTop: number,
  offsetY: number,
): number {
  if (order.length <= 1) {
    return 0;
  }
  const firstTop = layoutTops.get(order[0]!);
  const lastTop = layoutTops.get(order[order.length - 1]!);
  if (firstTop === undefined || lastTop === undefined) {
    return offsetY;
  }
  const minOffset = firstTop - draggedLayoutTop;
  const maxOffset = lastTop - draggedLayoutTop;
  return Math.min(maxOffset, Math.max(minOffset, offsetY));
}

/** Reorder probe point: dragged card header row center (layout + translateY + header row half height) */
export function computeWorkspaceGroupDragProbeY(
  draggedLayoutTop: number,
  dragOffsetY: number,
  probeInsetY = WORKSPACE_GROUP_ROW_PROBE_INSET_Y,
): number {
  return draggedLayoutTop + dragOffsetY + probeInsetY;
}

/** When the card has reached the top/bottom list boundary, the probe point may still not cross the neighbor midpoint; advance one more slot (must match the drag direction) */
export function applyWorkspaceGroupReorderBoundaryTargetIndex(
  targetIndex: number,
  activeIndex: number,
  orderLength: number,
  clampedOffsetY: number,
  offsetBounds: { minOffset: number; maxOffset: number },
  dragDeltaY: number,
): number {
  let nextTargetIndex = targetIndex;
  if (
    activeIndex > 0 &&
    dragDeltaY < 0 &&
    Math.abs(clampedOffsetY - offsetBounds.minOffset) < 0.5
  ) {
    nextTargetIndex = Math.min(nextTargetIndex, activeIndex - 1);
  }
  if (
    activeIndex < orderLength - 1 &&
    dragDeltaY > 0 &&
    Math.abs(clampedOffsetY - offsetBounds.maxOffset) < 0.5
  ) {
    nextTargetIndex = Math.max(nextTargetIndex, activeIndex + 1);
  }
  return Math.min(orderLength - 1, Math.max(0, nextTargetIndex));
}

export function computeWorkspaceGroupTargetIndexFromLayoutTops(
  probeY: number,
  order: readonly string[],
  draggedId: string,
  layoutTops: ReadonlyMap<string, number>,
): number {
  const activeIndex = order.indexOf(draggedId);
  if (activeIndex < 0) {
    return 0;
  }

  let targetIndex = activeIndex;

  for (let index = 0; index < order.length; index += 1) {
    const id = order[index]!;
    if (id === draggedId) {
      continue;
    }

    const layoutTop = layoutTops.get(id);
    if (layoutTop === undefined) {
      continue;
    }

    const headerMidY = layoutTop + WORKSPACE_GROUP_ROW_PROBE_INSET_Y;
    if (index < activeIndex) {
      if (probeY < headerMidY) {
        return index;
      }
      continue;
    }

    if (probeY > headerMidY) {
      targetIndex = index;
    }
  }

  return targetIndex;
}

export function computeWorkspaceGroupTargetIndex(
  probeY: number,
  order: readonly string[],
  draggedId: string,
  measurements: ReadonlyMap<string, WorkspaceGroupRectMeasurement>,
): number {
  const activeIndex = order.indexOf(draggedId);
  if (activeIndex < 0) {
    return 0;
  }

  let targetIndex = activeIndex;

  for (let index = 0; index < order.length; index += 1) {
    const id = order[index]!;
    if (id === draggedId) {
      continue;
    }

    const rect = measurements.get(id);
    if (!rect) {
      continue;
    }

    const midpoint = rect.top + rect.height / 2;
    if (index < activeIndex) {
      if (probeY < midpoint) {
        return index;
      }
      continue;
    }

    if (probeY > midpoint) {
      targetIndex = index;
    }
  }

  return targetIndex;
}
