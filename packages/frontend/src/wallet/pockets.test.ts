import { describe, test, expect } from "bun:test";
import {
  MAIN_POCKET_ACCOUNT,
  POCKET_COLORS,
  POCKET_EMOJIS,
  normalizePockets,
  nextAccountIndex,
  addPocket,
  renamePocket,
  updatePocketMeta,
  removePocket,
  canDeletePocket,
  findPocket,
  type PocketInfo,
} from "./pockets";

const main: PocketInfo = {
  account: 0,
  name: "Main",
  createdAt: 1,
  emoji: POCKET_EMOJIS[0],
  color: POCKET_COLORS[0],
};

describe("Pockets registry (pure)", () => {
  test("normalizePockets always includes the main Pocket", () => {
    expect(normalizePockets([])).toEqual([
      {
        account: MAIN_POCKET_ACCOUNT,
        name: "Main",
        createdAt: 0,
        emoji: POCKET_EMOJIS[0],
        color: POCKET_COLORS[0],
      },
    ]);
  });

  test("normalizePockets sorts by account and dedupes", () => {
    const out = normalizePockets([
      { account: 2, name: "B", createdAt: 3, emoji: "🎁", color: "#e5588a" },
      { account: 0, name: "Main", createdAt: 1, emoji: "💧", color: "#0064b3" },
      { account: 2, name: "dupe", createdAt: 9, emoji: "🚗", color: "#e29316" },
    ]);
    expect(out.map((p) => p.account)).toEqual([0, 2]);
    expect(findPocket(out, 2)?.name).toBe("B"); // first wins
  });

  test("normalizePockets defaults emoji/color for entries missing them (backward compat)", () => {
    // Simulates JSON persisted before emoji/color existed.
    const legacy = [
      { account: 0, name: "Main", createdAt: 0 },
      { account: 3, name: "Rent", createdAt: 5 },
    ] as PocketInfo[];
    const out = normalizePockets(legacy);
    expect(findPocket(out, 0)?.emoji).toBe(POCKET_EMOJIS[0 % POCKET_EMOJIS.length]);
    expect(findPocket(out, 0)?.color).toBe(POCKET_COLORS[0 % POCKET_COLORS.length]);
    expect(findPocket(out, 3)?.emoji).toBe(POCKET_EMOJIS[3 % POCKET_EMOJIS.length]);
    expect(findPocket(out, 3)?.color).toBe(POCKET_COLORS[3 % POCKET_COLORS.length]);
  });

  test("normalizePockets preserves emoji/color/goal already present", () => {
    const list = addPocket([main], "Savings", "🌱", "#12a46b", 500, 100);
    const out = normalizePockets(list);
    const savings = findPocket(out, 1);
    expect(savings?.emoji).toBe("🌱");
    expect(savings?.color).toBe("#12a46b");
    expect(savings?.goal).toBe(500);
  });

  test("nextAccountIndex is max(account) + 1", () => {
    expect(nextAccountIndex([main])).toBe(1);
    expect(
      nextAccountIndex([
        main,
        { account: 5, name: "X", createdAt: 2, emoji: "🚗", color: "#e29316" },
      ]),
    ).toBe(6);
  });

  test("addPocket appends at the next account index with the given emoji/color/goal", () => {
    const out = addPocket([main], "Savings", "🌱", "#12a46b", 500, 100);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      account: 1,
      name: "Savings",
      createdAt: 100,
      emoji: "🌱",
      color: "#12a46b",
      goal: 500,
    });
  });

  test("addPocket without a goal omits it", () => {
    const out = addPocket([main], "Rent", "🏠", "#e29316", undefined, 100);
    expect(out[1].goal).toBeUndefined();
  });

  test("renamePocket updates only the name, preserving emoji/color/goal", () => {
    const list = addPocket([main], "Savings", "🌱", "#12a46b", 500, 100);
    const out = renamePocket(list, 1, "Rent");
    const renamed = findPocket(out, 1);
    expect(renamed?.name).toBe("Rent");
    expect(renamed?.emoji).toBe("🌱");
    expect(renamed?.color).toBe("#12a46b");
    expect(renamed?.goal).toBe(500);
    expect(findPocket(out, 0)?.name).toBe("Main");
  });

  test("updatePocketMeta updates only the fields provided", () => {
    const list = addPocket([main], "Savings", "🌱", "#12a46b", 500, 100);
    const out = updatePocketMeta(list, 1, { color: "#0ea5a5" });
    const updated = findPocket(out, 1);
    expect(updated?.color).toBe("#0ea5a5");
    expect(updated?.emoji).toBe("🌱"); // untouched
    expect(updated?.goal).toBe(500); // untouched
    expect(updated?.name).toBe("Savings"); // untouched
  });

  test("updatePocketMeta with goal: null clears an existing goal", () => {
    const list = addPocket([main], "Savings", "🌱", "#12a46b", 500, 100);
    const out = updatePocketMeta(list, 1, { goal: null });
    expect(findPocket(out, 1)?.goal).toBeUndefined();
  });

  test("updatePocketMeta with goal: number sets a new goal", () => {
    const list = addPocket([main], "Rent", "🏠", "#e29316", undefined, 100);
    const out = updatePocketMeta(list, 1, { goal: 280 });
    expect(findPocket(out, 1)?.goal).toBe(280);
  });

  test("updatePocketMeta leaves other Pockets untouched", () => {
    const list = addPocket([main], "Savings", "🌱", "#12a46b", 500, 100);
    const out = updatePocketMeta(list, 1, { emoji: "🎯" });
    expect(findPocket(out, 0)).toEqual(main);
  });

  test("removePocket drops the target but keeps the main Pocket", () => {
    const list = addPocket([main], "Savings", "🌱", "#12a46b", 500, 100);
    expect(removePocket(list, 1).map((p) => p.account)).toEqual([0]);
    expect(removePocket(list, 0).map((p) => p.account)).toEqual([0, 1]); // main is protected
  });

  test("canDeletePocket refuses the main Pocket and unknown accounts", () => {
    const list = addPocket([main], "Savings", "🌱", "#12a46b", 500, 100);
    expect(canDeletePocket(list, 0)).toBe(false);
    expect(canDeletePocket(list, 1)).toBe(true);
    expect(canDeletePocket(list, 9)).toBe(false);
  });
});
