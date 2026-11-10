import { useCallback, useState } from "react";

export function useSubagentViewer(
  setSubagentViewerTarget: (parentToolCallId: string | null) => Promise<boolean>,
) {
  const [activeToolCallId, setActiveToolCallId] = useState<string | null>(null);

  const open = useCallback(
    async (toolCallId: string) => {
      const trimmed = toolCallId.trim();
      if (!trimmed) {
        return;
      }
      const ok = await setSubagentViewerTarget(trimmed);
      if (ok) {
        setActiveToolCallId(trimmed);
      }
    },
    [setSubagentViewerTarget],
  );

  const close = useCallback(async () => {
    setActiveToolCallId(null);
    await setSubagentViewerTarget(null);
  }, [setSubagentViewerTarget]);

  return {
    active: activeToolCallId !== null,
    toolCallId: activeToolCallId,
    open,
    close,
  };
}
