// Tests of the battle royale's host start (modes.ts): who the host is
// (`hostOf`), which start requests are honoured (`acceptsStart`), and which
// modes wait for the host (`hostStarts`).
// Run with `bun run test` (or `bun test src/host.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import { parseStart } from "./messages.ts";
import { DUEL_RULES, FFA_RULES, MODES, ROYALE_RULES, TEAM_RULES, acceptsStart, hostOf } from "./modes.ts";

describe("hostOf", () => {
  const all = () => true;
  test("the first in join order", () => {
    expect(hostOf(["a", "b", "c"], all)).toBe("a");
  });
  test("nobody: no host", () => {
    expect(hostOf([], all)).toBe("");
  });
  test("the host gone (a royale leaver keeping a seat for the result): the next one in join order", () => {
    expect(hostOf(["a", "b", "c"], (id) => id !== "a")).toBe("b");
    expect(hostOf(["a", "b", "c"], (id) => id === "c")).toBe("c");
  });
  test("nobody seated: no host", () => {
    expect(hostOf(["a", "b"], () => false)).toBe("");
  });
});

describe("acceptsStart", () => {
  const ok = { phase: "waiting", sender: "a", host: "a", ready: true };
  test("the host, waiting, with enough players: starts", () => {
    expect(acceptsStart(ROYALE_RULES, ok)).toBe(true);
  });
  test("not the host: ignored", () => {
    expect(acceptsStart(ROYALE_RULES, { ...ok, sender: "b" })).toBe(false);
  });
  test("too few players (not ready): ignored", () => {
    expect(acceptsStart(ROYALE_RULES, { ...ok, ready: false })).toBe(false);
  });
  test("outside the waiting phase: ignored", () => {
    for (const phase of ["warmup", "playing", "ended"]) expect(acceptsStart(ROYALE_RULES, { ...ok, phase })).toBe(false);
  });
  test("no host (an empty sender never matches an empty host)", () => {
    expect(acceptsStart(ROYALE_RULES, { ...ok, sender: "", host: "" })).toBe(false);
  });
  test("a mode that starts on its own ignores it", () => {
    for (const rules of [DUEL_RULES, FFA_RULES, TEAM_RULES]) expect(acceptsStart(rules, ok)).toBe(false);
  });
});

describe("hostStarts", () => {
  test("only the battle royale waits for its host, with no countdown", () => {
    expect(Object.values(MODES).filter((r) => r.hostStarts).map((r) => r.mode)).toEqual(["royale"]);
    expect(ROYALE_RULES.countdown).toBe(0);
  });
  test("the other modes keep their start", () => {
    expect(DUEL_RULES.countdown).toBe(0);
    expect(FFA_RULES.countdown).toBeGreaterThan(0);
    expect(TEAM_RULES.countdown).toBeGreaterThan(0);
  });
});

describe("parseStart", () => {
  test("a plain object, its fields ignored", () => {
    expect(parseStart({})).toEqual({});
    expect(parseStart({ now: true })).toEqual({});
  });
  test("anything else is refused", () => {
    for (const raw of [null, undefined, 1, "start", [], true]) expect(parseStart(raw)).toBeNull();
  });
});
