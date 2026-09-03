# Oxy-Identity Wallet & Onboarding (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Oxy Pay's `hasWallet()`-gated seed-phrase onboarding with sign-in-with-Oxy first, derive the single FairCoin wallet deterministically from the user's Oxy self-sovereign identity key (self-custody, native-only), route keyless accounts to create an Oxy ID, and remove the multi-wallet UI.

**Architecture:** A new `KeyManager.deriveScopedSeed(info)` in `@oxyhq/core` HKDFs the on-device identity private key into a 32-byte, domain-separated seed **without ever exposing the raw key**. Oxy Pay feeds that seed into the existing FairCoin HD `KeyManager.fromSeed(seed, network)` — no BIP39 mnemonic, no `mnemonicToSeed`. The entry screen (`app/index.tsx`) becomes: signed-out → "Sign in with Oxy"; signed-in but keyless → "Set up your Oxy ID" (Commons handoff); otherwise derive the wallet and enter `(tabs)`. Crypto lands once upstream in `@oxyhq/core` (published, then consumed); only product wiring diverges in Oxy Pay.

**Tech Stack:** `@oxyhq/core` (secp256k1/`elliptic`, `@noble/hashes` HKDF, Jest), `@oxyhq/services` (`OxyProvider`/`useOxy`), Expo SDK 57 / RN 0.86 / expo-router, Zustand, `@fairco.in/core` (FairCoin HD via `@scure/bip32`), Bun (`bun test` for the app), bun workspaces.

## Global Constraints

- **Self-custody / MiCA:** FairCoin spending keys are derived and held ONLY on the user's device; the backend and Oxy servers NEVER see, hold, or can reconstruct a spending key (spec §2.1).
- **Keys never leave the device:** identity/derived keys live in Keychain/SecureStore; the wallet is **native-only** (spec §2.2, §9).
- **Native-only wallet:** the identity key is `null` on web → the wallet is disabled on web via an explicit guard, no crash (spec §9).
- **Fix upstream, never patch the consumer:** the seed-derivation primitive lands ONCE in `@oxyhq/core` (`deriveScopedSeed`); Oxy Pay never re-implements HKDF or handles the raw identity key (spec §2.4).
- **Publish before consume:** republish `@oxyhq/core` and verify propagation (clean external install + import) BEFORE Oxy Pay bumps it (`~/Oxy/OxyHQServices/AGENTS.md`).
- **Derivation recipe is fixed:** wallet seed = `deriveScopedSeed("oxypay/faircoin/v1")` → `KeyManager.fromSeed(seed, network)`. MUST NOT route HKDF output through `mnemonicToSeed` (BIP39 does not validate its input → silently wrong seed) (spec §4.1).
- **bun only:** `bun`/`bunx`, never npm/npx. Regenerate and commit `bun.lock` in the SAME commit as any `package.json` bump.
- **No** `as any`, `@ts-ignore`/`@ts-expect-error`, `!` non-null assertions, `console.log`, or silent `catch {}`. TypeScript strict.
- **Avoid `useEffect`** where derived state / event handlers suffice; extract routing/decision logic into PURE functions and unit-test those.
- **expo-router single authority:** `app/index.tsx` is the sole authority for the entry/group swap; it renders neutral in-place branches and never has a child screen also cross the boundary on the same signal.
- **Verify on a real FOREGROUNDED native device/emulator:** Bloom/Reanimated/expo-router races never show in jest or a backgrounded tab.
- **Security gate:** a `security-reviewer` audit of the derivation scheme is MANDATORY before any mainnet build (spec §2.3, §8). Everything in this plan is tested on **testnet** only.
- **Test-runner split:** `@oxyhq/core` uses **Jest** (`bun run test` → jest); the Oxy Pay frontend uses **Bun's native runner** (`bun test src`; import from `"bun:test"`, mock with `mock.module`). Never cross them.

---

## File Structure

**Repo A — `~/Oxy/OxyHQServices` (`@oxyhq/core`, publish gate):**
- Modify: `packages/core/src/crypto/keyManager.ts` — add `deriveScopedSeed(info)`, the KDF salt const, and `utf8ToBytes`/`hexToBytes` helpers. `KeyManager` is already exported from `packages/core/src/index.ts:241`, so no index edit is needed.
- Create: `packages/core/src/crypto/__tests__/scopedSeed.test.ts` — determinism, domain separation, no-leak, web/no-identity → null, pinned vector.
- Modify: `packages/core/package.json` — version bump `12.5.4` → `12.6.0`.

**Repo B — `~/Oxy/OxyPay/packages/frontend` (consumer):**
- Modify: `package.json` — bump `@oxyhq/core` `^12.5.4` → `^12.6.0`.
- Create: `src/wallet/identity-wallet.ts` — `OXYPAY_SEED_INFO`, `OXY_IDENTITY_WALLET_ID`, `SEED_SECRET_PREFIX`, `deriveIdentitySeed()`, `buildSeedSecret()`.
- Create: `src/wallet/identity-wallet.test.ts` — bun:test.
- Modify: `src/wallet/wallet-store.ts` — add the `seed:` secret branch to `initialize`, force `hasBackedUp` for the identity wallet, add `initializeFromIdentity` action + `IdentityInitResult` type.
- Create: `src/wallet/entry-route.ts` — pure `decideEntryRoute()` + `EntryRoute` type.
- Create: `src/wallet/entry-route.test.ts` — bun:test.
- Modify: `app/index.tsx` — Oxy-first routing (replaces the `hasWallet()` gate).
- Modify: `app/onboarding/_layout.tsx` — remove `welcome`/`create`/`restore` screen registrations (keep `pin-setup`).
- Delete: `app/onboarding/welcome.tsx`, `app/onboarding/create.tsx`, `app/onboarding/restore.tsx`.
- Create: `src/wallet/keyless.ts` — `resolveKeylessAction()`, Commons handoff URL consts.
- Create: `src/wallet/keyless.test.ts` — bun:test.
- Create: `src/ui/components/CreateOxyIdView.tsx` — keyless "Set up your Oxy ID" screen (Commons handoff).
- Modify: `app/(tabs)/index.tsx` — remove `WalletSwitcherSheet` mount + its control.
- Modify: `app/(tabs)/settings.tsx` — remove the "Wallets" row + `router.push("/wallets")`.
- Modify: `app/_layout.tsx` — remove the `wallets` `Stack.Screen` registration.
- Delete: `app/wallets.tsx`, `src/ui/sheets/WalletSwitcherSheet.tsx`.
- Modify: `app.json` — iOS `keychain-access-groups` entitlement + register `./plugins/withSharedUserId`.
- Create: `plugins/withSharedUserId.js` — Android `sharedUserId` config plugin (mirrors Commons).

**Cross-repo gate:** Repo B tasks (3–7) are BLOCKED on Task 2 (the `@oxyhq/core@12.6.0` publish). Do not start Task 3 until Task 2's propagation check is green.

---

## Task 1: `@oxyhq/core` — `KeyManager.deriveScopedSeed`

Adds the upstream primitive: HKDF the on-device identity private key into a 32-byte, domain-separated seed, without exposing the raw key. This is the "fix de raíz" (spec §5); Oxy Pay only consumes it.

**Files:**
- Modify: `~/Oxy/OxyHQServices/packages/core/src/crypto/keyManager.ts`
- Test: `~/Oxy/OxyHQServices/packages/core/src/crypto/__tests__/scopedSeed.test.ts`

