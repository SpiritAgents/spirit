import { useCallback, useMemo, useState } from "react";

import { buildToolCardPreviewDemoTools } from "@/lib/tool-card-preview-demo";
import type { ToolBlockSnapshot } from "@/types";

export function useToolCardPreviewDemo() {
  const [active, setActive] = useState(false);

  const start = useCallback(() => {
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
  }, []);

  const tools = useMemo(
    (): ToolBlockSnapshot[] => (active ? buildToolCardPreviewDemoTools() : []),
    [active],
  );

  return {
    active,
    tools,
    start,
    stop,
  };
}
