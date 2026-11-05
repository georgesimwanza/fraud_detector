"use client";

import { useEffect, useState, type DependencyList } from "react";

/** Subscribes to a lib/live listener for the component's lifetime. `undefined` until the first snapshot. */
export function useLive<T>(subscribe: (cb: (value: T) => void) => () => void, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T>();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => subscribe((v) => setValue(() => v)), deps);
  return value;
}
