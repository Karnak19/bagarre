// The smallest store that React's useSyncExternalStore can read: a value, a
// setter and change listeners. The flow stores (app.ts, lobby.ts, auth.ts)
// have the same getState / subscribe shape; this one is for values the frame
// loop publishes (the game view, the HUD model) and small bits of UI state.

export interface Readable<T> {
  getState(): T;
  /** Calls `fn` after every change. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
}

export class Store<T> implements Readable<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  getState = (): T => this.value;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(value: T) {
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const fn of this.listeners) fn();
  }

  /** Shallow merge, for object stores. */
  patch(patch: Partial<T>) {
    this.set({ ...this.value, ...patch });
  }
}
