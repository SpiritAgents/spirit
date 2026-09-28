// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

import { createContext, useContext, type ReactNode } from "react";

export type UiPortalContainerGetter = () => HTMLElement | undefined;

export type UiPortalLocalPoint = { top: number; left: number };

export type UiPortalContextValue = {
  getContainer: UiPortalContainerGetter;
  toLocalPoint: (top: number, left: number) => UiPortalLocalPoint;
};

const defaultPortalContext: UiPortalContextValue = {
  getContainer: () => undefined,
  toLocalPoint: (top, left) => ({ top, left }),
};

const UiPortalContext = createContext<UiPortalContextValue>(defaultPortalContext);

export function UiPortalProvider({
  getContainer,
  toLocalPoint,
  children,
}: {
  getContainer?: UiPortalContainerGetter;
  toLocalPoint?: (top: number, left: number) => UiPortalLocalPoint;
  children: ReactNode;
}) {
  return (
    <UiPortalContext.Provider
      value={{
        getContainer: getContainer ?? defaultPortalContext.getContainer,
        toLocalPoint: toLocalPoint ?? defaultPortalContext.toLocalPoint,
      }}
    >
      {children}
    </UiPortalContext.Provider>
  );
}

export function useUiPortalContainer(): HTMLElement | undefined {
  return useContext(UiPortalContext).getContainer();
}

export function useUiPortalLocalPoint(): (top: number, left: number) => UiPortalLocalPoint {
  return useContext(UiPortalContext).toLocalPoint;
}
