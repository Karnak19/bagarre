// How React reads the plain stores (app.ts, lobby.ts, auth.ts, hud.ts and the
// engine's per-frame view): useSyncExternalStore, always through a selector,
// so a component re-renders only when the few fields it shows change. The
// per-frame stores notify 60 times a second; a selector that returns the
// same value (Object.is, or the given equality) costs no render at all.

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Engine } from "../engine.ts";
import type { Readable } from "../store.ts";

export const EngineContext = createContext<Engine | null>(null);

export function useEngine(): Engine {
  const e = useContext(EngineContext);
  if (!e) throw new Error("useEngine outside <EngineContext>");
  return e;
}

type Sub = { subscribe(fn: () => void): () => void; getState(): unknown };

/** The whole state of a store (use for stores that change rarely). */
export function useStore<T>(store: Readable<T>): T {
  const s = store as Sub;
  const subscribe = useCallback((fn: () => void) => s.subscribe(fn), [s]);
  return useSyncExternalStore(subscribe, () => s.getState() as T);
}

/**
 * One derived value from a store. `select` may return a fresh object each
 * call: with `isEqual` (e.g. `shallowEqual`), an equal result keeps the
 * previous one, so React sees no change.
 */
export function useSelector<S, T>(store: Readable<S>, select: (s: S) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const s = store as Sub;
  const subscribe = useCallback((fn: () => void) => s.subscribe(fn), [s]);
  const cache = useRef<{ state: S; select: (s: S) => T; value: T } | null>(null);
  const getSnapshot = () => {
    const state = s.getState() as S;
    const c = cache.current;
    if (c && Object.is(c.state, state) && c.select === select) return c.value;
    const value = select(state);
    if (c && isEqual(c.value, value)) {
      c.state = state;
      c.select = select;
      return c.value;
    }
    cache.current = { state, select, value };
    return value;
  };
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Runs `effect` with the store's state now and on every change, outside
 * React's render: for values that move every frame (a cooldown sweep, a
 * reload bar, the debug line), written straight to a DOM node through a ref.
 */
export function useStoreEffect<S>(store: Readable<S>, effect: (s: S) => void) {
  const fn = useRef(effect);
  fn.current = effect;
  useLayoutEffect(() => {
    const s = store as Sub;
    const run = () => fn.current(s.getState() as S);
    run();
    return s.subscribe(run);
  }, [store]);
}

/** Equality for flat records and arrays of primitives. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** Deep equality for small JSON-like values (the scoreboard model). */
export function jsonEqual<T>(a: T, b: T): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/** Matches a media query, live. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (fn: () => void) => {
      const m = matchMedia(query);
      m.addEventListener("change", fn);
      return () => m.removeEventListener("change", fn);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
