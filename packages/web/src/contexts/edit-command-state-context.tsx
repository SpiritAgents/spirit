import { createContext, useContext, type ReactNode } from "react";

import { useEditCommandStateSync } from "@/hooks/useEditCommandStateSync";
import {
  DISABLED_EDIT_COMMAND_STATE,
  type EditCommand,
  type EditCommandState,
} from "@/lib/edit-command-state";

export type EditCommandStateContextValue = {
  state: EditCommandState;
  flush: (force?: boolean) => void;
  dispatch: (command: EditCommand) => void;
};

const EditCommandStateContext = createContext<EditCommandStateContextValue>({
  state: DISABLED_EDIT_COMMAND_STATE,
  flush: () => {},
  dispatch: () => {},
});

export function EditCommandStateProvider({ children }: { children: ReactNode }) {
  const value = useEditCommandStateSync();
  return (
    <EditCommandStateContext.Provider value={value}>{children}</EditCommandStateContext.Provider>
  );
}

export function useEditCommandState(): EditCommandStateContextValue {
  return useContext(EditCommandStateContext);
}