**Interfaces:**
- Consumes: `KeyManager.getSharedPrivateKey()` / `getPrivateKey()` (existing, `keyManager.ts:381,1021`), `KeyManager.canonicalPrivateKey()` (private static, `keyManager.ts:221`), `hkdfSha256(ikm, salt, info, length)` (`crypto/kdf.ts:29`), `isWebPlatform()` (`keyManager.ts:133`).
- Produces: `static deriveScopedSeed(info: string): Promise<Uint8Array | null>` — returns 32 bytes, or `null` on web / when no identity key exists. Referenced verbatim by Oxy Pay Task 3.

- [ ] **Step 1: Write the failing test**

Create `~/Oxy/OxyHQServices/packages/core/src/crypto/__tests__/scopedSeed.test.ts`. The mocks mirror `keyManager.test.ts` (in-memory `expo-secure-store`/`expo-crypto` + the `@oxyhq/protocol` platform-loader override). The pinned vectors were computed independently with `@noble/hashes` HKDF-SHA256 over `ikm = bytes("aa"×32)`, `salt = "oxy-identity-scoped-seed-v1"`.

```ts
import { setPlatformOS } from '../../utils/platform';

jest.mock(
  'expo-secure-store',
  () => {
    const store = new Map<string, string>();
    return {
      __esModule: true,
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
      WHEN_UNLOCKED: 'WHEN_UNLOCKED',
      setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
      getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
      deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
      __resetStore__: () => store.clear(),
    };
  },
  { virtual: true },
);

jest.mock(
  'expo-crypto',
  () => ({
    __esModule: true,
    getRandomBytes: (length: number) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = (Math.random() * 256) & 0xff;
      return out;
    },
    digestStringAsync: async () => '0'.repeat(64),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  }),
  { virtual: true },
);

jest.mock('@oxyhq/protocol', () => ({
  __esModule: true,
  ...jest.requireActual('@oxyhq/protocol'),
  loadExpoCrypto: async () => require('expo-crypto'),
  loadSecureStore: async () => require('expo-secure-store'),
  loadNodeCrypto: async () => require('crypto'),
  loadSharedIdentityBridge: async () => null,
}));

const FIXED_PRIV = 'aa'.repeat(32);
const EXPECTED_FAIR = '4b90d900a11b0a1737ed643db3446e5f28035d86f1a4fda92474ea8ab152adf5';
const EXPECTED_OTHER = 'cdedf1f076b0f4766c769e55bc1e90c5bf44d8630f6e5fb147615ee7c330c905';
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

describe('KeyManager.deriveScopedSeed', () => {
  let KeyManager: typeof import('../keyManager').KeyManager;

  beforeEach(async () => {
    jest.resetModules();
    setPlatformOS('ios');
    const secureStore = (await import('expo-secure-store' as string)) as unknown as {
      __resetStore__: () => void;
    };
    secureStore.__resetStore__();
    const km = await import('../keyManager');
    KeyManager = km.KeyManager;
    // Store a known shared identity key so derivation is deterministic.
    await KeyManager.importSharedIdentity(FIXED_PRIV);
  });

  it('derives the pinned 32-byte seed for a fixed identity + info', async () => {
    const seed = await KeyManager.deriveScopedSeed('oxypay/faircoin/v1');
    if (!seed) throw new Error('expected a seed');
    expect(seed).toHaveLength(32);
    expect(toHex(seed)).toBe(EXPECTED_FAIR);
  });

  it('is deterministic (same identity + info → identical seed)', async () => {
    const a = await KeyManager.deriveScopedSeed('oxypay/faircoin/v1');
    const b = await KeyManager.deriveScopedSeed('oxypay/faircoin/v1');
    if (!a || !b) throw new Error('expected seeds');
    expect(toHex(a)).toBe(toHex(b));
  });

  it('domain-separates by info (different info → different seed)', async () => {
    const fair = await KeyManager.deriveScopedSeed('oxypay/faircoin/v1');
    const other = await KeyManager.deriveScopedSeed('oxypay/other/v1');
    if (!fair || !other) throw new Error('expected seeds');
    expect(toHex(other)).toBe(EXPECTED_OTHER);
    expect(toHex(fair)).not.toBe(toHex(other));
  });

  it('never returns the raw private key (no leak)', async () => {
    const seed = await KeyManager.deriveScopedSeed('oxypay/faircoin/v1');
    if (!seed) throw new Error('expected a seed');
    expect(toHex(seed)).not.toBe(FIXED_PRIV);
  });

  it('returns null on web (no identity key available)', async () => {
    setPlatformOS('web');
    expect(await KeyManager.deriveScopedSeed('oxypay/faircoin/v1')).toBeNull();
  });

  it('returns null when no identity exists on the device', async () => {
    const secureStore = (await import('expo-secure-store' as string)) as unknown as {
      __resetStore__: () => void;
    };
    secureStore.__resetStore__();
    expect(await KeyManager.deriveScopedSeed('oxypay/faircoin/v1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/Oxy/OxyHQServices/packages/core && bun run test src/crypto/__tests__/scopedSeed.test.ts`
Expected: FAIL — `KeyManager.deriveScopedSeed is not a function`.

- [ ] **Step 3: Add the imports + helpers to `keyManager.ts`**

At the top of `keyManager.ts`, add the KDF import next to the existing crypto imports (after line 12, the `logger` import):

```ts
import { hkdfSha256 } from './kdf';
```

Immediately after the `const ec = new EC('secp256k1');` line (`keyManager.ts:80`), add:

```ts
/**
 * HKDF salt that domain-separates every identity-scoped seed produced by
 * {@link KeyManager.deriveScopedSeed}. Versioned so a future scheme change is a
 * new, non-colliding tag. The per-app domain (e.g. Oxy Pay's FairCoin wallet)
 * is carried by the caller's `info` string, not this salt.
 */
const SCOPED_SEED_KDF_SALT = 'oxy-identity-scoped-seed-v1';

/** UTF-8 encode an ASCII label to bytes (HKDF salt/info). */
function utf8ToBytes(label: string): Uint8Array {
  return new TextEncoder().encode(label);
}

/** Decode a hex string to bytes. Inverse of {@link uint8ArrayToHex}. */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
```

- [ ] **Step 4: Add the `deriveScopedSeed` method**

Add this method inside the `KeyManager` class, immediately before `shortenPublicKey` (`keyManager.ts:1566`):

