// The bit of `bun:test` the spectate tests use, for `tsc -p apps/client`
// (the client has no bun-types). If bun-types is ever added, these merge
// with its declarations and this file can go.

declare module "bun:test" {
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    not: Matchers;
  }
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): Matchers;
}
