import { useCallback, useState } from "react";

import {
  applyReduceMotionToDocument,
  getStoredReduceMotion,
  setStoredReduceMotion,
  type ReduceMotionPreference,
} from "@/lib/reduce-motion";

export function useReduceMotion() {
  const [reduceMotion, setReduceMotionState] = useState<ReduceMotionPreference>(() =>
    getStoredReduceMotion(),
  );

  const setReduceMotion = useCallback((pref: ReduceMotionPreference) => {
    setStoredReduceMotion(pref);
    setReduceMotionState(pref);
    applyReduceMotionToDocument(pref);
  }, []);

  return { reduceMotion, setReduceMotion };
}
