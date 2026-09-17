// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { createContext, useContext, type ReactNode } from "react";

export type UiPortalContainerGetter = () => HTMLElement | undefined;

const UiPortalContext = createContext<UiPortalContainerGetter>(() => undefined);

export function UiPortalProvider({
  getContainer,
  children,
}: {
  getContainer?: UiPortalContainerGetter;
  children: ReactNode;
}) {
  return (
    <UiPortalContext.Provider value={getContainer ?? (() => undefined)}>
      {children}
    </UiPortalContext.Provider>
  );
}

export function useUiPortalContainer(): HTMLElement | undefined {
  return useContext(UiPortalContext)();
}