```ts
  /**
   * Derive a 32-byte, domain-separated seed from the on-device Oxy identity
   * private key via HKDF-SHA256, WITHOUT ever exposing the raw private key.
   *
   * The domain separation is carried by `info` (e.g. `"oxypay/faircoin/v1"`),
   * so distinct apps/purposes get independent seeds from the same identity.
   * The output is HKDF keying material, never the private key itself — a
   * consumer (e.g. Oxy Pay's FairCoin HD wallet) can feed it straight into
   * `HDKey.fromMasterSeed` and never touches the identity key.
   *
   * Key source (native only): prefers the shared ecosystem identity written to
   * `group.so.oxy.shared` (what a Relying Party like Oxy Pay reads), then falls
   * back to this device's primary identity (Commons/Accounts). Both reproduce
   * from the user's Oxy recovery phrase, so the derived seed is recoverable.
   *
   * @param info Context/domain-binding label (distinct labels → independent seeds).
   * @returns 32 bytes of derived keying material, or `null` on web / when no
   *          identity key is available on this device.
   */
  static async deriveScopedSeed(info: string): Promise<Uint8Array | null> {
    if (isWebPlatform()) {
      return null;
    }
    const privateKey =
      (await KeyManager.getSharedPrivateKey()) ?? (await KeyManager.getPrivateKey());
    if (!privateKey) {
      return null;
    }
    const ikm = hexToBytes(KeyManager.canonicalPrivateKey(privateKey));
    return hkdfSha256(ikm, utf8ToBytes(SCOPED_SEED_KDF_SALT), utf8ToBytes(info), 32);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ~/Oxy/OxyHQServices/packages/core && bun run test src/crypto/__tests__/scopedSeed.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full core suite (no regressions) + typecheck the build**

Run: `cd ~/Oxy/OxyHQServices/packages/core && bun run test && bun run build`
Expected: all core tests green (baseline **722** + 6 new = **728**); `bun run build` (CJS + ESM + types) emits `dist/` with no `tsc` errors.

- [ ] **Step 7: Commit**

```bash
cd ~/Oxy/OxyHQServices
git add packages/core/src/crypto/keyManager.ts packages/core/src/crypto/__tests__/scopedSeed.test.ts
git commit -m "feat(core): add KeyManager.deriveScopedSeed (identity→domain-separated seed)"
```

---

## Task 2: Publish `@oxyhq/core@12.6.0` (cross-repo gate)

Ships the new primitive so Oxy Pay can consume it. `deriveScopedSeed` is additive (a new static method) → **minor** bump `12.5.4` → `12.6.0`. It imports no new `@oxyhq/contracts` symbol, so contracts does NOT need republishing first. Follow the publish rules in `~/Oxy/OxyHQServices/AGENTS.md` (commit+push to `main` FIRST, pack+inspect, verify propagation, bump downstream peers). This task has no unit test; its deliverable is a verified npm release.

**Files:**
- Modify: `~/Oxy/OxyHQServices/packages/core/package.json` (version).
- Modify (as needed): downstream peer ranges the `publish` skill touches in the OxyHQServices workspace.

**Interfaces:**
- Consumes: Task 1's committed code.
- Produces: `@oxyhq/core@12.6.0` on npm exposing `KeyManager.deriveScopedSeed`. Task 3 depends on this being installable.

- [ ] **Step 1: Bump the version**

Edit `~/Oxy/OxyHQServices/packages/core/package.json`: `"version": "12.5.4"` → `"version": "12.6.0"`.

- [ ] **Step 2: Regenerate the lockfile + build + full test**

Run:
```bash
cd ~/Oxy/OxyHQServices
bun install
bun run core:build
cd packages/core && bun run test
```
Expected: `bun.lock` updated (if changed), `dist/` rebuilt, **728** core tests green.

- [ ] **Step 3: Commit the version bump + lockfile together and push to `main`**

```bash
cd ~/Oxy/OxyHQServices
git add packages/core/package.json bun.lock
git commit -m "chore(core): release 12.6.0 (deriveScopedSeed)"
git push origin main
```
(Per AGENTS: NEVER `bun publish` from uncommitted state — the version + content must be committed and on `main` first, or the version number is permanently burned.)

- [ ] **Step 4: Pack + inspect the tarball, then publish**

Use the **`publish` skill** for `@oxyhq/core` (it runs the version-bump/pack/`bun publish`, then bumps + type-checks downstream consumers in the OxyHQServices workspace). Follow its prompts. If publishing manually instead:
```bash
cd ~/Oxy/OxyHQServices/packages/core
bun pm pack   # inspect: confirm dist/ present, no workspace:* left unresolved
bun publish
```
Expected: `@oxyhq/core@12.6.0` published.

- [ ] **Step 5: Verify propagation with a clean external install + import**

Run:
```bash
cd $(mktemp -d)
bun add @oxyhq/core@12.6.0
bun -e "import('@oxyhq/core').then(m => console.log(typeof m.KeyManager.deriveScopedSeed))"
```
Expected: prints `function`. Do NOT proceed to Task 3 until this is green.

- [ ] **Step 6: Confirm downstream (OxyHQServices) consumers still typecheck**

The `publish` skill bumps `@oxyhq/services`' `@oxyhq/core` range. `deriveScopedSeed` is additive, so no peer break is expected. Verify:
```bash
cd ~/Oxy/OxyHQServices && bun run services:build
```
Expected: green. Commit any peer-range/lockfile changes the skill made (path-scoped), then push.

---

## Task 3: Oxy Pay — wallet initialization from the identity seed

Bumps `@oxyhq/core`, adds the bridge from the identity seed to the FairCoin HD wallet, and adds a store action that boots the single identity-derived wallet (guarding web + keyless). No mnemonic, no `mnemonicToSeed`.

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/package.json` (`@oxyhq/core` `^12.5.4` → `^12.6.0`).
- Create: `~/Oxy/OxyPay/packages/frontend/src/wallet/identity-wallet.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/identity-wallet.test.ts`
- Modify: `~/Oxy/OxyPay/packages/frontend/src/wallet/wallet-store.ts`

**Interfaces:**
- Consumes: `KeyManager.deriveScopedSeed(info)` from `@oxyhq/core` (Task 1); `KeyManager.fromSeed(seed, network)` from `src/wallet/key-manager.ts:81`; `getNetwork`, `bytesToHex`, `hexToBytes` from `@fairco.in/core`; the existing store `initialize(mnemonic, walletId?, onReady?)`.
- Produces:
  - `OXYPAY_SEED_INFO = "oxypay/faircoin/v1"`, `OXY_IDENTITY_WALLET_ID = "oxy-identity"`, `SEED_SECRET_PREFIX = "seed:"` (const strings).
  - `deriveIdentitySeed(): Promise<Uint8Array | null>`
  - `buildSeedSecret(seed: Uint8Array): string`
  - Store: `initializeFromIdentity(onReady?: () => void): Promise<IdentityInitResult>` where `type IdentityInitResult = "initialized" | "no-identity" | "web-unsupported"`. Consumed by Task 4.

- [ ] **Step 1: Bump `@oxyhq/core` in the frontend + reinstall**

Edit `~/Oxy/OxyPay/packages/frontend/package.json`: `"@oxyhq/core": "^12.5.4"` → `"@oxyhq/core": "^12.6.0"`. Then:
```bash
cd ~/Oxy/OxyPay && bun install
```
Expected: `bun.lock` resolves `@oxyhq/core@12.6.0`. (Commit the lockfile with the bump in Step 8.)

- [ ] **Step 2: Write the failing test**

Create `~/Oxy/OxyPay/packages/frontend/src/wallet/identity-wallet.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/wallet/identity-wallet.test.ts`
Expected: FAIL — cannot resolve `./identity-wallet`.

- [ ] **Step 4: Write the `identity-wallet.ts` module**

Create `~/Oxy/OxyPay/packages/frontend/src/wallet/identity-wallet.ts`:

```ts
/**
 * Bridge from the Oxy self-sovereign identity to the single FairCoin wallet.
 *
 * The wallet seed is derived on-device from the Oxy identity key via
 * `@oxyhq/core`'s `KeyManager.deriveScopedSeed` (HKDF, domain-separated) — the
 * raw identity private key never enters this app. The 32-byte seed feeds the
 * FairCoin HD `KeyManager.fromSeed` directly; it is NEVER routed through a BIP39
 * mnemonic (`mnemonicToSeed` does not validate its input and would silently
 * derive a different, wrong seed — spec §4.1).
 */

import { KeyManager as IdentityKeyManager } from "@oxyhq/core";
import { bytesToHex } from "@fairco.in/core";

/** HKDF `info` binding the derived seed to Oxy Pay's FairCoin wallet. */
export const OXYPAY_SEED_INFO = "oxypay/faircoin/v1";

/** Fixed wallet id for the single identity-derived wallet (SQLite namespace). */
export const OXY_IDENTITY_WALLET_ID = "oxy-identity";

/**
 * Marker prefix for the in-memory "secret" the store's `initialize` accepts to
 * build a KeyManager straight from a 32-byte seed (mirrors the `xpub:` marker).
 * The seed is NEVER persisted — it is re-derived from the identity each boot.
 */
export const SEED_SECRET_PREFIX = "seed:";

/**
 * Derive the FairCoin wallet seed from the on-device Oxy identity, or `null`
 * on web / when the account is keyless (no identity key). Native-only.
 */
export async function deriveIdentitySeed(): Promise<Uint8Array | null> {
  return IdentityKeyManager.deriveScopedSeed(OXYPAY_SEED_INFO);
}

/** Encode a 32-byte seed as the `seed:<hex>` secret the store consumes. */
export function buildSeedSecret(seed: Uint8Array): string {
  return `${SEED_SECRET_PREFIX}${bytesToHex(seed)}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/wallet/identity-wallet.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire the `seed:` branch + `initializeFromIdentity` into the store**

