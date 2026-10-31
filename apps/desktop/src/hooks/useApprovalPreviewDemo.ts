import { useCallback, useMemo, useState } from "react";

import {
  buildApprovalPreviewDemoEntries,
  type ApprovalPreviewDemoEntry,
} from "@/lib/approval-preview-demo";

export function useApprovalPreviewDemo() {
  const [active, setActive] = useState(false);

  const start = useCallback(() => {
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
  }, []);

  const approvals = useMemo(
    (): ApprovalPreviewDemoEntry[] => (active ? buildApprovalPreviewDemoEntries() : []),
    [active],
  );

  return {
    active,
    approvals,
    start,
    stop,
  };
}
