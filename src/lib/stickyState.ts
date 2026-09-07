import { useEffect, useState } from "react";

/** Switching tabs unmounts the view, which would otherwise throw away every
 * filter and result and reset back to the defaults. Values stored here
 * survive unmount for the life of the page, so returning to a tab lands you
 * where you left off. */
const remembered = new Map<string, unknown>();

export function useStickyState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() =>
    remembered.has(key) ? (remembered.get(key) as T) : initial,
  );
  useEffect(() => {
    remembered.set(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}