In `~/Oxy/OxyPay/packages/frontend/src/wallet/wallet-store.ts`:

(a) Add imports near the `@fairco.in/core` and secure-store imports (top of file):
```ts
import { Platform } from "react-native";
import {
  OXY_IDENTITY_WALLET_ID,
  SEED_SECRET_PREFIX,
  buildSeedSecret,
  deriveIdentitySeed,
} from "./identity-wallet";
```

(b) Add the result type next to `FeeLevel` (`wallet-store.ts:76`):
```ts
export type IdentityInitResult = "initialized" | "no-identity" | "web-unsupported";
```

(c) Add `initializeFromIdentity` to the `WalletState` interface, right after the `initialize` signature (`wallet-store.ts:174`):
```ts
  /**
   * Bring up the SINGLE Oxy-identity-derived wallet. Derives the seed from the
   * on-device identity, builds the KeyManager, and runs the normal init. No
   * mnemonic. Native-only; returns "web-unsupported" on web and "no-identity"
   * for a keyless account (routes onboarding to create an Oxy ID).
   */
  initializeFromIdentity: (onReady?: () => void) => Promise<IdentityInitResult>;
```

(d) In the `initialize` action, add the `seed:` branch. Find the KeyManager-construction block (`wallet-store.ts:991`) and insert the new branch BEFORE the `xpub:` check:
```ts
      if (mnemonic.startsWith(SEED_SECRET_PREFIX)) {
        // Identity-derived wallet: the "secret" carries the 32-byte HKDF seed
        // directly (never persisted, re-derived from the Oxy identity each
        // boot). Build straight from the seed — no BIP39 detour.
        const seed = hexToBytes(mnemonic.slice(SEED_SECRET_PREFIX.length));
        keyManager = KeyManager.fromSeed(seed, networkConfig);
      } else if (mnemonic.startsWith(XPUB_MARKER_PREFIX)) {
```
(The existing `else if (mnemonic.startsWith(XPUB_MARKER_PREFIX))` and its trailing `else` stay unchanged.)

(e) Force `hasBackedUp` for the identity wallet so the "back up your wallet" banner never shows (the Oxy recovery phrase is the backup — spec §4.2). Find the `backedUp` computation (`wallet-store.ts:1054`) and replace it:
```ts
      const backedUp =
        activeId === OXY_IDENTITY_WALLET_ID
          ? true
          : activeId && !watchOnly
            ? await isWalletBackedUp(activeId)
            : true;
```

(f) Add the `initializeFromIdentity` action. Place it immediately after the `initialize` action's closing (after `wallet-store.ts:1258`, before `createWallet`):
```ts
  initializeFromIdentity: async (onReady?: () => void): Promise<IdentityInitResult> => {
    // The wallet is native-only: the identity key is unavailable on web
    // (spec §9). Distinguish "web" (permanently unsupported) from "no-identity"
    // (a keyless account that can create an Oxy ID) so onboarding routes each
    // correctly.
    if (Platform.OS === "web") {
      return "web-unsupported";
    }
    const seed = await deriveIdentitySeed();
    if (!seed) {
      return "no-identity";
    }
    await get().initialize(buildSeedSecret(seed), OXY_IDENTITY_WALLET_ID, onReady);
    return "initialized";
  },
```

- [ ] **Step 7: Typecheck**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun run typecheck`
Expected: no `tsc` errors.

- [ ] **Step 8: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/package.json bun.lock \
  packages/frontend/src/wallet/identity-wallet.ts \
  packages/frontend/src/wallet/identity-wallet.test.ts \
  packages/frontend/src/wallet/wallet-store.ts
git commit -m "feat(oxypay): derive the single wallet from the Oxy identity seed"
```

---

## Task 4: Oxy Pay — Oxy-first onboarding routing + remove seed onboarding

Replaces the `hasWallet()` entry gate with the sign-in-with-Oxy → identity → wallet flow, and removes the seed-phrase onboarding screens from the default path. The routing decision is a PURE function (unit-tested); `app/index.tsx` wires it.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/wallet/entry-route.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/entry-route.test.ts`
- Modify: `~/Oxy/OxyPay/packages/frontend/app/index.tsx`
- Modify: `~/Oxy/OxyPay/packages/frontend/app/onboarding/_layout.tsx`
- Delete: `app/onboarding/welcome.tsx`, `app/onboarding/create.tsx`, `app/onboarding/restore.tsx`

**Interfaces:**
- Consumes: `useOxy()` from `@oxyhq/services` (`isAuthResolved`, `isAuthenticated`, `signIn`); `initializeFromIdentity` + `IdentityInitResult` (Task 3); `hasPin()` from `src/storage/secure-store`; `markNoPinUnlocked`/`resolveInitialLock` from `src/wallet/lock-store`.
- Produces:
  - `type EntryRoute = { kind: "loading" | "signin" | "create-identity" | "needs-pin" | "ready" | "web-unsupported" }`
  - `decideEntryRoute(input: { isAuthResolved: boolean; isAuthenticated: boolean; identityInit: IdentityInitResult | null; hasPinConfigured: boolean | null }): EntryRoute`

- [ ] **Step 1: Write the failing test**

Create `~/Oxy/OxyPay/packages/frontend/src/wallet/entry-route.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { decideEntryRoute } from "./entry-route";

describe("decideEntryRoute", () => {
  test("waits while auth is unresolved", () => {
    expect(decideEntryRoute({ isAuthResolved: false, isAuthenticated: false, identityInit: null, hasPinConfigured: null }).kind).toBe("loading");
  });

  test("signed out → sign in with Oxy", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: false, identityInit: null, hasPinConfigured: null }).kind).toBe("signin");
  });

  test("signed in, identity init pending → loading", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: null, hasPinConfigured: null }).kind).toBe("loading");
  });

  test("signed in on web → wallet unsupported", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "web-unsupported", hasPinConfigured: null }).kind).toBe("web-unsupported");
  });

  test("signed in, keyless account → create Oxy ID", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "no-identity", hasPinConfigured: null }).kind).toBe("create-identity");
  });

  test("wallet ready, PIN state unknown → loading", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "initialized", hasPinConfigured: null }).kind).toBe("loading");
  });

  test("wallet ready, no PIN yet → needs PIN setup", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "initialized", hasPinConfigured: false }).kind).toBe("needs-pin");
  });

  test("wallet ready, PIN set → ready", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "initialized", hasPinConfigured: true }).kind).toBe("ready");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/wallet/entry-route.test.ts`
Expected: FAIL — cannot resolve `./entry-route`.

- [ ] **Step 3: Write `entry-route.ts`**

Create `~/Oxy/OxyPay/packages/frontend/src/wallet/entry-route.ts`:

```ts
/**
 * Pure entry-routing decision for `app/index.tsx`. Kept side-effect-free so the
 * whole decision table is unit-testable without a renderer (the screen only
 * reads auth/wallet state and renders the branch this returns).
 *
 * Order (spec §4.2): resolve auth → sign in with Oxy → (native) derive wallet
 * or route keyless accounts to create an Oxy ID → PIN gate → home.
 */

import type { IdentityInitResult } from "./wallet-store";

