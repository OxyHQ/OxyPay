import { describe, test, expect, mock } from "bun:test";
import { getNetwork, hexToBytes } from "@fairco.in/core";
import { KeyManager as FairKeyManager } from "./key-manager";

// Mock @oxyhq/core BEFORE importing the module under test.
let scopedResult: Uint8Array | null = new Uint8Array(32).fill(7);
const deriveScopedSeed = mock(async (_info: string) => scopedResult);
mock.module("@oxyhq/core", () => ({ KeyManager: { deriveScopedSeed } }));

const { deriveIdentitySeed, buildSeedSecret, OXYPAY_SEED_INFO, SEED_SECRET_PREFIX } =
  await import("./identity-wallet");

describe("deriveIdentitySeed", () => {
  test("passes the Oxy Pay FairCoin domain info and returns the seed", async () => {
    scopedResult = new Uint8Array(32).fill(7);
    const seed = await deriveIdentitySeed();
    expect(deriveScopedSeed).toHaveBeenCalledWith("oxypay/faircoin/v1");
    expect(OXYPAY_SEED_INFO).toBe("oxypay/faircoin/v1");
    expect(seed).toEqual(new Uint8Array(32).fill(7));
  });

  test("returns null when core has no identity key (web / keyless)", async () => {
    scopedResult = null;
    expect(await deriveIdentitySeed()).toBeNull();
  });
});

describe("FairCoin derivation from the identity seed", () => {
  test("is deterministic and uses coin type 1 on testnet", () => {
    const seed = new Uint8Array(32).fill(9);
    const a = FairKeyManager.fromSeed(seed, getNetwork("testnet")).getNextAddress();
    const b = FairKeyManager.fromSeed(seed, getNetwork("testnet")).getNextAddress();
    expect(a.address).toBe(b.address);
    expect(a.address.length).toBeGreaterThan(0);
    expect(a.path).toBe("m/44'/1'/0'/0/0");
  });

  test("buildSeedSecret round-trips losslessly through hexToBytes", () => {
    const seed = new Uint8Array(32).fill(3);
    const secret = buildSeedSecret(seed);
    expect(secret.startsWith(SEED_SECRET_PREFIX)).toBe(true);
    const back = hexToBytes(secret.slice(SEED_SECRET_PREFIX.length));
    const fromRoundTrip = FairKeyManager.fromSeed(back, getNetwork("testnet")).getNextAddress().address;
    const fromDirect = FairKeyManager.fromSeed(seed, getNetwork("testnet")).getNextAddress().address;
    expect(fromRoundTrip).toBe(fromDirect);
  });
});
