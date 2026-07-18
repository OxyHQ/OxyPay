import { describe, test, expect } from "bun:test";
import {
  MAIN_POCKET_ACCOUNT,
  normalizePockets,
  nextAccountIndex,
  addPocket,
  renamePocket,
  removePocket,
  canDeletePocket,
  findPocket,
  type PocketInfo,
} from "./pockets";

const main: PocketInfo = { account: 0, name: "Main", createdAt: 1 };

describe("Pockets registry (pure)", () => {
  test("normalizePockets always includes the main Pocket", () => {
    expect(normalizePockets([])).toEqual([
      { account: MAIN_POCKET_ACCOUNT, name: "Main", createdAt: 0 },
    ]);
  });

  test("normalizePockets sorts by account and dedupes", () => {
    const out = normalizePockets([
      { account: 2, name: "B", createdAt: 3 },
      { account: 0, name: "Main", createdAt: 1 },
      { account: 2, name: "dupe", createdAt: 9 },
    ]);
    expect(out.map((p) => p.account)).toEqual([0, 2]);
    expect(findPocket(out, 2)?.name).toBe("B"); // first wins
  });

  test("nextAccountIndex is max(account) + 1", () => {
    expect(nextAccountIndex([main])).toBe(1);
    expect(
      nextAccountIndex([main, { account: 5, name: "X", createdAt: 2 }]),
    ).toBe(6);
  });

  test("addPocket appends at the next account index", () => {
    const out = addPocket([main], "Savings", 100);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ account: 1, name: "Savings", createdAt: 100 });
  });

  test("renamePocket updates only the target", () => {
    const list = addPocket([main], "Savings", 100);
    const out = renamePocket(list, 1, "Rent");
    expect(findPocket(out, 1)?.name).toBe("Rent");
    expect(findPocket(out, 0)?.name).toBe("Main");
  });

  test("removePocket drops the target but keeps the main Pocket", () => {
    const list = addPocket([main], "Savings", 100);
    expect(removePocket(list, 1).map((p) => p.account)).toEqual([0]);
    expect(removePocket(list, 0).map((p) => p.account)).toEqual([0, 1]); // main is protected
  });

  test("canDeletePocket refuses the main Pocket and unknown accounts", () => {
    const list = addPocket([main], "Savings", 100);
    expect(canDeletePocket(list, 0)).toBe(false);
    expect(canDeletePocket(list, 1)).toBe(true);
    expect(canDeletePocket(list, 9)).toBe(false);
  });
});
