// Tests of the skin table (skins.ts): unique skin ids and files.
// (The guns' models are the client's GUN_VIEW, apps/client/src/items.ts,
// typed so that a gun without one doesn't compile.)
// Run with `bun run test` (or `bun test src/skins.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import { SKINS, isSkinId, randomSkin } from "./skins.ts";

describe("skins", () => {
  const ids = SKINS.map((s) => s.id);
  test(`every skin id is unique (${ids.length} skins)`, () => {
    expect(new Set(ids).size).toBe(ids.length);
  });
  test("every skin has its own file", () => {
    expect(new Set(SKINS.map((s) => s.file)).size).toBe(SKINS.length);
  });
  test("skin ids are lowercase slugs", () => {
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });
  test("isSkinId accepts only listed ids", () => {
    expect(isSkinId("nope")).toBe(false);
    expect(isSkinId(undefined)).toBe(false);
    expect(isSkinId(ids[0])).toBe(true);
  });

  // A guest's roll prefers a skin nobody wears, and falls back to any when all are taken.
  test("randomSkin picks the one free skin", () => {
    const taken = ids.slice(0, -1);
    expect(randomSkin(taken, () => 0.5)).toBe(ids[ids.length - 1]);
  });
  test("randomSkin still picks a skin when all are taken", () => {
    expect(isSkinId(randomSkin(ids, () => 0.99))).toBe(true);
  });
});
