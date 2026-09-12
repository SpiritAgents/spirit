import { useCallback, useEffect, useRef, useState } from "react";

import {
  DISABLED_EDIT_COMMAND_STATE,
  editCommandStateKey,
  type EditCommand,
  type EditCommandState,
} from "@/lib/edit-command-state";
import {
  dispatchEditCommand,
  queryFocusedEditCommandState,
  subscribeEditCommandTargetsChanged,
} from "@/lib/edit-command-targets";

export function useEditCommandStateSync(): {
  state: EditCommandState;
  flush: (force?: boolean) => void;
  dispatch: (command: EditCommand) => void;
} {
  const [state, setState] = useState<EditCommandState>(DISABLED_EDIT_COMMAND_STATE);
  const lastKeyRef = useRef(editCommandStateKey(DISABLED_EDIT_COMMAND_STATE));

  const flush = useCallback((force = false) => {
    const next = queryFocusedEditCommandState();
    const key = editCommandStateKey(next);
    if (!force && lastKeyRef.current === key) {
      return;
    }
    lastKeyRef.current = key;
    setState(next);
    window.spiritDesktop?.syncEditCommandState?.(next);
  }, []);

  const dispatch = useCallback(
    (command: EditCommand) => {
      dispatchEditCommand(command);
      flush(true);
    },
    [flush],
  );

  useEffect(() => {
    const onFocusOrSelection = () => {
      flush();
    };
    document.addEventListener("focusin", onFocusOrSelection, true);
    document.addEventListener("focusout", onFocusOrSelection, true);
    document.addEventListener("selectionchange", onFocusOrSelection);
    const unsubscribeTargets = subscribeEditCommandTargetsChanged(() => {
      flush();
    });
    flush(true);
    return () => {
      document.removeEventListener("focusin", onFocusOrSelection, true);
      document.removeEventListener("focusout", onFocusOrSelection, true);
      document.removeEventListener("selectionchange", onFocusOrSelection);
      unsubscribeTargets();
    };
  }, [flush]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeEditCommand) {
      return;
    }
    return bridge.subscribeEditCommand((command) => {
      dispatchEditCommand(command);
      flush(true);
    });
  }, [flush]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeEditCommandStateRequest) {
      return;
    }
    return bridge.subscribeEditCommandStateRequest(() => {
      flush(true);
    });
  }, [flush]);

  return { state, flush, dispatch };
}