export type EntryRoute = {
  kind:
    | "loading"
    | "signin"
    | "create-identity"
    | "needs-pin"
    | "ready"
    | "web-unsupported";
};

export function decideEntryRoute(input: {
  isAuthResolved: boolean;
  isAuthenticated: boolean;
  identityInit: IdentityInitResult | null;
  hasPinConfigured: boolean | null;
}): EntryRoute {
  const { isAuthResolved, isAuthenticated, identityInit, hasPinConfigured } = input;

  if (!isAuthResolved) return { kind: "loading" };
  if (!isAuthenticated) return { kind: "signin" };

  // Signed in: the identity/wallet probe runs asynchronously; wait for it.
  if (identityInit === null) return { kind: "loading" };
  if (identityInit === "web-unsupported") return { kind: "web-unsupported" };
  if (identityInit === "no-identity") return { kind: "create-identity" };

  // Wallet initialized: PIN gate before any authenticated screen (spec §7).
  if (hasPinConfigured === null) return { kind: "loading" };
  if (!hasPinConfigured) return { kind: "needs-pin" };
  return { kind: "ready" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/wallet/entry-route.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Rewrite `app/index.tsx` to the Oxy-first flow**

Replace the entire contents of `~/Oxy/OxyPay/packages/frontend/app/index.tsx` with:

```tsx
/**
 * Entry screen — Oxy-first onboarding (spec §4.2).
 *
 * Decides the entry route from Oxy auth state + the on-device identity:
 *   signed out          -> "Sign in with Oxy"
 *   signed in, keyless  -> "Set up your Oxy ID"
 *   signed in, native   -> derive the identity wallet -> PIN gate -> (tabs)
 *   web                 -> wallet unsupported (native-only, spec §9)
 *
 * This screen is the sole authority for the swap; it renders neutral in-place
 * branches and never navigates a child across the boundary.
 */

import { useCallback, useState } from "react";
import { View, Text, ActivityIndicator, Platform } from "react-native";
import { Redirect, useFocusEffect } from "expo-router";
import { useOxy } from "@oxyhq/services";
import { useWalletStore, type IdentityInitResult } from "../src/wallet/wallet-store";
import { useLockStore } from "../src/wallet/lock-store";
import { hasPin } from "../src/storage/secure-store";
import { decideEntryRoute } from "../src/wallet/entry-route";
import { Button } from "../src/ui/components/Button";
import { t } from "../src/i18n";

export default function IndexScreen() {
  const { isAuthResolved, isAuthenticated, signIn } = useOxy();
  const initializeFromIdentity = useWalletStore((s) => s.initializeFromIdentity);
  const initialized = useWalletStore((s) => s.initialized);
  const markNoPinUnlocked = useLockStore((s) => s.markNoPinUnlocked);
  const resolveInitialLock = useLockStore((s) => s.resolveInitialLock);

  const [identityInit, setIdentityInit] = useState<IdentityInitResult | null>(null);
  const [hasPinConfigured, setHasPinConfigured] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const boot = async () => {
        if (!isAuthResolved || !isAuthenticated) return;
        try {
          const pinSet = await hasPin();
          const result: IdentityInitResult = initialized
            ? "initialized"
            : await initializeFromIdentity(() => {});
          if (cancelled) return;
          setHasPinConfigured(pinSet);
          setIdentityInit(result);
          if (result === "initialized") {
            if (!pinSet) markNoPinUnlocked();
            else resolveInitialLock(pinSet);
          } else {
            markNoPinUnlocked();
          }
        } catch (err: unknown) {
          if (!cancelled) {
            setErrorMsg(err instanceof Error ? err.message : t("index.error.load"));
          }
        }
      };
      void boot();
      return () => {
        cancelled = true;
      };
    }, [
      isAuthResolved,
      isAuthenticated,
      initialized,
      initializeFromIdentity,
      markNoPinUnlocked,
      resolveInitialLock,
    ]),
  );

  if (errorMsg) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-destructive text-base text-center mb-4">{errorMsg}</Text>
        <Text className="text-muted-foreground text-sm text-center">{t("index.error.help")}</Text>
      </View>
    );
  }

  const route = decideEntryRoute({ isAuthResolved, isAuthenticated, identityInit, hasPinConfigured });

  switch (route.kind) {
    case "ready":
      return <Redirect href="/(tabs)" />;
    case "needs-pin":
      return <Redirect href="/onboarding/pin-setup" />;
    case "signin":
      return (
        <View className="flex-1 bg-background items-center justify-center px-8">
          <Text className="text-foreground text-2xl text-center mb-3">{t("onboarding.signInTitle")}</Text>
          <Text className="text-muted-foreground text-base text-center mb-8">{t("onboarding.signInSubtitle")}</Text>
          <View className="w-full">
            <Button title={t("pay.signIn")} onPress={() => void signIn()} variant="primary" size="lg" />
          </View>
        </View>
      );
    case "create-identity":
      // Minimal keyless branch; enriched with Commons handoff in Task 5.
      return (
        <View className="flex-1 bg-background items-center justify-center px-8">
          <Text className="text-foreground text-2xl text-center mb-3">{t("onboarding.createIdentityTitle")}</Text>
          <Text className="text-muted-foreground text-base text-center">{t("onboarding.createIdentitySubtitle")}</Text>
        </View>
      );
    case "web-unsupported":
      return (
        <View className="flex-1 bg-background items-center justify-center px-8">
          <Text className="text-foreground text-2xl text-center mb-3">{t("onboarding.webUnsupportedTitle")}</Text>
          <Text className="text-muted-foreground text-base text-center">{t("onboarding.webUnsupportedSubtitle")}</Text>
        </View>
      );
    case "loading":
    default:
      return (
        <View className="flex-1 bg-background items-center justify-center">
          <ActivityIndicator size="large" color="#9ffb50" />
          <Text className="text-muted-foreground text-sm mt-4">{t("index.loading")}</Text>
        </View>
      );
  }
}
```

- [ ] **Step 6: Add the new i18n keys**

In `~/Oxy/OxyPay/packages/frontend/src/i18n/index.ts`, add these keys to BOTH the English and Spanish maps (next to the existing `onboarding.*` keys):
```ts
    "onboarding.signInTitle": "Welcome to Oxy Pay",
    "onboarding.signInSubtitle": "Sign in with your Oxy account — your money is just there.",
    "onboarding.createIdentityTitle": "Set up your Oxy ID",
    "onboarding.createIdentitySubtitle": "Your wallet is secured by your Oxy identity. Create it to continue.",
    "onboarding.webUnsupportedTitle": "Open Oxy Pay on your phone",
    "onboarding.webUnsupportedSubtitle": "The wallet is available on the mobile app only.",
```
Spanish values:
```ts
    "onboarding.signInTitle": "Bienvenido a Oxy Pay",
    "onboarding.signInSubtitle": "Inicia sesión con tu cuenta Oxy — tu dinero ya está ahí.",
    "onboarding.createIdentityTitle": "Configura tu Oxy ID",
    "onboarding.createIdentitySubtitle": "Tu monedero está protegido por tu identidad Oxy. Créala para continuar.",
    "onboarding.webUnsupportedTitle": "Abre Oxy Pay en tu teléfono",
    "onboarding.webUnsupportedSubtitle": "El monedero solo está disponible en la app móvil.",
```

- [ ] **Step 7: Remove the seed-onboarding screens from the default path**

Delete the three files:
```bash
cd ~/Oxy/OxyPay/packages/frontend
git rm app/onboarding/welcome.tsx app/onboarding/create.tsx app/onboarding/restore.tsx
```
Then edit `app/onboarding/_layout.tsx` — remove the `welcome`, `create`, and `restore` `<Stack.Screen>` entries, keeping only `pin-setup`:
```tsx
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="pin-setup" options={{ title: "", headerBackVisible: false }} />
    </Stack>
  );
```

- [ ] **Step 8: Verify no dangling references + typecheck**

Run:
```bash
cd ~/Oxy/OxyPay/packages/frontend
grep -rn "onboarding/welcome\|onboarding/create\|onboarding/restore" app src || echo "no dangling refs"
bun run typecheck
bun test src/wallet/entry-route.test.ts
```
Expected: "no dangling refs"; typecheck clean; entry-route tests green.

- [ ] **Step 9: Device verification (real foregrounded native device/emulator)**

On a device/emulator **without** a live Oxy identity (use a disposable/test identity — NEVER `adb install -r` a device holding a real identity): cold-start Oxy Pay signed out → confirm the "Sign in with Oxy" screen (no seed screens). Sign in with a test Oxy account that has an identity → confirm it derives the wallet and lands on `(tabs)` with no "create wallet" or seed-quiz screens.

- [ ] **Step 10: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/app/index.tsx packages/frontend/app/onboarding/_layout.tsx \
  packages/frontend/src/wallet/entry-route.ts packages/frontend/src/wallet/entry-route.test.ts \
  packages/frontend/src/i18n/index.ts
git rm --cached packages/frontend/app/onboarding/welcome.tsx packages/frontend/app/onboarding/create.tsx packages/frontend/app/onboarding/restore.tsx 2>/dev/null || true
git commit -m "feat(oxypay): Oxy-first onboarding; remove seed-phrase onboarding path"
```

---

## Task 5: Oxy Pay — keyless-account branch (detect + route to Oxy ID creation)

Turns the minimal `create-identity` branch into a real "Set up your Oxy ID" screen with a Commons handoff, and distinguishes a fully keyless account (create) from one that has an identity on the server but not on THIS device (sync from Commons). The create-vs-sync decision is a PURE function; the server probe is thin glue.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/wallet/keyless.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/keyless.test.ts`
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/components/CreateOxyIdView.tsx`
- Modify: `~/Oxy/OxyPay/packages/frontend/app/index.tsx` (render `CreateOxyIdView` for the `create-identity` route)
- Modify: `~/Oxy/OxyPay/packages/frontend/src/i18n/index.ts` (button/label keys)

**Interfaces:**
- Consumes: `oxyServices.listAuthMethods()` from `src/services/oxy-services.ts` (identity mixin is flat on the instance — see `@oxyhq/services` `useAuthMethods.ts:24`; returns `AuthMethodsResponse`); `Linking` from `react-native`; `decideEntryRoute` route `create-identity` (Task 4).
- Produces:
  - `COMMONS_CREATE_IDENTITY_URL`, `COMMONS_HOME_URL` (const strings)
  - `type KeylessAction = { kind: "create" | "sync"; url: string }`
  - `resolveKeylessAction(serverHasIdentity: boolean): KeylessAction`
  - `hasIdentityAuthMethod(methods: readonly { type?: string }[]): boolean`
  - `CreateOxyIdView` React component.

- [ ] **Step 1: Write the failing test**

Create `~/Oxy/OxyPay/packages/frontend/src/wallet/keyless.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  resolveKeylessAction,
  hasIdentityAuthMethod,
  COMMONS_CREATE_IDENTITY_URL,
  COMMONS_HOME_URL,
} from "./keyless";

describe("hasIdentityAuthMethod", () => {
  test("true when an identity/key method is present", () => {
    expect(hasIdentityAuthMethod([{ type: "password" }, { type: "identity" }])).toBe(true);
    expect(hasIdentityAuthMethod([{ type: "key" }])).toBe(true);
  });
  test("false for password-only / empty", () => {
    expect(hasIdentityAuthMethod([{ type: "password" }])).toBe(false);
    expect(hasIdentityAuthMethod([])).toBe(false);
  });
});

describe("resolveKeylessAction", () => {
  test("no server identity → create in Commons", () => {
    const action = resolveKeylessAction(false);
    expect(action.kind).toBe("create");
    expect(action.url).toBe(COMMONS_CREATE_IDENTITY_URL);
  });
  test("server has identity (exists on another device) → open Commons to sync", () => {
    const action = resolveKeylessAction(true);
    expect(action.kind).toBe("sync");
    expect(action.url).toBe(COMMONS_HOME_URL);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/wallet/keyless.test.ts`
Expected: FAIL — cannot resolve `./keyless`.

- [ ] **Step 3: Write `keyless.ts`**

Create `~/Oxy/OxyPay/packages/frontend/src/wallet/keyless.ts`:

```ts
/**
 * Keyless-account handling: an Oxy account with no self-sovereign identity key
 * on this device cannot derive a wallet (spec §4.1). Route the user to Commons
 * — the ecosystem identity vault — to CREATE an Oxy ID, or, if the server shows
 * an identity that just isn't on this device yet, to OPEN Commons and sync it.
 * Oxy Pay is a Relying Party; it never mints identities itself.
 */

/** Commons deep link to start Oxy ID creation. */
export const COMMONS_CREATE_IDENTITY_URL = "commons://create-identity";

/** Commons home (used to open the vault so it can sync the identity to a new device). */
export const COMMONS_HOME_URL = "commons://";

export type KeylessAction = { kind: "create" | "sync"; url: string };

/**
 * True when the account already has a self-sovereign identity verification
 * method on the server (present on some device), vs. a fully keyless
 * (password-only) account.
 */
export function hasIdentityAuthMethod(methods: readonly { type?: string }[]): boolean {
  return methods.some((m) => m.type === "identity" || m.type === "key");
}

/**
 * Decide what a keyless-on-this-device user should do: create a new Oxy ID
 * (no identity anywhere) or open Commons to sync an existing one.
 */
export function resolveKeylessAction(serverHasIdentity: boolean): KeylessAction {
  return serverHasIdentity
    ? { kind: "sync", url: COMMONS_HOME_URL }
    : { kind: "create", url: COMMONS_CREATE_IDENTITY_URL };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/wallet/keyless.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `CreateOxyIdView.tsx`**

Create `~/Oxy/OxyPay/packages/frontend/src/ui/components/CreateOxyIdView.tsx`:

```tsx
/**
 * Keyless "Set up your Oxy ID" screen. Probes the server for an existing
 * identity, then opens Commons to either create a new Oxy ID or sync an
 * existing one to this device. Neutral in-place branch of `app/index.tsx` — it
 * never navigates across the entry boundary itself.
 */

import { useCallback, useState } from "react";
import { View, Text, Linking } from "react-native";
import { Button } from "./Button";
import { oxyServices } from "../../services/oxy-services";
import { hasIdentityAuthMethod, resolveKeylessAction } from "../../wallet/keyless";
import { t } from "../../i18n";

export function CreateOxyIdView() {
  const [opening, setOpening] = useState(false);

  const handleSetup = useCallback(async () => {
    setOpening(true);
    try {
      // Best-effort: if the server shows an existing identity, open Commons to
      // sync it; otherwise open the create flow. A probe failure defaults to
      // create (the safe path for a brand-new keyless account).
      let serverHasIdentity = false;
      try {
        const res = await oxyServices.listAuthMethods();
        serverHasIdentity = hasIdentityAuthMethod(res.methods ?? []);
      } catch (err: unknown) {
        serverHasIdentity = false;
      }
      const action = resolveKeylessAction(serverHasIdentity);
      const canOpen = await Linking.canOpenURL(action.url);
      if (canOpen) {
        await Linking.openURL(action.url);
      } else {
        // Commons not installed — send them to its store listing.
        await Linking.openURL(t("onboarding.commonsStoreUrl"));
      }
    } finally {
      setOpening(false);
    }
  }, []);

  return (
    <View className="flex-1 bg-background items-center justify-center px-8">
      <Text className="text-foreground text-2xl text-center mb-3">
        {t("onboarding.createIdentityTitle")}
      </Text>
      <Text className="text-muted-foreground text-base text-center mb-8">
        {t("onboarding.createIdentitySubtitle")}
      </Text>
      <View className="w-full">
        <Button
          title={t("onboarding.createIdentityCta")}
          onPress={() => void handleSetup()}
          variant="primary"
          size="lg"
          disabled={opening}
        />
      </View>
    </View>
  );
}
```

- [ ] **Step 6: Render `CreateOxyIdView` from `app/index.tsx`**

In `~/Oxy/OxyPay/packages/frontend/app/index.tsx`, add the import:
```tsx
import { CreateOxyIdView } from "../src/ui/components/CreateOxyIdView";
```
Replace the minimal `case "create-identity":` block (from Task 4) with:
```tsx
    case "create-identity":
      return <CreateOxyIdView />;
```

- [ ] **Step 7: Add the i18n keys**

In `src/i18n/index.ts`, add to BOTH maps:
```ts
    "onboarding.createIdentityCta": "Set up in Commons",
    "onboarding.commonsStoreUrl": "https://apps.apple.com/app/commons-by-oxy",
```
Spanish:
```ts
    "onboarding.createIdentityCta": "Configurar en Commons",
    "onboarding.commonsStoreUrl": "https://apps.apple.com/app/commons-by-oxy",
```

- [ ] **Step 8: Typecheck + run keyless tests**

Run:
```bash
cd ~/Oxy/OxyPay/packages/frontend && bun run typecheck && bun test src/wallet/keyless.test.ts
```
Expected: clean typecheck; 4 tests green.

- [ ] **Step 9: Device verification**

On an emulator with a keyless (password-only) test Oxy account: sign in → confirm the "Set up your Oxy ID" screen appears and the button deep-links to Commons (or its store listing when Commons is absent). Confirm a normal account with an identity still bypasses this screen.

- [ ] **Step 10: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/src/wallet/keyless.ts packages/frontend/src/wallet/keyless.test.ts \
  packages/frontend/src/ui/components/CreateOxyIdView.tsx \
  packages/frontend/app/index.tsx packages/frontend/src/i18n/index.ts
git commit -m "feat(oxypay): keyless-account branch routes to Commons Oxy ID setup"
```

---

## Task 6: Oxy Pay — remove the multi-wallet UI

Oxy Pay is single-wallet (spec §4.7). Remove the wallet switcher + management screen and their entry points. The underlying multi-wallet store code stays (dormant) — only the UI is removed.

**Files:**
- Delete: `app/wallets.tsx`, `src/ui/sheets/WalletSwitcherSheet.tsx`
- Modify: `app/(tabs)/index.tsx` (remove the `WalletSwitcherSheet` mount + its control)
- Modify: `app/(tabs)/settings.tsx` (remove the "Wallets" row + `router.push("/wallets")`)
- Modify: `app/_layout.tsx` (remove the `wallets` `Stack.Screen`)

**Interfaces:**
- Consumes: nothing new.
- Produces: no exports. Deliverable = the app builds and boots to `(tabs)` with no wallet-switcher surface and no dangling references.

- [ ] **Step 1: Delete the wallet-switcher sheet + management screen**

```bash
cd ~/Oxy/OxyPay/packages/frontend
git rm app/wallets.tsx src/ui/sheets/WalletSwitcherSheet.tsx
```

- [ ] **Step 2: Remove the switcher from the home tab**

In `~/Oxy/OxyPay/packages/frontend/app/(tabs)/index.tsx`:
- Remove the import `import { WalletSwitcherSheet } from "../../src/ui/sheets/WalletSwitcherSheet";` (line 41).
- Remove the `<WalletSwitcherSheet onDone={() => walletSwitcherControl.close()} />` mount (line 533).
- Remove any `walletSwitcherControl` declaration and the handler/press that opened it (grep `walletSwitcher` in the file and delete each usage, including the bottom-sheet control creation and the press handler on the wallet-name header). Keep the `activeWalletName` display text unchanged (it still shows the single wallet name) but make the header non-pressable if its only action was opening the switcher.

- [ ] **Step 3: Remove the "Wallets" row from Settings**

In `~/Oxy/OxyPay/packages/frontend/app/(tabs)/settings.tsx`:
- Remove the settings row whose `onPress` is `router.push("/wallets")` (around line 354) and any `wallets`/`activeWalletName`-derived label block that exists ONLY to render that row (lines ~346–351). Leave unrelated `activeWalletName` usage (e.g. a header at line 607) intact.

- [ ] **Step 4: Remove the `wallets` route registration**

In `~/Oxy/OxyPay/packages/frontend/app/_layout.tsx`, delete the line:
```tsx
        <Stack.Screen name="wallets" options={{ headerShown: false, presentation: "modal" }} />
```

- [ ] **Step 5: Verify no dangling references + typecheck + build**

Run:
```bash
cd ~/Oxy/OxyPay/packages/frontend
grep -rn "WalletSwitcherSheet\|/wallets\|walletSwitcher" app src || echo "no dangling refs"
bun run typecheck
```
Expected: "no dangling refs"; typecheck clean. (`switchWallet`/`createNewWallet`/`wallets` store members remain defined but unused by UI — that is intentional; the grep pattern above is UI-specific.)

- [ ] **Step 6: Device verification**

Cold-start to `(tabs)`: confirm there is no wallet switcher affordance on the home header and no "Wallets" row in Settings, and the app does not crash navigating those surfaces.

- [ ] **Step 7: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/app/(tabs)/index.tsx packages/frontend/app/(tabs)/settings.tsx packages/frontend/app/_layout.tsx
git commit -m "feat(oxypay): remove multi-wallet UI (single identity wallet)"
```

---

## Task 7: Oxy Pay — native shared-keychain entitlement config

Oxy Pay reads the Oxy identity from the shared keychain `group.so.oxy.shared` (written by Commons). This requires the iOS Keychain Access Group entitlement + Android `sharedUserId`, and every app sharing the UID MUST be signed with the ONE shared Oxy release keystore. This is native config; it is verified by a config-plugin prebuild + a real device/emulator test — NOT a unit test.

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/app.json` (iOS entitlement + register the Android plugin)
- Create: `~/Oxy/OxyPay/packages/frontend/plugins/withSharedUserId.js`

**Interfaces:**
- Consumes: `KeyManager.getSharedPrivateKey()` (via Task 3's `deriveScopedSeed`), which on iOS reads `keychainAccessGroup: 'group.so.oxy.shared'` and on Android reads through the shared-identity bridge Commons hosts.
- Produces: build config only.

- [ ] **Step 1: Add the iOS Keychain Access Group entitlement**

In `~/Oxy/OxyPay/packages/frontend/app.json`, extend `ios.entitlements` (which already has `aps-environment`) to:
```json
      "entitlements": {
        "aps-environment": "production",
        "keychain-access-groups": ["$(AppIdentifierPrefix)group.so.oxy.shared"]
      }
```
(`$(AppIdentifierPrefix)` expands to the Team ID prefix at build; `@oxyhq/core`'s runtime group string stays `group.so.oxy.shared`, a suffix match. Prerequisite: Oxy Pay ships under the SAME Apple Developer Team as Commons.)

- [ ] **Step 2: Create the Android `sharedUserId` config plugin**

Create `~/Oxy/OxyPay/packages/frontend/plugins/withSharedUserId.js` (mirrors Commons' plugin verbatim):
```js
/**
 * Expo Config Plugin: withSharedUserId
 *
 * Adds android:sharedUserId="so.oxy.shared" to AndroidManifest.xml so Oxy Pay
 * joins the shared-keychain UID and can read the identity Commons writes.
 * REQUIRES every app sharing the UID to be signed with the SAME certificate
 * (the one Oxy ecosystem release keystore). Cannot change after publishing.
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withSharedUserId(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;
    androidManifest.$ = {
      ...androidManifest.$,
      'android:sharedUserId': 'so.oxy.shared',
    };
    return config;
  });
};
```

- [ ] **Step 3: Register the plugin in `app.json`**

In `app.json`, add `"./plugins/withSharedUserId"` to the `plugins` array (place it after `"expo-secure-store"`).

- [ ] **Step 4: Verify the config compiles into native projects**

Run:
```bash
cd ~/Oxy/OxyPay/packages/frontend
bunx expo prebuild --platform android --no-install --clean
grep -n "sharedUserId" android/app/src/main/AndroidManifest.xml
```
Expected: `android:sharedUserId="so.oxy.shared"` present. (For iOS, `bunx expo prebuild --platform ios` then confirm `keychain-access-groups` in the generated `.entitlements`.) Clean up the prebuild output afterward if the repo keeps a managed workflow (`rm -rf android ios` if they are not committed).

- [ ] **Step 5: EAS credentials — shared Oxy release keystore (documentation/action)**

Configure the Android build (EAS) to sign with the shared Oxy ecosystem release keystore (same certificate as Commons/Accounts) — NOT a per-app keystore, or the shared UID install fails. iOS: ensure the provisioning profile includes the `group.so.oxy.shared` keychain group under the shared Team ID. This is an infra/credentials step; record it in the app's release runbook.

- [ ] **Step 6: On-device verification (real device/emulator — HANDLE WITH CARE)**

On an **emulator** or a **disposable-identity** device: install Commons + Oxy Pay signed with the shared keystore; create a test identity in Commons; cold-start Oxy Pay and confirm it reads the shared identity (wallet derives, lands on `(tabs)`) with no "create Oxy ID" prompt. **NEVER `adb install -r` Oxy Pay or Commons on a device holding a REAL identity** — a signature-matching in-place update can orphan the AndroidKeyStore key and permanently destroy an un-backed-up identity (see `~/Oxy/OxyHQServices/AGENTS.md` §Commons and `~/Oxy/AGENTS.md` §Android release signing).

- [ ] **Step 7: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/app.json packages/frontend/plugins/withSharedUserId.js
git commit -m "feat(oxypay): shared-keychain entitlement + Android sharedUserId for Oxy identity"
```

---

## Self-Review

**Spec coverage (WS-F, spec §2/§3/§4.1/§4.2/§4.7/§5/§7/§8/§9/§10):**
- §5 / §4.1 `deriveScopedSeed` in `@oxyhq/core` (HKDF, domain-separated, no raw-key leak) → **Task 1**; publish → **Task 2**.
- §4.1 wallet init from the derived seed via `KeyManager.fromSeed`, never `mnemonicToSeed`, coin type 119/1 → **Task 3**.
- §4.2 Oxy-first entry routing + removal of `welcome`/`create`/`restore` + backup banner becomes the Oxy recovery phrase (`hasBackedUp` forced true) → **Tasks 3f, 4**.
- §4.1 keyless detection + route to identity creation → **Task 5**.
- §4.7 remove multi-wallet UI → **Task 6**.
- §4.1 / §9 native shared-keychain entitlement (`group.so.oxy.shared`, Android `sharedUserId`, shared keystore) + web-null guard → **Tasks 3f(web-unsupported), 7**.
- §8 testing (derivation determinism, key non-leak, onboarding states, testnet path) → Tasks 1, 3, 4, 5 unit tests + device-verification steps.
- §2.3 / §8 security-review + mainnet gate → called out in Global Constraints (out of WS-F build scope).

**Placeholder scan:** every code step carries complete code; no "TBD"/"similar to Task N"/"handle edge cases". The pinned HKDF vectors (`4b90d900…`, `cdedf1f0…`) were computed independently and are reproducible.

**Type/name consistency:** `deriveScopedSeed(info: string): Promise<Uint8Array | null>` identical in Tasks 1/3; `IdentityInitResult` identical in Tasks 3/4; `deriveIdentitySeed`/`buildSeedSecret`/`OXY_IDENTITY_WALLET_ID`/`SEED_SECRET_PREFIX` consistent between Task 3's module and the store wiring; `decideEntryRoute` route kinds match between `entry-route.ts` and the `app/index.tsx` switch; `resolveKeylessAction`/`hasIdentityAuthMethod` consistent between Task 5's module, test, and `CreateOxyIdView`.

**Cross-repo dependency:** Repo B (Oxy Pay) Tasks 3–7 are BLOCKED on Repo A Task 2 (the `@oxyhq/core@12.6.0` publish + propagation check). Task 3 Step 1's `bun install` will not resolve `@oxyhq/core@12.6.0` until Task 2 Step 5 is green.

**Assumptions the reviewer should verify:**
1. **Identity-key source & recoverability (highest priority — route to `security-reviewer`).** `deriveScopedSeed` reads the SHARED identity key (`getSharedPrivateKey`) first, then the primary (`getPrivateKey`). For an Oxy Pay wallet to be recoverable from the user's Oxy recovery phrase, the shared identity key MUST equal the primary identity key (i.e. Commons writes the shared key via `migrateToSharedIdentity` — a COPY of the primary — NOT a fresh `createSharedIdentity` keypair, which would derive an unrecoverable wallet). Confirm Commons' write path guarantees shared == primary, or the fallback ordering / a different source must be chosen. This is also the identity-key-reuse concern in spec §4.3/§7(c).
2. **Interactive sign-in call.** `app/index.tsx` opens sign-in via `useOxy().signIn()` with no arguments (matching the existing `app/pay/[intent].tsx:234` usage, whose comment says it "opens the in-app Oxy account dialog"). The `OxyContextState` type declares `signIn: (publicKey: string, deviceName?) => Promise<User>` — confirm the no-arg call is the correct interactive/dialog entry (or switch to `openAccountDialog('signin')` if that is the real API).
3. **`useOxy()` exposes `isAuthResolved` + `isAuthenticated`.** Confirmed in `oxyContextTypes.ts:11,27`; verify `useOxy()` (not just `useAuth()`) returns them in the installed `@oxyhq/services` version.
4. **`listAuthMethods()` access path + response shape.** The plan calls `oxyServices.listAuthMethods()` (flat — confirmed in `@oxyhq/services` `useAuthMethods.ts:24`, not `oxyServices.identity.*`). `hasIdentityAuthMethod` then assumes `res.methods` is an array of `{ type }` with `type === "identity"`/`"key"` for a self-sovereign method — verify the real `AuthMethodsResponse` field name and discriminator value and adjust the thin mapper if different (the pure predicate is unaffected).
5. **Commons deep links.** `commons://create-identity` and `commons://` — verify these resolve to Commons' create-identity route / home (scheme `commons`), and set a real store-listing fallback URL (the placeholder is Apple-only).
6. **PIN gate retained.** The plan keeps `onboarding/pin-setup` and the lock/PIN flow (spec §7 "app PIN/biometric"); confirm that pairing an identity-derived wallet with the existing PIN/lock store needs no further change (pin-setup does not assume a mnemonic exists).
7. **Android shared-identity read bridge.** iOS reads the shared keychain directly with the entitlement; Android reads Commons' store through the shared-identity bridge (`loadSharedIdentityBridge`). Verify whether Oxy Pay needs an additional dependency/config to READ (Commons HOSTS the provider via `@oxyhq/services/plugins/withSharedIdentityProvider`; reader apps consume it) beyond `sharedUserId` + the shared signing key.
