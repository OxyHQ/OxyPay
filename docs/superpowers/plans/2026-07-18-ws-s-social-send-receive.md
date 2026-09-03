# WS-S: Social Send/Receive + Rich Transaction Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## ✅ EXECUTION STATUS — CODE COMPLETE; ⚠️ TESTNET-ONLY (2026-07-19)
> **19/19 tasks done + reviewed** on branch `feat/oxypay-fase2-gateway` (local, not pushed). Published **`@fairco.in/core@0.3.0`** (Task 2). Backend **162/162**, frontend **307/307**, both tsc clean.
> **Task 19 security gate EXECUTED → verdict: NOT MAINNET-ELIGIBLE.** Blocker **F-1** (HIGH, fund-loss): an Oxy identity **key rotation** strands the shared-identity key slot (DID `#key-1` is primary-first, OxyPay derives shared-first) → a payer sends to addresses the recipient can't watch/spend = silent permanent loss. Fix is UPSTREAM in `@oxyhq/core` (hot identity zone) — **owner routed it to the identity-vault v2 session**; do NOT patch in OxyPay. F-2 (non-hardened → identity-master-key recovery on a leaked spending key) + F-3 (merchant enrichment public-by-design) are **owner-accepted**. See memory `oxypay-social-receive-security-status`.
> **Final whole-branch review** found 5 cross-task issues → **#1-4 fixed** (recipient-authed cursor-sync endpoint + seed the device watch window from it; anti-grief per-(sender,recipient) rate-limit; network-scoped window; main-Pocket-only gate — all independently reviewed). **#5** (merchant display fields unset) is staged for the F2.5 dashboard, not a bug.
> **STAYS TESTNET-ONLY until F-1 is fixed + re-verified.** Also pending: device-verify (all frontend money-paths), push/PR (owner). Full detail: `.superpowers/sdd/progress.md`.

**Goal:** Let an Oxy Pay user pay another Oxy user by `@username` (resolve → derive a fresh receive address from the recipient's PUBLIC identity key → send, no recipient interaction required), receive social payments at a stable default address plus fresh per-payment addresses derived from their own identity key, and see a Stripe/Revolut-grade transaction history that shows merchant name+logo or counterparty avatar+name instead of raw addresses.

**Architecture:** A single derivation primitive — `xpub_social`/`xprv_social`/`addr(i)`, built from a secp256k1 key via a deterministic HMAC-derived BIP32 chain code (`@scure/bip32` `HDKey`) — is published ONCE from **`@fairco.in/core`** (generic secp256k1 inputs, no Oxy dependency — `@oxyhq/core` MUST stay platform-agnostic and never import faircoin, per `~/AGENTS.md`/`~/Oxy/AGENTS.md`) and consumed identically by the payer (public key only), the recipient (private key, on-device), and the backend (public key only, for atomic fresh-index reservation). The recipient's raw identity private key comes from `@oxyhq/core`'s ALREADY-PUBLISHED `KeyManager.getPrivateKey()`/`getSharedPrivateKey()` — no change to `@oxyhq/core` is needed for WS-S at all. The backend mirrors its existing merchant `reserveNextAddress`/`PaymentIntent` machinery for a new per-user `SocialReceiveCursor`, and records a `SocialSendAttribution` row at reservation time that a new `/v1/enrich` endpoint joins against `PaymentIntent`+`Merchant` to answer "who is this transaction with" for both sender and recipient. The OxyPay wallet gains a second, parallel watched-address branch (social-receive) alongside its private BIP44 spending tree, wired into the existing SPV receive/spend pipeline via small wrapper functions rather than by modifying the tree itself.

**Tech Stack:** `@fairco.in/core` (`@noble/hashes`, `@scure/bip32` — both already dependencies, `bun:test`), `@oxyhq/core` (consumed as-is — `KeyManager.getPrivateKey`/`getSharedPrivateKey`, `resolveDid`, `getProfileByUsername`, `getUsersByIds`, `createOxyAuthMiddleware` — zero WS-S changes), Oxy Pay backend (Bun, Express, Mongoose, Zod, `bun:test` + `mongodb-memory-server`), Oxy Pay frontend (Expo SDK 57 / RN 0.86, Zustand, expo-sqlite, `@tanstack/react-query`, Bloom `Avatar`/`ImageResolverProvider`, `bun:test`), `@oxypay/shared-types`.

## Global Constraints

- **Self-custody / MiCA.** The backend never sees, stores, or can reconstruct a private key — only public identity keys (`xpub_social`'s pubkey) and broadcast txids (spec §2.1, §7).
- **Keys never leave the device.** The recipient's identity private key touches memory only transiently, on-device, to derive a social-receive spending key at send time (spec §2.2).
- **Security review before mainnet.** The derivation scheme (esp. the identity-key-derived social-receive branch, which is the ONE place the identity key is reused directly for money) MUST pass a `security-reviewer` audit before any mainnet build ships (spec §2.3, §7, §10 step 4).
- **Fix upstream, never patch the consumer; package boundary is load-bearing.** The `xpub_social`/`xprv_social`/`addr(i)` derivation is implemented ONCE in `@fairco.in/core` (generic secp256k1, published) and consumed identically by payer, recipient, and backend — no divergent reimplementation in any consumer. Generic identity-key ACCESS (raw key retrieval) stays in `@oxyhq/core` (already shipped, platform-agnostic, MUST NOT import faircoin); FairCoin-SPECIFIC crypto stays in `@fairco.in/core` (spec §2.4, §5).
- **Publish before consume.** Republish `@fairco.in/core`, verify propagation (clean external install + import), THEN bump every consumer (`~/Oxy/OxyHQServices/AGENTS.md`'s publish discipline applies equally here).
- **Enrichment is display-only.** It never affects custody or blocks a payment; a failed/partial enrichment degrades gracefully to address + amount (spec §4.8).
- **Canonical Oxy media chokepoint.** Avatars are rendered from a bare Oxy file id via Bloom `Avatar` + a registered `ImageResolverProvider` (`(id, variant) => oxyServices.getFileDownloadUrl(id, variant)`) — never a per-app avatar URL field, never a raw `uri`.
- **Display name.** `displayName ?? handle` — never recomposed from `first`/`last`/`full`.
- **bun only.** `bun`/`bunx`, never npm/npx. Regenerate and commit `bun.lock` in the SAME commit as any `package.json` bump.
- **No** `as any`, `@ts-ignore`/`@ts-expect-error`, `!` non-null assertions, `console.log`, or silent `catch {}`. TypeScript strict.
- **Non-hardened derivation only.** Social-receive indices are BIP32 non-hardened children (`index < HARDENED_OFFSET`); a caller passing an out-of-range index gets a clear thrown error, never a silent hardened-derivation fallback.
- **Verify runtime UI on a real foregrounded device/emulator** (Bloom/Reanimated/expo-router rules) before calling any frontend task done.

---

## File Structure

**Repo A — `~/faircoin-core` (`@fairco.in/core`, publish gate — coordinate with the concurrent `feat/multisig` work in the SAME repo, see Task 2):**
- Create: `src/social-receive.ts` — `deriveSocialReceiveAddress`, `deriveSocialReceiveSpendingKey`, `publicKeyFromPrivateKey`, `MAX_SOCIAL_RECEIVE_INDEX`.
- Create: `test/social-receive.test.ts`.
- Modify: `src/index.ts` — export the new symbols.
- Modify: `package.json` — version bump (coordinated with `feat/multisig`'s own bump — see Task 2; no new dependencies, `@scure/bip32` and `@noble/hashes` are already present).

**`@oxyhq/core` (`~/Oxy/OxyHQServices`): NO CHANGES for WS-S.** The recipient's raw identity private key is already exposed by the published `KeyManager.getPrivateKey()` / `getSharedPrivateKey()`; OxyPay's own glue code (Task 11) reads it directly. This package must never import `@fairco.in/core` or gain FairCoin-specific code.

**Repo B — `~/Oxy/OxyPay/packages/shared-types` (contract, consumed by backend + frontend):**
- Create: `src/social.ts` — `SocialNextAddressResponse`, `EnrichmentKind`, `EnrichmentResult`, `EnrichRequest`, `EnrichResponse`.
- Modify: `src/index.ts` — export the new types.

**Repo B — `~/Oxy/OxyPay/packages/backend`:**
- Modify: `src/models/Merchant.ts` — add `displayName?`, `avatarFileId?`, `description?`.
- Create: `src/models/SocialReceiveCursor.ts`.
- Create: `src/models/SocialSendAttribution.ts`.
- Create: `src/services/socialReceive.ts` — `resolveIdentityPublicKey`, `reserveNextSocialAddress`, `SOCIAL_RECEIVE_FIRST_FRESH_INDEX`.
- Create: `src/services/enrichment.ts` — `enrichAddresses`, `ENRICH_MAX_ADDRESSES`.
- Create: `src/routes/social.ts` — `createSocialRouter`.
- Create: `src/routes/enrich.ts` — `createEnrichRouter`.
- Modify: `src/server.ts` — mount both new routers, extend `GatewayDeps`.
- Create: `src/models/__tests__/socialReceive.test.ts`.
- Create: `src/services/__tests__/enrichment.test.ts`.
- Create: `src/routes/__tests__/social.test.ts`.
- Create: `src/routes/__tests__/enrich.test.ts`.

**Repo B — `~/Oxy/OxyPay/packages/frontend`:**
- Modify: `src/storage/database.ts` — `social_receive_addresses` table + 4 new methods.
- Create: `src/storage/database.social-receive.test.ts`.
- Create: `src/wallet/social-receive.ts` — on-device wrapper: reads the raw identity private key from `@oxyhq/core`'s EXISTING `KeyManager` getters and calls `@fairco.in/core`'s published helper.
- Create: `src/wallet/social-receive.test.ts`.
- Modify: `src/wallet/wallet-store.ts` — social-receive window setup, Bloom-filter inclusion, receive-path ownership, spend-path signing fallback, teardown.
- Modify: `src/services/gateway-client.ts` — `reserveNextSocialAddress`, `enrichAddresses`, `KeylessRecipientError`.
- Create: `src/services/gateway-client.test.ts`.
- Create: `src/ui/components/UserAvatar.tsx` — thin Bloom `Avatar` wrapper for an Oxy user (bare file id + `displayName ?? handle` fallback).
- Create: `src/ui/components/SocialRecipientPicker.tsx`.
- Modify: `src/ui/sheets/SendSheet.tsx` — Person/Address recipient toggle + social send flow.
- Modify: `src/ui/sheets/ReceiveSheet.tsx` — show `@username` + the stable social-receive default address.
- Modify: `app/_layout.tsx` — register `ImageResolverProvider`.
- Create: `src/hooks/useTransactionEnrichment.ts`.
- Modify: `src/ui/components/TransactionItem.tsx` — optional identity override (icon → avatar, label → "Paid at X"/"Sent to @x"/"Received from @x").
- Modify: `app/(tabs)/index.tsx` — wire enrichment into the rendered transaction list.
- Modify: `src/ui/sheets/TransactionDetailSheet.tsx` — show resolved counterparty name above the raw address.

**Cross-repo / cross-task gates:**
- Tasks 3–9 (backend + shared-types) are BLOCKED on Task 2 (the `@fairco.in/core` publish) only where they import the new derivation symbol (Task 5). Tasks 3, 4, 6 have no `@fairco.in/core` derivation dependency and can start immediately (Task 4/6's OWN `@fairco.in/core` usage, if any, is the pre-existing `NetworkType`/`hexToBytes` surface, already available at the currently-published version).
- Tasks 10–18 (frontend) are BLOCKED on Task 2 for anything importing the new `@fairco.in/core` derivation symbols (Tasks 11, 12 — transitively, since Task 12 only ever imports Task 11's local wrapper, not the package directly), and on the matching backend routes being reachable for Tasks 13–18's end-to-end verification. They build on `src/wallet/identity-wallet.ts` and `wallet-store.ts`'s `initializeFromIdentity`, which are ALREADY merged on `feat/oxy-pay-wallet` (WS-F's identity-derived wallet landed) — Task 10 has no dependency at all and can start immediately.
- Task 19 (security-reviewer gate) is BLOCKED on everything.
- **`@oxyhq/core` has NO task, NO publish gate, and NO version bump anywhere in this plan.** If any step below is found importing a new symbol from `@oxyhq/core`, that is a bug in this plan — it must import the raw-key getters that ALREADY exist (`getPrivateKey`/`getSharedPrivateKey`) or an existing higher-level method (`resolveDid`, `getProfileByUsername`, `getUsersByIds`, `createOxyAuthMiddleware`, `getRequiredOxyUserId`), never a newly-added one.

---

## Task 1: `@fairco.in/core` — social-receive derivation primitive

> ✅ **DONE** — commit `01c61fb`; task-review clean (crypto verified vs @scure/bip32 source, normalization invariant guarded, 14/14). 2026-07-19.

Adds the upstream, security-critical crypto: the deterministic `xpub_social`/`xprv_social`/`addr(i)` scheme (spec §4.3). Lands in **`/home/nate/faircoin-core`** — a generic FairCoin protocol library with ZERO Oxy dependency (mirrors the file's own header: "no React Native, Expo, or browser-specific dependencies"). Inputs are plain secp256k1 public/private key bytes; this module has no idea they happen to come from an Oxy DID or an Oxy identity key. `@oxyhq/core` gets NO changes for this task — the recipient's raw identity private key is already exposed by the published `KeyManager.getPrivateKey()`/`getSharedPrivateKey()` (see Task 11 for how OxyPay reads it).

**IMPORTANT — verified crypto detail:** the chain-code HMAC MUST be computed over a NORMALIZED (always-compressed, 33-byte) public key, not whatever encoding the caller happens to pass in. Oxy's `resolveDid()` `verificationMethod[].publicKeyHex` is UNCOMPRESSED (65 bytes); a private-key-derived probe's `.publicKey` is COMPRESSED (33 bytes, from `@scure/bip32`'s internal `secp.getPublicKey(priv, true)`). Computing the HMAC directly over the raw input bytes (skipping normalization) makes the payer and the recipient derive DIFFERENT, incompatible addresses for the exact same identity — this was verified by running the actual algorithm end-to-end against both encodings before writing this task; the fix is to route every public key through `@scure/bip32`'s own point-normalization (construct a throwaway `HDKey({ publicKey, depth: 0 })` and read `.publicKey` back) BEFORE hashing it into the chain code. This module has no knowledge of DIDs — the normalization requirement is generic (any caller might hand it a compressed OR uncompressed encoding) and is documented and tested as such.

**Files:**
- Create: `~/faircoin-core/src/social-receive.ts`
- Modify: `~/faircoin-core/src/index.ts`
- Test: `~/faircoin-core/test/social-receive.test.ts`

**Interfaces:**
- Consumes: `HDKey`, `HARDENED_OFFSET` (`@scure/bip32`, already a dependency), `hmac` (`@noble/hashes/hmac`), `sha256` (`@noble/hashes/sha256`), `utf8ToBytes` (`@noble/hashes/utils`), `publicKeyToAddress` (`./address.js`, this package), `NetworkConfig` (`./network.js`, this package).
- Produces (both consumed by Repo B backend AND frontend tasks — signatures are load-bearing, do not rename):
  - `deriveSocialReceiveAddress(identityPublicKey: Uint8Array, index: number, network: NetworkConfig): string` — PAYER/BACKEND path, public-only.
  - `deriveSocialReceiveSpendingKey(identityPrivateKey: Uint8Array, index: number): Uint8Array` — RECIPIENT path.
  - `publicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array` — derives a secp256k1 keypair's own (compressed) public key from its private key; used by the recipient to compute its OWN watch addresses via `deriveSocialReceiveAddress` without a second, separately-fetched public key.
  - `MAX_SOCIAL_RECEIVE_INDEX: number` — highest legal `index` (== `@scure/bip32`'s `HARDENED_OFFSET - 1`).

- [x] **Step 1: Write the failing crypto test with a pinned, independently-verified vector**

Create `~/faircoin-core/test/social-receive.test.ts`. The pinned hex vectors below were computed by actually running the algorithm (not hand-derived) against `@scure/bip32`/`@noble/hashes`/this package's own `publicKeyToAddress`, so they are safe to trust byte-for-byte:

```ts
import { describe, test, expect } from "bun:test";
import { hexToBytes, bytesToHex } from "../src/encoding.js";
import { getNetwork } from "../src/network.js";
import {
  deriveSocialReceiveAddress,
  deriveSocialReceiveSpendingKey,
  publicKeyFromPrivateKey,
  MAX_SOCIAL_RECEIVE_INDEX,
} from "../src/social-receive.js";

const IDENTITY_PRIV_A = hexToBytes("aa".repeat(32));
const IDENTITY_PRIV_B = hexToBytes("bb".repeat(32));
const IDENTITY_PUB_A_COMPRESSED = hexToBytes(
  "026a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb3",
);
const IDENTITY_PUB_A_UNCOMPRESSED = hexToBytes(
  "046a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb336b6fbcb60b5b3d4f1551ac45e5ffc4936466e7d98f6c7c0ec736539f74691a6",
);
const TESTNET = getNetwork("testnet");
const MAINNET = getNetwork("mainnet");

describe("publicKeyFromPrivateKey", () => {
  test("derives the pinned compressed public key for a fixed private key", () => {
    expect(bytesToHex(publicKeyFromPrivateKey(IDENTITY_PRIV_A))).toBe(
      bytesToHex(IDENTITY_PUB_A_COMPRESSED),
    );
  });
});

describe("deriveSocialReceiveAddress", () => {
  test("derives the pinned addr(0..2) for a fixed identity on testnet", () => {
    expect(deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, 0, TESTNET)).toBe(
      "TGW3g56Q5PvpA8UangXnzX6va2MkfaRx5r",
    );
    expect(deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, 1, TESTNET)).toBe(
      "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
    );
    expect(deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, 2, TESTNET)).toBe(
      "TVsFKn7zkDN1QnMNe1thrJUEXBGiqnu19g",
    );
  });

  test("derives the pinned addr(0) for the same identity on mainnet (network changes the address)", () => {
    expect(deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, 0, MAINNET)).toBe(
      "FCMx8p9kmz2Xd8Hz46YESkwKgtdTPCUC74",
    );
  });

  test("CRITICAL: a compressed and an uncompressed encoding of the SAME public key produce the SAME address", () => {
    // Regression test for the normalization bug caught during design
    // verification — a caller may pass either encoding (e.g. Oxy's
    // resolveDid() publicKeyHex is uncompressed while a private-key-derived
    // probe's .publicKey is compressed). Both MUST resolve to the same branch.
    const compressed = deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, 0, TESTNET);
    const uncompressed = deriveSocialReceiveAddress(IDENTITY_PUB_A_UNCOMPRESSED, 0, TESTNET);
    expect(uncompressed).toBe(compressed);
  });

  test("a different identity yields a different addr(0)", () => {
    const pubB = publicKeyFromPrivateKey(IDENTITY_PRIV_B);
    const addrB = deriveSocialReceiveAddress(pubB, 0, TESTNET);
    expect(addrB).toBe("TS2vNQ9Kbv9L4S8iyZZoD5278mAeVduLYn");
    expect(addrB).not.toBe(deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, 0, TESTNET));
  });

  test("distinct indexes yield distinct addresses", () => {
    const a0 = deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, 0, TESTNET);
    const a1 = deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, 1, TESTNET);
    expect(a1).not.toBe(a0);
  });

  test("rejects a negative index", () => {
    expect(() => deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, -1, TESTNET)).toThrow(
      /index/,
    );
  });

  test("rejects a non-integer index", () => {
    expect(() => deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, 1.5, TESTNET)).toThrow(
      /index/,
    );
  });

  test("rejects an index at or beyond the hardened offset", () => {
    expect(() =>
      deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, MAX_SOCIAL_RECEIVE_INDEX + 1, TESTNET),
    ).toThrow(/index/);
  });

  test("accepts the maximum legal index without throwing", () => {
    expect(() =>
      deriveSocialReceiveAddress(IDENTITY_PUB_A_COMPRESSED, MAX_SOCIAL_RECEIVE_INDEX, TESTNET),
    ).not.toThrow();
  });
});

describe("deriveSocialReceiveSpendingKey", () => {
  test("derives the pinned spending key at index 0 for a fixed identity", () => {
    const key = deriveSocialReceiveSpendingKey(IDENTITY_PRIV_A, 0);
    expect(bytesToHex(key)).toBe(
      "42d089c0f361d67b6add7279d67718bc89ddd35d2218696991c24d3902d26c86".slice(0, 64),
    );
  });

  test("never returns the raw identity private key (no leak)", () => {
    const key = deriveSocialReceiveSpendingKey(IDENTITY_PRIV_A, 0);
    expect(bytesToHex(key)).not.toBe(bytesToHex(IDENTITY_PRIV_A));
  });

  test("KEY PROPERTY: for every index, the address derived from the PUBLIC key equals publicKeyToAddress of the spending key derived from the PRIVATE key", () => {
    const { publicKeyToAddress } = require("../src/address.js") as {
      publicKeyToAddress: (pubKey: Uint8Array, network: ReturnType<typeof getNetwork>) => string;
    };
    for (const index of [0, 1, 2, 41, MAX_SOCIAL_RECEIVE_INDEX]) {
      const addressFromPublicPath = deriveSocialReceiveAddress(
        IDENTITY_PUB_A_COMPRESSED,
        index,
        TESTNET,
      );
      const spendingKey = deriveSocialReceiveSpendingKey(IDENTITY_PRIV_A, index);
      const spendingPub = publicKeyFromPrivateKey(spendingKey);
      const addressFromPrivatePath = publicKeyToAddress(spendingPub, TESTNET);
      expect(addressFromPrivatePath).toBe(addressFromPublicPath);
    }
  });

  test("rejects an out-of-range index the same way the public path does", () => {
    expect(() => deriveSocialReceiveSpendingKey(IDENTITY_PRIV_A, -1)).toThrow(/index/);
    expect(() =>
      deriveSocialReceiveSpendingKey(IDENTITY_PRIV_A, MAX_SOCIAL_RECEIVE_INDEX + 1),
    ).toThrow(/index/);
  });
});
```

- [x] **Step 2: Run the test to verify it fails with "Cannot find module"**

Run: `cd ~/faircoin-core && bun test test/social-receive.test.ts`
Expected: FAIL — `Cannot find module '../src/social-receive.js'`.

- [x] **Step 3: Implement the derivation module**

Create `~/faircoin-core/src/social-receive.ts`:

```ts
/**
 * Identity-key social-receive address scheme.
 *
 * A generic secp256k1 identity-key-derived FairCoin address scheme: given
 * ONLY a public key, anyone can compute a deterministic sequence of FairCoin
 * addresses (`addr(0)`, `addr(1)`, …); given the matching private key, the
 * key holder can derive the spending key for any of those addresses. This
 * lets a payer compute a receive address for a recipient's identity key
 * without any interaction, while only the recipient can ever spend from it.
 *
 * No dependency on Oxy, DID, or `@oxyhq/core` — inputs are generic secp256k1
 * public/private key bytes. Oxy Pay's usage happens to source the public key
 * from an Oxy DID (`resolveDid()`'s `verificationMethod[].publicKeyHex`) and
 * the private key from `@oxyhq/core`'s `KeyManager.getPrivateKey()`/
 * `getSharedPrivateKey()`, but this module has no knowledge of that — it is
 * exactly as generic as `multisig-script.ts`'s multisig scheme.
 *
 * Scheme (both sides compute the SAME deterministic chain code, so a payer
 * and the key holder always agree on `addr(i)`):
 *   IK_pub      = the identity's public key, NORMALIZED to compressed form
 *   IK_priv     = the identity's private key (key holder only)
 *   cc          = HMAC-SHA256(key = SOCIAL_RECEIVE_CHAIN_CODE_KEY, msg = IK_pub)
 *   xpub_social = HDKey({ publicKey: IK_pub,  chainCode: cc, depth: 0 })   // public path
 *   xprv_social = HDKey({ privateKey: IK_priv, chainCode: cc, depth: 0 })  // private path
 *   addr(i)     = publicKeyToAddress(xpub_social.deriveChild(i).publicKey, network)
 *
 * Normalization is load-bearing: a caller may pass either a compressed
 * (33-byte) or uncompressed (65-byte) public key encoding — hashing the raw,
 * un-normalized bytes into the chain code would make the two paths derive
 * DIFFERENT addresses for the SAME key. Every public key entering this
 * module is routed through `@scure/bip32`'s own point-normalization first.
 *
 * Non-hardened derivation only (`index < HARDENED_OFFSET`) — a hardened
 * index would require the private key on the public path, so it is rejected
 * up front with a clear error instead of failing deep inside `@scure/bip32`.
 */
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";
import { HDKey, HARDENED_OFFSET } from "@scure/bip32";
import { publicKeyToAddress } from "./address.js";
import type { NetworkConfig } from "./network.js";

/**
 * HMAC key domain-separating this chain code from every other derivation.
 * Versioned so a future scheme change is a new, non-colliding tag.
 */
const SOCIAL_RECEIVE_CHAIN_CODE_KEY = utf8ToBytes("oxypay/faircoin/social/v1");

/** Highest legal `index` — `@scure/bip32` treats `>= HARDENED_OFFSET` as a hardened child. */
export const MAX_SOCIAL_RECEIVE_INDEX = HARDENED_OFFSET - 1;

function assertValidIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > MAX_SOCIAL_RECEIVE_INDEX) {
    throw new Error(
      `social-receive: index must be an integer in [0, ${MAX_SOCIAL_RECEIVE_INDEX}], got ${index}`,
    );
  }
}

/**
 * Normalize a public key to `@scure/bip32`'s canonical (compressed, 33-byte)
 * representation, regardless of whether the caller passed a compressed or
 * uncompressed encoding. MUST be called before this key is hashed into a
 * chain code or used to construct the branch's `HDKey` — see the module
 * doc-comment's normalization note.
 */
function normalizePublicKey(publicKey: Uint8Array): Uint8Array {
  const probe = new HDKey({ publicKey, depth: 0 });
  if (!probe.publicKey) {
    throw new Error("social-receive: failed to normalize public key");
  }
  return probe.publicKey;
}

/**
 * The deterministic, PUBLIC chain code for a key's social-receive branch.
 * `normalizedPublicKey` MUST already be normalized (compressed) — callers in
 * this module always pass it through {@link normalizePublicKey} or an
 * equivalently-normalized source (a private-key-derived probe) first.
 */
function buildSocialReceiveChainCode(normalizedPublicKey: Uint8Array): Uint8Array {
  return hmac(sha256, SOCIAL_RECEIVE_CHAIN_CODE_KEY, normalizedPublicKey);
}

/**
 * Derive a secp256k1 keypair's own public key (always compressed, 33 bytes)
 * from its private key. Lets the key holder compute its OWN social-receive
 * watch addresses via {@link deriveSocialReceiveAddress} from a SINGLE input
 * (the private key it already holds) instead of separately fetching a public
 * key that could theoretically get out of sync with it.
 */
export function publicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array {
  const probe = new HDKey({ privateKey, depth: 0 });
  if (!probe.publicKey) {
    throw new Error("social-receive: failed to derive public key from private key");
  }
  return probe.publicKey;
}

/**
 * PAYER / BACKEND path — public-only. Compute the FairCoin address a payer
 * would send social-receive child `index` to, from ONLY the recipient's
 * PUBLIC key. Never touches a private key.
 */
export function deriveSocialReceiveAddress(
  identityPublicKey: Uint8Array,
  index: number,
  network: NetworkConfig,
): string {
  assertValidIndex(index);
  const normalized = normalizePublicKey(identityPublicKey);
  const chainCode = buildSocialReceiveChainCode(normalized);
  const xpubSocial = new HDKey({ publicKey: normalized, chainCode, depth: 0 });
  const child = xpubSocial.deriveChild(index);
  if (!child.publicKey) {
    throw new Error("social-receive: failed to derive child public key");
  }
  return publicKeyToAddress(child.publicKey, network);
}

/**
 * RECIPIENT path — holds the PRIVATE key. Derive the spending private key
 * for social-receive child `index`. `publicKeyToAddress` of the matching
 * public key equals what {@link deriveSocialReceiveAddress} computes for the
 * SAME key + index — pinned down by the crypto unit tests.
 */
export function deriveSocialReceiveSpendingKey(
  identityPrivateKey: Uint8Array,
  index: number,
): Uint8Array {
  assertValidIndex(index);
  // The private-key branch's own public key is ALREADY compressed
  // (`@scure/bip32` derives it via `secp.getPublicKey(priv, true)`), so no
  // extra normalization call is needed here.
  const normalized = publicKeyFromPrivateKey(identityPrivateKey);
  const chainCode = buildSocialReceiveChainCode(normalized);
  const xprvSocial = new HDKey({ privateKey: identityPrivateKey, chainCode, depth: 0 });
  const child = xprvSocial.deriveChild(index);
  if (!child.privateKey) {
    throw new Error("social-receive: failed to derive child private key");
  }
  return child.privateKey;
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd ~/faircoin-core && bun test test/social-receive.test.ts`
Expected: PASS — all cases green, including the compressed-vs-uncompressed regression test.

- [x] **Step 5: Export the new symbols**

Modify `~/faircoin-core/src/index.ts` — after the existing `format-amount.js` export block (the last block in the file), add:

```ts
export {
  deriveSocialReceiveAddress,
  deriveSocialReceiveSpendingKey,
  publicKeyFromPrivateKey,
  MAX_SOCIAL_RECEIVE_INDEX,
} from "./social-receive.js";
```

- [x] **Step 6: Run the full package test suite**

Run: `cd ~/faircoin-core && bun test`
Expected: PASS — every existing test file (`address`, `encoding`, `format-amount`, `hd-wallet`, `multisig-script`, `network`, `quark-hash`, `transaction`) plus the new `social-receive.test.ts`, zero regressions.

- [x] **Step 7: Typecheck and build**

```bash
cd ~/faircoin-core
bun run typecheck
bun run build
```
Expected: no errors; `dist/social-receive.js` + `dist/social-receive.d.ts` are emitted.

- [x] **Step 8: Commit (do NOT bump the package version here — see Task 2 for the coordinated bump)**

```bash
cd ~/faircoin-core
git add src/social-receive.ts test/social-receive.test.ts src/index.ts
git commit -m "feat: social-receive address scheme (Oxy Pay spec §4.3, generic secp256k1)"
```

**Coordination note:** this commit lands on whichever branch is agreed for the NEXT `@fairco.in/core` release — check with whoever owns the concurrent `feat/multisig` work (same repo, same package) before choosing a branch, so the two features land in ONE coordinated release rather than two colliding version bumps (see Task 2, Step 1).

---

## Task 2: `@fairco.in/core` — publish (coordinated) and verify propagation (PUBLISH GATE)

> ✅ **DONE (PUBLISH GATE)** — Published `@fairco.in/core@0.3.0` (main `36473da`), propagation verified (derivation vector TGW3g5…Rx5r). Unblocks WS-S backend T3-9 + frontend. 2026-07-19.

Every downstream task in this plan that imports `deriveSocialReceiveAddress`/`deriveSocialReceiveSpendingKey`/`publicKeyFromPrivateKey` is BLOCKED until this task's propagation check is green. **`@oxyhq/core` is NOT part of this gate — it has no changes and no publish in this plan.**

**Coordination (read first):** `~/faircoin-core` is ALSO carrying the multisig Layer-1 work (currently on branch `feat/multisig`, commit `62876ad`, package still at `0.1.0`/published `0.1.1`). Publishing Task 1's social-receive commit as its OWN standalone release, uncoordinated with the multisig branch, risks TWO version bumps racing each other and a consumer resolving an inconsistent state mid-window. Before running Step 1: confirm with whoever owns the multisig plan (`/home/nate/FairCoinWorkspace/FAIRWallet/docs/multisig-layer1-plan.md` Task 6 is `@fairco.in/core`'s own publish gate, `0.1.1` → `0.2.0`) whether social-receive should land ON `feat/multisig` (one combined release) or on a sibling branch merged to `main` in the SAME push as multisig (still one release). Do NOT publish a solo `0.1.2`/`0.2.0` for social-receive alone if multisig is about to publish its own bump — that produces exactly the colliding-version problem this note exists to prevent.

**Files:** none (publish + verification only).

**Interfaces:**
- Consumes: Task 1's committed, pushed `@fairco.in/core` source (merged into whichever branch the coordination above lands on).
- Produces: a published `@fairco.in/core` version resolvable from the public npm registry, carrying BOTH the social-receive exports (this plan) and whatever multisig carries (if coordinated into the same release).

- [x] **Step 1: Confirm the coordinated release plan and the target version**

Check the multisig plan's own publish task (`FAIRWallet/docs/multisig-layer1-plan.md` Task 6) for its current status. If multisig's `0.2.0` bump is imminent or already merged, land social-receive on the SAME branch/version. If multisig is not yet ready, either wait for it or explicitly agree (with whoever owns it) to publish social-receive alone first at the next patch/minor and let multisig bump again afterward — but default to coordinating, not racing.

- [x] **Step 2: Confirm the commit is pushed to `main`**

```bash
cd ~/faircoin-core
git push origin <branch>
```
Merge/push to `main` per the repo's normal flow. **Never `bun publish` from uncommitted or unpushed state** — an out-of-band publish collides with the committed release and permanently burns the version number.

- [x] **Step 3: Bump the version and publish**

```bash
cd ~/faircoin-core
# Set the version per Step 1's coordination decision — do not hardcode a
# number here without checking the multisig release status first.
bun run build
bun publish
```
Expected: npm accepts the coordinated version.

- [x] **Step 4: Verify propagation with a clean external install**

```bash
mkdir -p /tmp/faircoin-core-verify && cd /tmp/faircoin-core-verify
bun init -y
bun add @fairco.in/core@<published-version>
bun run -e "
import('@fairco.in/core').then((core) => {
  const addr = core.deriveSocialReceiveAddress(
    core.hexToBytes('026a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb3'),
    0,
    core.getNetwork('testnet'),
  );
  if (addr !== 'TGW3g56Q5PvpA8UangXnzX6va2MkfaRx5r') throw new Error('propagation vector mismatch: ' + addr);
  console.log('OK', addr);
});
"
```
Expected: prints `OK TGW3g56Q5PvpA8UangXnzX6va2MkfaRx5r`. If it throws `Cannot find module`, the export is missing, or the vector mismatches, STOP — do not proceed to Task 5/11 until this passes. If multisig's exports are also expected in this release, spot-check ONE of those too (e.g. `typeof core.createMultisigRedeemScript === 'function'`) so a coordinated release is verified as a whole, not just the piece this plan added.

- [x] **Step 5: Clean up**

```bash
rm -rf /tmp/faircoin-core-verify
```

---

## Task 3: `@oxypay/shared-types` — social + enrichment contracts

> ✅ **DONE** — commit `09a3a4f`; controller-verified (5 contracts match load-bearing signatures, compile/round-trip test, no scope creep). 2026-07-19.

Adds the wire contracts both the backend routes and the frontend gateway client depend on, following the SAME pattern `paymentIntent.ts` already establishes (a plain interface file, re-exported from the package root).

**Files:**
- Create: `~/Oxy/OxyPay/packages/shared-types/src/social.ts`
- Modify: `~/Oxy/OxyPay/packages/shared-types/src/index.ts`
- Test: `~/Oxy/OxyPay/packages/shared-types/src/__tests__/social.test.ts`

**Interfaces:**
- Produces (consumed by backend Tasks 7, 9 and frontend Task 13):
  - `SocialNextAddressResponse { address: string; index: number }`
  - `EnrichmentKind = 'merchant' | 'user' | 'unknown'`
  - `EnrichmentResult { kind: EnrichmentKind; displayName?: string; avatarFileId?: string; username?: string; description?: string }`
  - `EnrichRequest { addresses: string[] }`
  - `EnrichResponse { data: Record<string, EnrichmentResult> }`

- [x] **Step 1: Write the failing test**

Create `~/Oxy/OxyPay/packages/shared-types/src/__tests__/social.test.ts`:

```ts
import { test, expect } from "bun:test";
import type {
  SocialNextAddressResponse,
  EnrichmentResult,
  EnrichRequest,
  EnrichResponse,
} from "../social";

test("SocialNextAddressResponse shape compiles and round-trips through JSON", () => {
  const value: SocialNextAddressResponse = { address: "TAbC123", index: 3 };
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
});

test("EnrichmentResult supports all three kinds", () => {
  const merchant: EnrichmentResult = {
    kind: "merchant",
    displayName: "Mercaria",
    avatarFileId: "file_1",
    description: "Marketplace",
  };
  const user: EnrichmentResult = {
    kind: "user",
    displayName: "Alice",
    username: "alice",
    avatarFileId: "file_2",
  };
  const unknown: EnrichmentResult = { kind: "unknown" };
  expect(merchant.kind).toBe("merchant");
  expect(user.kind).toBe("user");
  expect(unknown.kind).toBe("unknown");
});

test("EnrichRequest / EnrichResponse round-trip", () => {
  const req: EnrichRequest = { addresses: ["TAbC123", "TDeF456"] };
  const res: EnrichResponse = {
    data: {
      TAbC123: { kind: "unknown" },
      TDeF456: { kind: "merchant", displayName: "Shop" },
    },
  };
  expect(Object.keys(res.data)).toEqual(req.addresses);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/shared-types && bun test src/__tests__/social.test.ts`
Expected: FAIL — `Cannot find module '../social'`.

- [x] **Step 3: Implement the contract**

Create `~/Oxy/OxyPay/packages/shared-types/src/social.ts`:

```ts
// Social-receive + transaction-enrichment contracts — shared by the Oxy Pay
// Gateway backend, the wallet frontend, and (indirectly) the enrichment
// service's callers. Mirrors the Stripe-parity style of paymentIntent.ts.

/** Response of `POST /v1/social/:username/next_address` (spec §4.4 step 3). */
export interface SocialNextAddressResponse {
  address: string;
  index: number;
}

/** Where a transaction's counterparty identity came from (spec §4.8). */
export type EnrichmentKind = 'merchant' | 'user' | 'unknown';

/**
 * Display-only counterparty identity for one address/txid, resolved by
 * `POST /v1/enrich`. Never affects custody; a failed/partial resolution
 * degrades to `{ kind: 'unknown' }`.
 */
export interface EnrichmentResult {
  kind: EnrichmentKind;
  /** Merchant name or user's `name.displayName ?? handle`. */
  displayName?: string;
  /** Bare Oxy file id — render via the canonical media chokepoint, never a URL. */
  avatarFileId?: string;
  /** Present for `kind: 'user'` only. */
  username?: string;
  /** Present for `kind: 'merchant'` only. */
  description?: string;
}

export interface EnrichRequest {
  addresses: string[];
}

export interface EnrichResponse {
  data: Record<string, EnrichmentResult>;
}
```

- [x] **Step 4: Export from the package root**

Modify `~/Oxy/OxyPay/packages/shared-types/src/index.ts` — append:

```ts
export {
  type SocialNextAddressResponse,
  type EnrichmentKind,
  type EnrichmentResult,
  type EnrichRequest,
  type EnrichResponse,
} from './social';
```

- [x] **Step 5: Run the test and the package build**

```bash
cd ~/Oxy/OxyPay/packages/shared-types
bun test src/__tests__/social.test.ts
bun run build
```
Expected: test PASS; `bun run build` emits `dist/social.js` + `dist/social.d.ts` with no errors.

- [x] **Step 6: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/shared-types/src/social.ts packages/shared-types/src/index.ts packages/shared-types/src/__tests__/social.test.ts
git commit -m "feat(shared-types): social-receive + enrichment contracts (spec §4.4, §4.8)"
```

---

## Task 4: Backend — `Merchant` model gains display identity

> ✅ **DONE** — commit `d06116e`; task-review Approved (0 issues). Optional display fields; firewall+index untouched; adapted fixtures for Fase2 required environment/publicId. 2026-07-19.

Independent of everything else — a merchant's "Paid at <name>" identity (spec §4.8 bullet 1) is stored once on the `Merchant` doc, not re-supplied on every `PaymentIntent`.

**Files:**
- Modify: `~/Oxy/OxyPay/packages/backend/src/models/Merchant.ts`
- Test: `~/Oxy/OxyPay/packages/backend/src/models/__tests__/models.test.ts` (extend the existing file)

**Interfaces:**
- Produces: `MerchantDoc.displayName?: string`, `MerchantDoc.avatarFileId?: string`, `MerchantDoc.description?: string` — consumed by Task 8's `enrichAddresses`.

- [x] **Step 1: Write the failing test**

Modify `~/Oxy/OxyPay/packages/backend/src/models/__tests__/models.test.ts` — add after the existing `"saves a Merchant with a watch-only testnet xpub"` test:

```ts
test("saves a Merchant with optional display identity fields", async () => {
  const merchant = await Merchant.create({
    oxyAppId: "app_with_identity",
    network: "testnet",
    xpub: XPUB,
    displayName: "Mercaria",
    avatarFileId: "file_mercaria_logo",
    description: "Marketplace",
  });

  expect(merchant.displayName).toBe("Mercaria");
  expect(merchant.avatarFileId).toBe("file_mercaria_logo");
  expect(merchant.description).toBe("Marketplace");
});

test("display identity fields are optional (existing merchants unaffected)", async () => {
  const merchant = await Merchant.create({
    oxyAppId: "app_no_identity",
    network: "testnet",
    xpub: XPUB,
  });

  expect(merchant.displayName).toBeUndefined();
  expect(merchant.avatarFileId).toBeUndefined();
  expect(merchant.description).toBeUndefined();
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/models/__tests__/models.test.ts`
Expected: FAIL — `displayName` is `undefined` was expected to be `"Mercaria"` (the field doesn't exist on the schema yet, Mongoose silently drops unknown fields, so the create succeeds but the field is absent).

- [x] **Step 3: Implement**

Modify `~/Oxy/OxyPay/packages/backend/src/models/Merchant.ts`:

```ts
export interface MerchantDoc {
  oxyAppId: string;
  network: NetworkType;
  xpub: string;
  nextDerivationIndex: number;
  webhookUrl?: string;
  webhookSecret?: string;
  requiredConfirmations: number;
  livemode: boolean;
  /** Display name shown in the payer's transaction history ("Paid at <name>"). */
  displayName?: string;
  /** Bare Oxy file id for the merchant's logo — canonical media chokepoint. */
  avatarFileId?: string;
  /** Short description shown alongside the merchant identity. */
  description?: string;
}

const merchantSchema = new Schema<MerchantDoc>(
  {
    oxyAppId: { type: String, required: true, unique: true },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    xpub: { type: String, required: true },
    nextDerivationIndex: { type: Number, default: 0 },
    webhookUrl: { type: String },
    webhookSecret: { type: String },
    requiredConfirmations: { type: Number, default: 1 },
    livemode: { type: Boolean, default: false },
    displayName: { type: String },
    avatarFileId: { type: String },
    description: { type: String },
  },
  { timestamps: true },
);
```

(Only the interface and the schema's field list change; the rest of the file — the non-custody `pre('validate')` hook and the model export — is unchanged.)

- [x] **Step 4: Run it to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/models/__tests__/models.test.ts`
Expected: PASS — all tests in the file, including the pre-existing ones (no regression).

- [x] **Step 5: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/backend/src/models/Merchant.ts packages/backend/src/models/__tests__/models.test.ts
git commit -m "feat(backend): Merchant gains display identity fields (spec §4.8 bullet 1)"
```

---

## Task 5: Backend — `SocialReceiveCursor` model + `reserveNextSocialAddress` service

> ✅ **DONE** — commit `76ebe83`; task-review Approved. Atomic reservation (verified via real concurrency test), public-key-only, @fairco.in/core bumped→0.3.0 (zero gateway regression, 119/119). 2026-07-19.

The user-identity equivalent of `Merchant.nextDerivationIndex` + `reserveNextAddress` — lazily created (no merchant-style pre-registration exists for an ordinary Oxy user), atomic, and starting at index 1 (index 0 is the recipient's stable default address, never handed out by this reservation flow). BLOCKED on Task 2.

**Files:**
- Create: `~/Oxy/OxyPay/packages/backend/src/models/SocialReceiveCursor.ts`
- Create: `~/Oxy/OxyPay/packages/backend/src/services/socialReceive.ts`
- Test: `~/Oxy/OxyPay/packages/backend/src/models/__tests__/socialReceive.test.ts`
- Modify: `~/Oxy/OxyPay/packages/backend/package.json` — bump `@fairco.in/core` from its currently-pinned `^0.1.1` to the coordinated version Task 2 publishes; add `@oxyhq/contracts` `^0.17.0` as a devDependency (test-only `DidDocument` type — the service itself never imports it explicitly, relying on `oxyClient.resolveDid()`'s inferred return type). `@oxyhq/core` stays at its CURRENT pin (`^12.5.0`) — it has no WS-S changes, no bump needed.

**Interfaces:**
- Consumes: `deriveSocialReceiveAddress` (`@fairco.in/core`, Task 1/2 — bumped, not `@oxyhq/core`), `oxyClient` (`@oxyhq/core`, already imported elsewhere in this backend, UNCHANGED version), `oxyClient.resolveDid(userId): Promise<DidDocument>` (public, no auth), `getNetwork`/`hexToBytes` (`@fairco.in/core`, same package as the derivation function — one import, not two).
- Produces (consumed by Task 7's route):
  - `SOCIAL_RECEIVE_FIRST_FRESH_INDEX = 1`
  - `resolveIdentityPublicKey(oxyUserId: string): Promise<Uint8Array | null>`
  - `reserveNextSocialAddress(oxyUserId: string, network: NetworkType): Promise<{ index: number; address: string } | null>` — `null` means the recipient is keyless.

- [x] **Step 1: Bump the `@fairco.in/core` dependency and add the test-only `@oxyhq/contracts` devDependency**

Modify `~/Oxy/OxyPay/packages/backend/package.json`: bump `"@fairco.in/core": "^0.1.1"` to the version Task 2 actually publishes (do NOT bump `@oxyhq/core` — it is untouched by WS-S); add `"@oxyhq/contracts": "^0.17.0"` to `devDependencies` (only used by the test file below to type-shape a mock `DidDocument` — the service itself relies on `oxyClient.resolveDid()`'s own inferred return type and never imports the contract directly, per the ecosystem rule that `@oxyhq/core` does not re-export contract types).

```bash
cd ~/Oxy/OxyPay
bun install
```
Expected: `bun.lock` updates to resolve the bumped `@fairco.in/core` and the new `@oxyhq/contracts@0.17.0`. `@oxyhq/core`'s resolved version is unchanged.

- [x] **Step 2: Write the failing test**

Create `~/Oxy/OxyPay/packages/backend/src/models/__tests__/socialReceive.test.ts`:

```ts
import { test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hexToBytes, getNetwork, deriveSocialReceiveAddress } from "@fairco.in/core";
import { SocialReceiveCursor } from "../SocialReceiveCursor";

// Same pinned identity used by @fairco.in/core's social-receive.test.ts.
const IDENTITY_PUB_A_UNCOMPRESSED = hexToBytes(
  "046a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb336b6fbcb60b5b3d4f1551ac45e5ffc4936466e7d98f6c7c0ec736539f74691a6",
);

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await SocialReceiveCursor.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await SocialReceiveCursor.deleteMany({});
});

// oxyClient.resolveDid is mocked at the module level for the service test
// below (Step-8 file); this file exercises ONLY the model + the pure address
// math, so it needs no network mock.
test("SocialReceiveCursor defaults nextDerivationIndex to 1 (index 0 is never reserved)", async () => {
  const cursor = await SocialReceiveCursor.create({
    oxyUserId: "user_1",
    network: "testnet",
  });
  expect(cursor.nextDerivationIndex).toBe(1);
});

test("(oxyUserId, network) is unique", async () => {
  await SocialReceiveCursor.create({ oxyUserId: "user_2", network: "testnet" });
  await expect(
    SocialReceiveCursor.create({ oxyUserId: "user_2", network: "testnet" }),
  ).rejects.toThrow();
});

test("the same user can have independent cursors per network", async () => {
  await SocialReceiveCursor.create({ oxyUserId: "user_3", network: "testnet" });
  const mainnetCursor = await SocialReceiveCursor.create({
    oxyUserId: "user_3",
    network: "mainnet",
  });
  expect(mainnetCursor.nextDerivationIndex).toBe(1);
});

test("sanity: deriveSocialReceiveAddress(pubkey, 1, testnet) matches the pinned vector", () => {
  const network = getNetwork("testnet");
  expect(deriveSocialReceiveAddress(IDENTITY_PUB_A_UNCOMPRESSED, 1, network)).toBe(
    "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
  );
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/models/__tests__/socialReceive.test.ts`
Expected: FAIL — `Cannot find module '../SocialReceiveCursor'`.

- [x] **Step 4: Implement the model**

Create `~/Oxy/OxyPay/packages/backend/src/models/SocialReceiveCursor.ts`:

```ts
import { Schema, model } from "mongoose";
import type { NetworkType } from "@fairco.in/core";

/**
 * Per-(user, network) counter for the social-receive address branch (design
 * spec §4.3). Mirrors `Merchant.nextDerivationIndex`'s atomic-reservation
 * pattern, but is lazily created on a user's FIRST social payment (there is
 * no merchant-style pre-registration step for an ordinary Oxy user) and
 * starts at index 1 — index 0 is the recipient's stable default/favourite
 * address and is never handed out through this reservation flow.
 */
export interface SocialReceiveCursorDoc {
  oxyUserId: string;
  network: NetworkType;
  nextDerivationIndex: number;
}

const socialReceiveCursorSchema = new Schema<SocialReceiveCursorDoc>({
  oxyUserId: { type: String, required: true },
  network: { type: String, enum: ["mainnet", "testnet"], required: true },
  nextDerivationIndex: { type: Number, default: 1 },
});

socialReceiveCursorSchema.index({ oxyUserId: 1, network: 1 }, { unique: true });

export const SocialReceiveCursor = model<SocialReceiveCursorDoc>(
  "SocialReceiveCursor",
  socialReceiveCursorSchema,
);
```

- [x] **Step 5: Run it to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/models/__tests__/socialReceive.test.ts`
Expected: PASS.

- [x] **Step 6: Write the failing test for the reservation service**

Create `~/Oxy/OxyPay/packages/backend/src/services/__tests__/socialReceive.test.ts`:

```ts
import { test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { DidDocument } from "@oxyhq/contracts";
import { SocialReceiveCursor } from "../../models/SocialReceiveCursor";

const IDENTITY_PUB_A_UNCOMPRESSED_HEX =
  "046a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb336b6fbcb60b5b3d4f1551ac45e5ffc4936466e7d98f6c7c0ec736539f74691a6";

function didWithKey(userId: string, publicKeyHex: string | null): DidDocument {
  return {
    "@context": [],
    id: `did:web:oxy.so:u:${userId}`,
    controller: [],
    verificationMethod: publicKeyHex
      ? [
          {
            id: `did:web:oxy.so:u:${userId}#key-1`,
            type: "EcdsaSecp256k1VerificationKey2019",
            controller: `did:web:oxy.so:u:${userId}`,
            publicKeyHex,
          },
        ]
      : [],
    authentication: [],
    assertionMethod: [],
    alsoKnownAs: [],
    service: [],
  };
}

const resolveDidMock = mock(async (userId: string) => didWithKey(userId, IDENTITY_PUB_A_UNCOMPRESSED_HEX));

mock.module("@oxyhq/core", () => ({
  oxyClient: { resolveDid: resolveDidMock },
}));

const { resolveIdentityPublicKey, reserveNextSocialAddress, SOCIAL_RECEIVE_FIRST_FRESH_INDEX } =
  await import("../socialReceive");

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await SocialReceiveCursor.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await SocialReceiveCursor.deleteMany({});
  resolveDidMock.mockClear();
  resolveDidMock.mockImplementation(async (userId: string) => didWithKey(userId, IDENTITY_PUB_A_UNCOMPRESSED_HEX));
});

test("SOCIAL_RECEIVE_FIRST_FRESH_INDEX is 1", () => {
  expect(SOCIAL_RECEIVE_FIRST_FRESH_INDEX).toBe(1);
});

test("resolveIdentityPublicKey returns the decoded secp256k1 key for a self-sovereign user", async () => {
  const key = await resolveIdentityPublicKey("user_a");
  expect(key).not.toBeNull();
});

test("resolveIdentityPublicKey returns null for a keyless (custodial) user", async () => {
  resolveDidMock.mockImplementationOnce(async (userId: string) => didWithKey(userId, null));
  const key = await resolveIdentityPublicKey("user_keyless");
  expect(key).toBeNull();
});

test("reserveNextSocialAddress claims index 1, 2, 3 in order with distinct addresses (index 0 never handed out)", async () => {
  const first = await reserveNextSocialAddress("user_a", "testnet");
  const second = await reserveNextSocialAddress("user_a", "testnet");
  const third = await reserveNextSocialAddress("user_a", "testnet");

  expect(first).toEqual({ index: 1, address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ" });
  expect(second).toEqual({ index: 2, address: "TVsFKn7zkDN1QnMNe1thrJUEXBGiqnu19g" });
  expect(third?.index).toBe(3);

  const addresses = new Set([first?.address, second?.address, third?.address]);
  expect(addresses.size).toBe(3);
});

test("reserveNextSocialAddress returns null for a keyless recipient (spec §4.5 invite path)", async () => {
  resolveDidMock.mockImplementationOnce(async (userId: string) => didWithKey(userId, null));
  const result = await reserveNextSocialAddress("user_keyless", "testnet");
  expect(result).toBeNull();
});

test("concurrent first-time reservations for the same user never collide on an index", async () => {
  const [a, b, c] = await Promise.all([
    reserveNextSocialAddress("user_concurrent", "testnet"),
    reserveNextSocialAddress("user_concurrent", "testnet"),
    reserveNextSocialAddress("user_concurrent", "testnet"),
  ]);
  const indexes = [a?.index, b?.index, c?.index];
  expect(new Set(indexes).size).toBe(3);
  expect(indexes.every((i) => typeof i === "number" && i >= 1)).toBe(true);
});
```

- [x] **Step 7: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/services/__tests__/socialReceive.test.ts`
Expected: FAIL — `Cannot find module '../socialReceive'`.

- [x] **Step 8: Implement the service**

Create `~/Oxy/OxyPay/packages/backend/src/services/socialReceive.ts`:

```ts
import { getNetwork, hexToBytes, deriveSocialReceiveAddress } from "@fairco.in/core";
import type { NetworkType } from "@fairco.in/core";
import { oxyClient } from "@oxyhq/core";
import { SocialReceiveCursor } from "../models/SocialReceiveCursor";

/**
 * First index this reservation flow ever hands out. Index 0 is the
 * recipient's stable default/favourite address — computed on-device from the
 * identity key, never reserved through the backend (spec §4.3).
 */
export const SOCIAL_RECEIVE_FIRST_FRESH_INDEX = 1;

const SECP256K1_VERIFICATION_METHOD_TYPE = "EcdsaSecp256k1VerificationKey2019";
const MONGO_DUPLICATE_KEY = 11000;

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === MONGO_DUPLICATE_KEY
  );
}

/**
 * Resolve `oxyUserId`'s identity secp256k1 public key from their DID document
 * (`GET /u/:userId/did.json`, public — no auth). Returns `null` for a
 * KEYLESS (custodial) account: no `identity` auth method, hence no
 * `EcdsaSecp256k1VerificationKey2019` verification method to derive from.
 */
export async function resolveIdentityPublicKey(
  oxyUserId: string,
): Promise<Uint8Array | null> {
  const doc = await oxyClient.resolveDid(oxyUserId);
  const vm = doc.verificationMethod.find(
    (entry) => entry.type === SECP256K1_VERIFICATION_METHOD_TYPE,
  );
  if (!vm || !("publicKeyHex" in vm)) {
    return null;
  }
  return hexToBytes(vm.publicKeyHex);
}

/**
 * Atomically claim the next unused social-receive index for `oxyUserId` and
 * derive its FairCoin address — the user-identity equivalent of
 * `reserveNextAddress` (merchant flow), reusing the SAME public-only
 * derivation primitive (`deriveSocialReceiveAddress`, published from
 * `@fairco.in/core`). The backend only ever handles the recipient's PUBLIC
 * identity key; it never sees or stores a private key.
 *
 * Returns `null` when the recipient is keyless (no identity key to derive
 * from) — callers surface the "invite them to set up Oxy Pay" flow (spec
 * §4.5) instead of a send.
 *
 * Lazily creates the per-user cursor on first use (no merchant-style
 * pre-registration exists for an ordinary user): the cursor is first
 * `create`d starting at {@link SOCIAL_RECEIVE_FIRST_FRESH_INDEX}, tolerating
 * the race where two concurrent first-payments both attempt the insert (the
 * unique index on `(oxyUserId, network)` lets exactly one win; the loser's
 * duplicate-key error is expected and ignored). Only AFTER the cursor is
 * guaranteed to exist does the atomic `$inc`/`new:false` claim run, so the
 * returned index is always the exact value THIS call reserved — the same
 * pre-increment-read contract `reserveNextAddress` relies on.
 */
export async function reserveNextSocialAddress(
  oxyUserId: string,
  network: NetworkType,
): Promise<{ index: number; address: string } | null> {
  const identityPublicKey = await resolveIdentityPublicKey(oxyUserId);
  if (!identityPublicKey) {
    return null;
  }

  try {
    await SocialReceiveCursor.create({
      oxyUserId,
      network,
      nextDerivationIndex: SOCIAL_RECEIVE_FIRST_FRESH_INDEX,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      throw err;
    }
    // Another concurrent first-payment already created the cursor — proceed
    // to the atomic increment below, which now finds it.
  }

  const cursor = await SocialReceiveCursor.findOneAndUpdate(
    { oxyUserId, network },
    { $inc: { nextDerivationIndex: 1 } },
    { new: false },
  );
  if (!cursor) {
    throw new Error(
      `social receive cursor vanished unexpectedly for user ${oxyUserId}`,
    );
  }

  const index = cursor.nextDerivationIndex;
  const address = deriveSocialReceiveAddress(identityPublicKey, index, getNetwork(network));
  return { index, address };
}
```

- [x] **Step 9: Run it to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/services/__tests__/socialReceive.test.ts src/models/__tests__/socialReceive.test.ts`
Expected: PASS — all cases, including the concurrency test.

- [x] **Step 10: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/backend/package.json bun.lock \
  packages/backend/src/models/SocialReceiveCursor.ts \
  packages/backend/src/services/socialReceive.ts \
  packages/backend/src/models/__tests__/socialReceive.test.ts \
  packages/backend/src/services/__tests__/socialReceive.test.ts
git commit -m "feat(backend): social-receive address reservation service (spec §4.3, §5)"
```

---

## Task 6: Backend — `SocialSendAttribution` model

> ✅ **DONE** — commit `c761511`; controller-verified (doc shape + unique (address,network) index; collision/cross-network tests). 2026-07-19.

Independent of Task 5 (no core dependency) — records that a social-receive address was minted for a specific sender→recipient payment, at the moment it's reserved. Keyed by the on-chain address, since every non-default (index ≥ 1) social-receive address is single-use: `(address, network)` uniquely identifies ONE payment relationship. This is the join table Task 8's enrichment service reads to answer both "who did I send to" and "who sent to me" from the SAME row (spec §4.8 bullets 2 and 3).

**Files:**
- Create: `~/Oxy/OxyPay/packages/backend/src/models/SocialSendAttribution.ts`
- Test: `~/Oxy/OxyPay/packages/backend/src/models/__tests__/socialSendAttribution.test.ts`

**Interfaces:**
- Produces: `SocialSendAttribution` (Mongoose model), `SocialSendAttributionDoc { address, network, senderUserId, recipientUserId, index }` — created by Task 7's route, read by Task 8's enrichment service.

- [x] **Step 1: Write the failing test**

Create `~/Oxy/OxyPay/packages/backend/src/models/__tests__/socialSendAttribution.test.ts`:

```ts
import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { SocialSendAttribution } from "../SocialSendAttribution";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await SocialSendAttribution.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await SocialSendAttribution.deleteMany({});
});

test("records a sender -> recipient attribution for a social-receive address", async () => {
  const row = await SocialSendAttribution.create({
    address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
    network: "testnet",
    senderUserId: "user_sender",
    recipientUserId: "user_recipient",
    index: 1,
  });

  expect(row.senderUserId).toBe("user_sender");
  expect(row.recipientUserId).toBe("user_recipient");
  expect(row.index).toBe(1);
});

test("(address, network) is unique — a reused address collides", async () => {
  await SocialSendAttribution.create({
    address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
    network: "testnet",
    senderUserId: "user_a",
    recipientUserId: "user_b",
    index: 1,
  });

  await expect(
    SocialSendAttribution.create({
      address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
      network: "testnet",
      senderUserId: "user_c",
      recipientUserId: "user_d",
      index: 7,
    }),
  ).rejects.toThrow();
});

test("the same address string is independent across networks", async () => {
  await SocialSendAttribution.create({
    address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
    network: "testnet",
    senderUserId: "user_a",
    recipientUserId: "user_b",
    index: 1,
  });

  const mainnetRow = await SocialSendAttribution.create({
    address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
    network: "mainnet",
    senderUserId: "user_e",
    recipientUserId: "user_f",
    index: 1,
  });

  expect(mainnetRow.network).toBe("mainnet");
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/models/__tests__/socialSendAttribution.test.ts`
Expected: FAIL — `Cannot find module '../SocialSendAttribution'`.

- [x] **Step 3: Implement**

Create `~/Oxy/OxyPay/packages/backend/src/models/SocialSendAttribution.ts`:

```ts
import { Schema, model } from "mongoose";
import type { NetworkType } from "@fairco.in/core";

/**
 * Records that a social-receive address (design spec §4.3) was minted for a
 * specific sender→recipient social payment (spec §4.8, bullets 2 and 3).
 * Keyed by the on-chain `address` — every non-default (index >= 1)
 * social-receive address is single-use, so `(address, network)` uniquely
 * identifies ONE payment relationship. Read by the enrichment service to
 * render "Sent to @alice" (sender's view) / "Received from @bob" (recipient's
 * view) without ever touching a private key.
 */
export interface SocialSendAttributionDoc {
  address: string;
  network: NetworkType;
  senderUserId: string;
  recipientUserId: string;
  index: number;
}

const socialSendAttributionSchema = new Schema<SocialSendAttributionDoc>(
  {
    address: { type: String, required: true },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    senderUserId: { type: String, required: true },
    recipientUserId: { type: String, required: true },
    index: { type: Number, required: true },
  },
  { timestamps: true },
);

socialSendAttributionSchema.index({ address: 1, network: 1 }, { unique: true });

export const SocialSendAttribution = model<SocialSendAttributionDoc>(
  "SocialSendAttribution",
  socialSendAttributionSchema,
);
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/models/__tests__/socialSendAttribution.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/backend/src/models/SocialSendAttribution.ts packages/backend/src/models/__tests__/socialSendAttribution.test.ts
git commit -m "feat(backend): SocialSendAttribution model (spec §4.8 bullets 2-3)"
```

---

## Task 7: Backend — `POST /v1/social/:username/next_address` route

> ✅ **DONE** — commit `bb11f17`+fixes `e1e8105`/`5d26333` (1 fix cycle); re-review Approved. Anti-spoof senderUserId, 4 status codes; review caught a silent catch (fixed: 404 vs 502 upstream) + defused a process-wide mock.module test landmine. 2026-07-19.

The social-send route (spec §4.4 step 3, §6): resolves `@username` → `userId`, reserves the next social-receive index (Task 5), and records the attribution (Task 6) in the SAME request — the reservation and the attribution are created atomically from the caller's point of view, so an enrichment lookup can never observe a reserved address with no attribution row. BLOCKED on Tasks 3, 5, 6.

**Files:**
- Create: `~/Oxy/OxyPay/packages/backend/src/routes/social.ts`
- Test: `~/Oxy/OxyPay/packages/backend/src/routes/__tests__/social.test.ts`

**Interfaces:**
- Consumes: `reserveNextSocialAddress` (Task 5), `SocialSendAttribution` (Task 6), `SocialNextAddressResponse` (Task 3), `oxyClient` + `createOxyAuthMiddleware`/`getRequiredOxyUserId` (`@oxyhq/core`, `@oxyhq/core/server`).
- Produces: `createSocialRouter(deps?: { requireOxyUser?: RequestHandler }): Router` — mounted by Task 9 into `createGateway`.
- Wire contract: `POST /v1/social/:username/next_address` — auth: Oxy bearer (the PAYER's own session). Body `{ network: 'mainnet' | 'testnet' }`. `200 { address, index }` on success. `404 { error: { type: 'invalid_request_error' } }` — recipient username not found. `409 { error: { type: 'keyless_recipient' } }` — recipient has no identity key (spec §4.5 invite path — a DISTINCT status from `422` so the frontend can branch on `.status` alone). `422 { error: { type: 'invalid_request_error' } }` — malformed body or self-pay.

- [x] **Step 1: Write the failing route test**

Create `~/Oxy/OxyPay/packages/backend/src/routes/__tests__/social.test.ts`:

```ts
import { test, expect, beforeAll, afterAll, beforeEach, describe, mock } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { OxyAuthRequest } from "@oxyhq/core/server";
import type { User } from "@oxyhq/core";
import type { DidDocument } from "@oxyhq/contracts";
import { SocialReceiveCursor } from "../../models/SocialReceiveCursor";
import { SocialSendAttribution } from "../../models/SocialSendAttribution";

const IDENTITY_PUB_A_UNCOMPRESSED_HEX =
  "046a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb336b6fbcb60b5b3d4f1551ac45e5ffc4936466e7d98f6c7c0ec736539f74691a6";

const PROFILES: Record<string, { id: string; username: string }> = {
  alice: { id: "user_alice", username: "alice" },
  keylessbob: { id: "user_keylessbob", username: "keylessbob" },
};

function didFor(userId: string): DidDocument {
  const hasKey = userId !== "user_keylessbob";
  return {
    "@context": [],
    id: `did:web:oxy.so:u:${userId}`,
    controller: [],
    verificationMethod: hasKey
      ? [
          {
            id: `did:web:oxy.so:u:${userId}#key-1`,
            type: "EcdsaSecp256k1VerificationKey2019",
            controller: `did:web:oxy.so:u:${userId}`,
            publicKeyHex: IDENTITY_PUB_A_UNCOMPRESSED_HEX,
          },
        ]
      : [],
    authentication: [],
    assertionMethod: [],
    alsoKnownAs: [],
    service: [],
  };
}

const getProfileByUsernameMock = mock(async (username: string) => {
  const profile = PROFILES[username];
  if (!profile) throw new Error("not found");
  return profile as unknown as User;
});
const resolveDidMock = mock(async (userId: string) => didFor(userId));

mock.module("@oxyhq/core", () => ({
  oxyClient: {
    getProfileByUsername: getProfileByUsernameMock,
    resolveDid: resolveDidMock,
  },
}));

const { createSocialRouter } = await import("../social");

const TEST_SENDER_ID = "user_test_sender";
const stubRequireOxyUser: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).userId = TEST_SENDER_ID;
  next();
};

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;

interface NextAddressResponse {
  address?: string;
  index?: number;
  error?: { type: string; message: string };
}

async function postNextAddress(
  username: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: NextAddressResponse }> {
  const res = await fetch(`${baseUrl}/v1/social/${username}/next_address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as NextAddressResponse };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await SocialReceiveCursor.init();
  await SocialSendAttribution.init();

  const app = express();
  app.use(express.json());
  app.use(createSocialRouter({ requireOxyUser: stubRequireOxyUser }));

  server = app.listen(0);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await SocialReceiveCursor.deleteMany({});
  await SocialSendAttribution.deleteMany({});
});

describe("POST /v1/social/:username/next_address", () => {
  test("reserves a fresh address and records the attribution", async () => {
    const { status, body } = await postNextAddress("alice", { network: "testnet" });

    expect(status).toBe(200);
    expect(body.index).toBe(1);
    expect(body.address).toBe("TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ");

    const attribution = await SocialSendAttribution.findOne({ address: body.address });
    expect(attribution?.senderUserId).toBe(TEST_SENDER_ID);
    expect(attribution?.recipientUserId).toBe("user_alice");
    expect(attribution?.index).toBe(1);
  });

  test("second call for the same recipient reserves the next index", async () => {
    await postNextAddress("alice", { network: "testnet" });
    const { body } = await postNextAddress("alice", { network: "testnet" });
    expect(body.index).toBe(2);
  });

  test("404s for an unknown username", async () => {
    const { status, body } = await postNextAddress("nobody", { network: "testnet" });
    expect(status).toBe(404);
    expect(body.error?.type).toBe("invalid_request_error");
  });

  test("409s with type keyless_recipient for a keyless recipient", async () => {
    const { status, body } = await postNextAddress("keylessbob", { network: "testnet" });
    expect(status).toBe(409);
    expect(body.error?.type).toBe("keyless_recipient");
  });

  test("422s on a malformed network field", async () => {
    const { status, body } = await postNextAddress("alice", { network: "regtest" });
    expect(status).toBe(422);
    expect(body.error?.type).toBe("invalid_request_error");
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/routes/__tests__/social.test.ts`
Expected: FAIL — `Cannot find module '../social'`.

- [x] **Step 3: Implement the route**

Create `~/Oxy/OxyPay/packages/backend/src/routes/social.ts`:

```ts
import { Router } from "express";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { createOxyAuthMiddleware, getRequiredOxyUserId } from "@oxyhq/core/server";
import type { SocialNextAddressResponse } from "@oxypay/shared-types";
import { reserveNextSocialAddress } from "../services/socialReceive";
import { SocialSendAttribution } from "../models/SocialSendAttribution";

const nextAddressBodySchema = z.object({
  network: z.enum(["mainnet", "testnet"]),
});

// Stripe-ish error envelope: `{ error: { type, message } }` — matches
// `paymentIntents.ts`'s convention exactly.
function sendError(
  res: Response,
  status: number,
  type: string,
  message: string,
): void {
  res.status(status).json({ error: { type, message } });
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
function wrap(handler: AsyncHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

/**
 * Build the social-receive REST router (spec §4.4 step 3, §4.8 bullets 2-3).
 *
 * `requireOxyUser` is injectable so tests can bypass a real Oxy bearer token
 * with a stub that populates `req.userId`; production defaults to
 * `createOxyAuthMiddleware(oxyClient)` — the PAYER's own signed-in Oxy
 * session, distinct from the merchant service-auth `paymentIntents.ts` uses.
 */
export function createSocialRouter(deps?: { requireOxyUser?: RequestHandler }): Router {
  const requireOxyUser: RequestHandler =
    deps?.requireOxyUser ?? createOxyAuthMiddleware(oxyClient);
  const router = Router();

  router.post(
    "/v1/social/:username/next_address",
    requireOxyUser,
    wrap(async (req, res) => {
      const senderUserId = getRequiredOxyUserId(req);

      const parsed = nextAddressBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid request body",
        );
        return;
      }
      const { network } = parsed.data;

      let recipient: { id: string };
      try {
        recipient = await oxyClient.getProfileByUsername(req.params.username);
      } catch {
        sendError(res, 404, "invalid_request_error", "recipient not found");
        return;
      }

      if (recipient.id === senderUserId) {
        sendError(res, 422, "invalid_request_error", "cannot pay yourself");
        return;
      }

      const reservation = await reserveNextSocialAddress(recipient.id, network);
      if (!reservation) {
        sendError(
          res,
          409,
          "keyless_recipient",
          "recipient has not set up an Oxy identity yet",
        );
        return;
      }

      await SocialSendAttribution.create({
        address: reservation.address,
        network,
        senderUserId,
        recipientUserId: recipient.id,
        index: reservation.index,
      });

      const body: SocialNextAddressResponse = {
        address: reservation.address,
        index: reservation.index,
      };
      res.status(200).json(body);
    }),
  );

  return router;
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/routes/__tests__/social.test.ts`
Expected: PASS — all cases, including the 404/409/422 branches.

- [x] **Step 5: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/backend/src/routes/social.ts packages/backend/src/routes/__tests__/social.test.ts
git commit -m "feat(backend): POST /v1/social/:username/next_address (spec §4.4, §4.5, §4.8)"
```

---

## Task 8: Backend — `enrichAddresses` service

> ✅ **DONE** — commit `b1a6c9a`+fix `398c5d5` (1 fix cycle); re-verified. Viewer-scoping moved into the DB query (structurally safe); merchant branch public-by-design; Proxy mock. 2026-07-19.

The read side of spec §4.8: given a batch of the CALLER's own addresses, resolve merchant identity (via `PaymentIntent` → `Merchant`, Task 4) or social counterparty identity (via `SocialSendAttribution`, Task 6, joined against `oxyClient.getUsersByIds`), scoped so a caller can never see a counterparty for an address they weren't party to. BLOCKED on Tasks 4, 6.

**Files:**
- Create: `~/Oxy/OxyPay/packages/backend/src/services/enrichment.ts`
- Test: `~/Oxy/OxyPay/packages/backend/src/services/__tests__/enrichment.test.ts`

**Interfaces:**
- Consumes: `PaymentIntent` (existing model), `Merchant` (Task 4), `SocialSendAttribution` (Task 6), `oxyClient.getUsersByIds(ids: string[]): Promise<User[]>` (`@oxyhq/core`, existing mixin method).
- Produces: `ENRICH_MAX_ADDRESSES = 50`, `enrichAddresses(addresses: string[], viewerUserId: string): Promise<Record<string, EnrichmentResult>>` — consumed by Task 9's route.

- [x] **Step 1: Write the failing test**

Create `~/Oxy/OxyPay/packages/backend/src/services/__tests__/enrichment.test.ts`:

```ts
import { test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { User } from "@oxyhq/core";
import { PaymentIntent } from "../../models/PaymentIntent";
import { Merchant } from "../../models/Merchant";
import { SocialSendAttribution } from "../../models/SocialSendAttribution";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";

function userProfile(id: string, username: string, displayName: string): User {
  return {
    id,
    publicKey: "pub_" + id,
    username,
    avatar: `file_${id}`,
    name: { displayName },
  } as unknown as User;
}

const getUsersByIdsMock = mock(async (ids: string[]) =>
  ids
    .map((id) => {
      if (id === "user_alice") return userProfile("user_alice", "alice", "Alice");
      if (id === "user_bob") return userProfile("user_bob", "bob", "Bob");
      return null;
    })
    .filter((u): u is User => u !== null),
);

mock.module("@oxyhq/core", () => ({
  oxyClient: { getUsersByIds: getUsersByIdsMock },
}));

const { enrichAddresses, ENRICH_MAX_ADDRESSES } = await import("../enrichment");

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await PaymentIntent.init();
  await Merchant.init();
  await SocialSendAttribution.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await PaymentIntent.deleteMany({});
  await Merchant.deleteMany({});
  await SocialSendAttribution.deleteMany({});
  getUsersByIdsMock.mockClear();
});

test("ENRICH_MAX_ADDRESSES is 50", () => {
  expect(ENRICH_MAX_ADDRESSES).toBe(50);
});

test("an address with no PaymentIntent or attribution resolves to unknown", async () => {
  const result = await enrichAddresses(["TUnknownAddr"], "user_viewer");
  expect(result).toEqual({ TUnknownAddr: { kind: "unknown" } });
});

test("a merchant PaymentIntent address resolves to kind: merchant with the Merchant's display fields", async () => {
  const merchant = await Merchant.create({
    oxyAppId: "app_shop",
    network: "testnet",
    xpub: XPUB,
    displayName: "Mercaria",
    avatarFileId: "file_mercaria",
    description: "Marketplace",
  });
  await PaymentIntent.create({
    id: "pi_merchant_1",
    status: "settled",
    amount: "1000000",
    network: "testnet",
    address: "TMerchantAddr1",
    merchantId: merchant.id,
    clientSecret: "pi_merchant_1_secret_x",
    idempotencyKey: "idem_1",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const result = await enrichAddresses(["TMerchantAddr1"], "user_viewer");
  expect(result.TMerchantAddr1).toEqual({
    kind: "merchant",
    displayName: "Mercaria",
    avatarFileId: "file_mercaria",
    description: "Marketplace",
  });
});

test("an outgoing social send resolves to kind: user with the RECIPIENT's identity, from the sender's view", async () => {
  await SocialSendAttribution.create({
    address: "TSocialAddr1",
    network: "testnet",
    senderUserId: "user_viewer",
    recipientUserId: "user_alice",
    index: 1,
  });

  const result = await enrichAddresses(["TSocialAddr1"], "user_viewer");
  expect(result.TSocialAddr1).toEqual({
    kind: "user",
    displayName: "Alice",
    avatarFileId: "file_user_alice",
    username: "alice",
  });
});

test("an incoming social receive resolves to kind: user with the SENDER's identity, from the recipient's view", async () => {
  await SocialSendAttribution.create({
    address: "TSocialAddr2",
    network: "testnet",
    senderUserId: "user_bob",
    recipientUserId: "user_viewer",
    index: 1,
  });

  const result = await enrichAddresses(["TSocialAddr2"], "user_viewer");
  expect(result.TSocialAddr2).toEqual({
    kind: "user",
    displayName: "Bob",
    avatarFileId: "file_user_bob",
    username: "bob",
  });
});

test("an attribution the viewer was NOT party to resolves to unknown (no counterparty leak)", async () => {
  await SocialSendAttribution.create({
    address: "TSocialAddr3",
    network: "testnet",
    senderUserId: "user_alice",
    recipientUserId: "user_bob",
    index: 1,
  });

  const result = await enrichAddresses(["TSocialAddr3"], "user_viewer");
  expect(result.TSocialAddr3).toEqual({ kind: "unknown" });
});

test("a batch mixes merchant, social, and unknown results correctly", async () => {
  const merchant = await Merchant.create({
    oxyAppId: "app_mixed",
    network: "testnet",
    xpub: XPUB,
    displayName: "Shop",
  });
  await PaymentIntent.create({
    id: "pi_mixed_1",
    status: "settled",
    amount: "1000000",
    network: "testnet",
    address: "TMixedMerchant",
    merchantId: merchant.id,
    clientSecret: "pi_mixed_1_secret_x",
    idempotencyKey: "idem_mixed_1",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await SocialSendAttribution.create({
    address: "TMixedSocial",
    network: "testnet",
    senderUserId: "user_viewer",
    recipientUserId: "user_alice",
    index: 1,
  });

  const result = await enrichAddresses(
    ["TMixedMerchant", "TMixedSocial", "TMixedUnknown"],
    "user_viewer",
  );
  expect(result.TMixedMerchant.kind).toBe("merchant");
  expect(result.TMixedSocial.kind).toBe("user");
  expect(result.TMixedUnknown.kind).toBe("unknown");
});

test("degrades to unknown when getUsersByIds cannot resolve the counterparty profile", async () => {
  await SocialSendAttribution.create({
    address: "TSocialGone",
    network: "testnet",
    senderUserId: "user_viewer",
    recipientUserId: "user_deleted",
    index: 1,
  });

  const result = await enrichAddresses(["TSocialGone"], "user_viewer");
  expect(result.TSocialGone).toEqual({ kind: "unknown" });
});

test("an empty address list resolves to an empty result without calling getUsersByIds", async () => {
  const result = await enrichAddresses([], "user_viewer");
  expect(result).toEqual({});
  expect(getUsersByIdsMock).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/services/__tests__/enrichment.test.ts`
Expected: FAIL — `Cannot find module '../enrichment'`.

- [x] **Step 3: Implement**

Create `~/Oxy/OxyPay/packages/backend/src/services/enrichment.ts`:

```ts
import { oxyClient } from "@oxyhq/core";
import type { EnrichmentResult } from "@oxypay/shared-types";
import { PaymentIntent } from "../models/PaymentIntent";
import { Merchant } from "../models/Merchant";
import { SocialSendAttribution } from "../models/SocialSendAttribution";

/** Hard cap on a single enrichment batch — mirrors the contacts-discovery cap convention. */
export const ENRICH_MAX_ADDRESSES = 50;

/**
 * Resolve display identity for a batch of the CALLER's own addresses (spec
 * §4.8) — "Paid at <merchant>" for a Gateway PaymentIntent receive address,
 * "Sent to @x" / "Received from @x" for a social-receive address the caller
 * was the sender or recipient of, else `unknown` (an honest external
 * on-chain payment, per spec §4.5). Display-only: never touches a private
 * key, never blocks a payment, degrades to `unknown` on any partial failure
 * to resolve a counterparty's profile.
 *
 * Every address defaults to `unknown` up front so the returned record always
 * has exactly one entry per input address, in every branch.
 */
export async function enrichAddresses(
  addresses: string[],
  viewerUserId: string,
): Promise<Record<string, EnrichmentResult>> {
  const result: Record<string, EnrichmentResult> = {};
  for (const address of addresses) {
    result[address] = { kind: "unknown" };
  }
  if (addresses.length === 0) {
    return result;
  }

  // 1. Merchant payments — PaymentIntent.address -> Merchant display fields.
  const intents = await PaymentIntent.find({ address: { $in: addresses } });
  const merchantIdByAddress = new Map<string, string>();
  for (const intent of intents) {
    merchantIdByAddress.set(intent.address, intent.merchantId);
  }
  const merchants = await Merchant.find({
    _id: { $in: [...new Set(merchantIdByAddress.values())] },
  });
  const merchantById = new Map(merchants.map((m) => [m.id, m]));
  const resolvedAddresses = new Set<string>();
  for (const [address, merchantId] of merchantIdByAddress) {
    const merchant = merchantById.get(merchantId);
    if (!merchant) continue;
    result[address] = {
      kind: "merchant",
      displayName: merchant.displayName,
      avatarFileId: merchant.avatarFileId,
      description: merchant.description,
    };
    resolvedAddresses.add(address);
  }

  // 2. Social sends/receives — SocialSendAttribution, scoped to the VIEWER's
  // own side of the payment (never leak a counterparty for an address the
  // caller wasn't party to).
  const remaining = addresses.filter((a) => !resolvedAddresses.has(a));
  if (remaining.length > 0) {
    const attributions = await SocialSendAttribution.find({
      address: { $in: remaining },
    });
    const counterpartyByAddress = new Map<string, string>();
    for (const attribution of attributions) {
      if (attribution.senderUserId === viewerUserId) {
        counterpartyByAddress.set(attribution.address, attribution.recipientUserId);
      } else if (attribution.recipientUserId === viewerUserId) {
        counterpartyByAddress.set(attribution.address, attribution.senderUserId);
      }
    }

    if (counterpartyByAddress.size > 0) {
      const counterpartyIds = [...new Set(counterpartyByAddress.values())];
      const profiles = await oxyClient.getUsersByIds(counterpartyIds);
      const profileById = new Map(profiles.map((p) => [p.id, p]));
      for (const [address, counterpartyId] of counterpartyByAddress) {
        const profile = profileById.get(counterpartyId);
        if (!profile) continue;
        result[address] = {
          kind: "user",
          displayName: profile.name.displayName,
          avatarFileId: profile.avatar ?? undefined,
          username: profile.username,
        };
      }
    }
  }

  return result;
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/services/__tests__/enrichment.test.ts`
Expected: PASS — all cases, including the no-leak and degrade-gracefully tests.

- [x] **Step 5: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/backend/src/services/enrichment.ts packages/backend/src/services/__tests__/enrichment.test.ts
git commit -m "feat(backend): transaction-enrichment service (spec §4.8)"
```

---

## Task 9: Backend — `POST /v1/enrich` route + wire both new routers into the Gateway

> ✅ **DONE** — commit `986e48d`; task-review Approved. Cap wired (51→422), viewerUserId from session, real auth default (401). **← WS-S BACKEND COMPLETE (T3-9).** 2026-07-19.

BLOCKED on Tasks 3, 7, 8.

**Files:**
- Create: `~/Oxy/OxyPay/packages/backend/src/routes/enrich.ts`
- Modify: `~/Oxy/OxyPay/packages/backend/src/server.ts`
- Test: `~/Oxy/OxyPay/packages/backend/src/routes/__tests__/enrich.test.ts`

**Interfaces:**
- Consumes: `enrichAddresses`, `ENRICH_MAX_ADDRESSES` (Task 8), `EnrichRequest`/`EnrichResponse` (Task 3), `createSocialRouter` (Task 7).
- Produces: `createEnrichRouter(deps?: { requireOxyUser?: RequestHandler }): Router`. Extends `GatewayDeps` with `requireOxyUser?: RequestHandler` (used by BOTH new routers in `createGateway`).
- Wire contract: `POST /v1/enrich` — auth: Oxy bearer. Body `{ addresses: string[] }` (1–50). `200 { data: Record<string, EnrichmentResult> }`. `422` on empty/oversized/malformed body.

- [x] **Step 1: Write the failing route test**

Create `~/Oxy/OxyPay/packages/backend/src/routes/__tests__/enrich.test.ts`:

```ts
import { test, expect, beforeAll, afterAll, beforeEach, describe } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { OxyAuthRequest } from "@oxyhq/core/server";
import { SocialSendAttribution } from "../../models/SocialSendAttribution";
import { createEnrichRouter } from "../enrich";

const TEST_VIEWER_ID = "user_test_viewer";
const stubRequireOxyUser: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).userId = TEST_VIEWER_ID;
  next();
};

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;

interface EnrichHttpResponse {
  data?: Record<string, { kind: string }>;
  error?: { type: string; message: string };
}

async function postEnrich(
  body: Record<string, unknown>,
): Promise<{ status: number; body: EnrichHttpResponse }> {
  const res = await fetch(`${baseUrl}/v1/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as EnrichHttpResponse };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await SocialSendAttribution.init();

  const app = express();
  app.use(express.json());
  app.use(createEnrichRouter({ requireOxyUser: stubRequireOxyUser }));

  server = app.listen(0);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await SocialSendAttribution.deleteMany({});
});

describe("POST /v1/enrich", () => {
  test("returns unknown for addresses with no matching record", async () => {
    const { status, body } = await postEnrich({ addresses: ["TAddrA", "TAddrB"] });
    expect(status).toBe(200);
    expect(body.data?.TAddrA).toEqual({ kind: "unknown" });
    expect(body.data?.TAddrB).toEqual({ kind: "unknown" });
  });

  test("422s on an empty addresses array", async () => {
    const { status, body } = await postEnrich({ addresses: [] });
    expect(status).toBe(422);
    expect(body.error?.type).toBe("invalid_request_error");
  });

  test("422s when the batch exceeds the max size", async () => {
    const addresses = Array.from({ length: 51 }, (_, i) => `TAddr${i}`);
    const { status } = await postEnrich({ addresses });
    expect(status).toBe(422);
  });

  test("422s on a missing addresses field", async () => {
    const { status } = await postEnrich({});
    expect(status).toBe(422);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/routes/__tests__/enrich.test.ts`
Expected: FAIL — `Cannot find module '../enrich'`.

- [x] **Step 3: Implement the route**

Create `~/Oxy/OxyPay/packages/backend/src/routes/enrich.ts`:

```ts
import { Router } from "express";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { createOxyAuthMiddleware, getRequiredOxyUserId } from "@oxyhq/core/server";
import type { EnrichResponse } from "@oxypay/shared-types";
import { enrichAddresses, ENRICH_MAX_ADDRESSES } from "../services/enrichment";

const enrichBodySchema = z.object({
  addresses: z.array(z.string().min(1)).min(1).max(ENRICH_MAX_ADDRESSES),
});

function sendError(
  res: Response,
  status: number,
  type: string,
  message: string,
): void {
  res.status(status).json({ error: { type, message } });
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
function wrap(handler: AsyncHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

/**
 * Build the transaction-enrichment router (spec §4.8). `requireOxyUser`
 * mirrors `createSocialRouter`'s injectable auth — the CALLER's own signed-in
 * Oxy session, since results are scoped to the caller's own payments.
 */
export function createEnrichRouter(deps?: { requireOxyUser?: RequestHandler }): Router {
  const requireOxyUser: RequestHandler =
    deps?.requireOxyUser ?? createOxyAuthMiddleware(oxyClient);
  const router = Router();

  router.post(
    "/v1/enrich",
    requireOxyUser,
    wrap(async (req, res) => {
      const viewerUserId = getRequiredOxyUserId(req);
      const parsed = enrichBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid request body",
        );
        return;
      }
      const data = await enrichAddresses(parsed.data.addresses, viewerUserId);
      const body: EnrichResponse = { data };
      res.status(200).json(body);
    }),
  );

  return router;
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src/routes/__tests__/enrich.test.ts`
Expected: PASS.

- [x] **Step 5: Wire both new routers into the Gateway**

Modify `~/Oxy/OxyPay/packages/backend/src/server.ts`:

Add imports (alongside the existing `createPaymentIntentsRouter` import):

```ts
import { createSocialRouter } from "./routes/social";
import { createEnrichRouter } from "./routes/enrich";
```

Extend `GatewayDeps` (add one field, after `requireMerchant`):

```ts
export interface GatewayDeps {
  /** Merchant service-auth middleware (default `oxyClient.serviceAuth()`). */
  requireMerchant?: RequestHandler;
  /** End-user Oxy auth for the social + enrich routes (default `createOxyAuthMiddleware(oxyClient)`). */
  requireOxyUser?: RequestHandler;
  /** Socket connection auth (default `oxyClient.authSocket()`). */
  socketAuth?: SocketAuth;
  /** On-chain reader (default the real Explorer client). */
  getTransaction?: typeof getTransaction;
  /** SSRF-safe fetch used for webhook delivery (default the real one). */
  safeFetch?: SafeFetchFn;
}
```

Mount both routers, right after the existing `createPaymentIntentsRouter` mount in `createGateway`:

```ts
  app.use(
    createPaymentIntentsRouter({ requireMerchant: deps.requireMerchant }),
  );
  app.use(createSocialRouter({ requireOxyUser: deps.requireOxyUser }));
  app.use(createEnrichRouter({ requireOxyUser: deps.requireOxyUser }));
```

- [x] **Step 6: Run the full backend test suite**

Run: `cd ~/Oxy/OxyPay/packages/backend && bun test src`
Expected: PASS — every existing test (routes, models, services, e2e) plus every test added in Tasks 4–9, zero regressions.

- [x] **Step 7: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/backend/src/routes/enrich.ts packages/backend/src/routes/__tests__/enrich.test.ts packages/backend/src/server.ts
git commit -m "feat(backend): POST /v1/enrich + mount social/enrich routers (spec §4.8)"
```

---

## Task 10: Frontend — `database.ts` social-receive address table

> ✅ **DONE** — commit `c231ad0`; controller-verified (table+5 CRUD methods, null→-1 coalesce, tsc clean). No unit test (Database convention); device-verify deferred. 2026-07-19.

Persists the social-receive branch's watched addresses (index → address → used) so they survive an app restart without re-deriving from scratch, mirroring the existing `addresses` table's shape and the SAME idempotent `CREATE TABLE IF NOT EXISTS` pattern the file already documents. Independent of every other task — pure SQLite schema + CRUD, no core/backend dependency.

**Testing note (matches this file's established convention):** `Database` (the `expo-sqlite`-backed class) has NO existing unit-test file anywhere in this codebase — every other wallet-store dependency instead extracts its LOGIC into a pure, SQLite-free module that IS unit tested (`apply-transaction.ts` ← `receive.test.ts`/`reorg-rewind.test.ts`, `coin-selection.ts` ← `coin-selection.test.ts`, etc.), while the thin SQLite CRUD layer itself is verified on a real device. This task follows the same split: the new SQL here is thin CRUD (no branching logic to unit test), and the actual social-receive MATH (which addresses to derive, when to extend the window) is pure and IS unit tested — in Task 11.

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/src/storage/database.ts`

**Interfaces:**
- Produces (consumed by Task 12's `wallet-store.ts`):
  - `SocialReceiveAddressRow { index_num: number; address: string; used: number }`
  - `Database.insertSocialReceiveAddresses(rows: { index: number; address: string }[]): Promise<void>`
  - `Database.getSocialReceiveAddresses(): Promise<SocialReceiveAddressRow[]>`
  - `Database.markSocialReceiveAddressUsed(address: string): Promise<void>`
  - `Database.getHighestUsedSocialReceiveIndex(): Promise<number>` — returns `-1` when none are used yet.

- [x] **Step 1: Add the table + index to `SCHEMA_SQL`**

Modify `~/Oxy/OxyPay/packages/frontend/src/storage/database.ts` — insert into the `SCHEMA_SQL` template string, right after the existing `addresses` table + its index (after `idx_addresses_change_used` at what is currently line 220, before the `contacts` table):

```sql
  CREATE TABLE IF NOT EXISTS social_receive_addresses (
    index_num INTEGER PRIMARY KEY,
    address TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_social_receive_used ON social_receive_addresses(used);
```

(`CREATE TABLE IF NOT EXISTS` is safe to add to the existing schema batch directly — unlike the `utxos` reorg columns, this is a brand-NEW table, so it needs no `ALTER TABLE` migration dance: running the updated batch against an existing database simply creates the new table alongside the others, with no effect on any existing row.)

- [x] **Step 2: Add the row type**

Modify `~/Oxy/OxyPay/packages/frontend/src/storage/database.ts` — add after the existing `AddressRow` interface (line 69):

```ts
export interface SocialReceiveAddressRow {
  index_num: number;
  address: string;
  used: number;
}
```

- [x] **Step 3: Add the four methods**

Modify `~/Oxy/OxyPay/packages/frontend/src/storage/database.ts` — add a new section right after the existing `// Addresses` section (after `getNextUnusedIndex`, before `// Peers`, i.e. after what is currently line 818):

```ts
  // -----------------------------------------------------------------------
  // Social-receive addresses (spec §4.3 — Oxy-identity-derived branch,
  // parallel to the private BIP44 spending tree above)
  // -----------------------------------------------------------------------

  /**
   * Persist a batch of derived social-receive addresses. `INSERT OR IGNORE`
   * makes this idempotent: re-deriving and re-inserting an already-persisted
   * index is a safe no-op, so callers never need to check existence first.
   */
  async insertSocialReceiveAddresses(
    rows: { index: number; address: string }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.withTransactionAsync(async () => {
      const stmt = await this.db.prepareAsync(
        `INSERT OR IGNORE INTO social_receive_addresses (index_num, address, used)
         VALUES (?, ?, 0)`,
      );
      try {
        for (const row of rows) {
          await stmt.executeAsync(row.index, row.address);
        }
      } finally {
        await stmt.finalizeAsync();
      }
    });
  }

  async getSocialReceiveAddresses(): Promise<SocialReceiveAddressRow[]> {
    return this.db.getAllAsync<SocialReceiveAddressRow>(
      "SELECT * FROM social_receive_addresses ORDER BY index_num ASC",
    );
  }

  async markSocialReceiveAddressUsed(address: string): Promise<void> {
    await this.db.runAsync(
      "UPDATE social_receive_addresses SET used = 1 WHERE address = ?",
      address,
    );
  }

  /**
   * The highest social-receive index marked used, or -1 if none are used yet.
   * Mirrors `getNextUnusedIndex`'s role for the private spending tree: the
   * caller extends the watched window to stay `SOCIAL_RECEIVE_GAP_LIMIT`
   * ahead of this value.
   */
  async getHighestUsedSocialReceiveIndex(): Promise<number> {
    const row = await this.db.getFirstAsync<{ max_used: number | null }>(
      "SELECT MAX(index_num) as max_used FROM social_receive_addresses WHERE used = 1",
    );
    return row?.max_used ?? -1;
  }
```

- [x] **Step 4: Typecheck**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bunx tsc --noEmit`
Expected: no new errors.

- [x] **Step 5: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/src/storage/database.ts
git commit -m "feat(frontend): social-receive address table (spec §4.3)"
```

---
## Task 11: Frontend — `social-receive.ts` (on-device wrapper + pure window math)

> ✅ **DONE** — commit `3ceebda`; task-review Approved. §7c key-handling clean (transient, never logged/persisted), key-priority matches core source, window math correct, faircoin→0.3.0. Two FUND-LOSS-class items flagged for the T19 security gate (DID-key cross-service consistency). 2026-07-19.

Reads the raw identity private key from `@oxyhq/core`'s ALREADY-PUBLISHED `KeyManager.getSharedPrivateKey()`/`getPrivateKey()` (no `@oxyhq/core` change needed) and calls the published `@fairco.in/core` social-receive primitives — mirroring `identity-wallet.ts`'s existing wrap-`deriveScopedSeed` pattern for the key SOURCE, but skipping the HKDF step (spec §4.3's key-separation note: this is the ONE place the raw identity key is used directly, not domain-separated). ALSO owns the gap-limit-extension math as a pure, directly-testable function — `wallet-store.ts` (Task 12) calls it but contains no branching logic of its own, matching this codebase's established split (logic lives in a pure module with real tests; the store is thin orchestration verified on-device). BLOCKED on Task 2 (the `@fairco.in/core` publish).

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/wallet/social-receive.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/social-receive.test.ts`

**Interfaces:**
- Consumes: `KeyManager as IdentityKeyManager` (`@oxyhq/core`, EXISTING — no version bump, only the ALREADY-PUBLISHED `getSharedPrivateKey()`/`getPrivateKey()` are used), `deriveSocialReceiveAddress`, `deriveSocialReceiveSpendingKey`, `publicKeyFromPrivateKey`, `hexToBytes` (`@fairco.in/core`, bumped, Task 1/2), `NetworkConfig` (`@fairco.in/core`).
- Produces (consumed by Task 12):
  - `SOCIAL_RECEIVE_GAP_LIMIT = 20`
  - `getIdentityPrivateKeyBytes(): Promise<Uint8Array | null>`
  - `deriveSocialReceiveWatchWindow(identityPrivateKey: Uint8Array, start: number, count: number, network: NetworkConfig): { index: number; address: string }[]`
  - `getSocialReceiveSpendingKey(identityPrivateKey: Uint8Array, index: number): Uint8Array`
  - `computeWindowExtension(highestWatchedIndex: number, highestUsedIndex: number, gapLimit: number): { start: number; count: number } | null`

- [x] **Step 1: Write the failing test**

Create `~/Oxy/OxyPay/packages/frontend/src/wallet/social-receive.test.ts`. Mocking `@oxyhq/core`'s `KeyManager` BEFORE importing the module under test mirrors the EXISTING, established pattern in `identity-wallet.test.ts` (which mocks `KeyManager.deriveScopedSeed` the same way for the private spending tree):

```ts
import { describe, test, expect, mock } from "bun:test";
import { hexToBytes, getNetwork } from "@fairco.in/core";

// Mock @oxyhq/core BEFORE importing the module under test — mirrors
// identity-wallet.test.ts's established pattern for wrapping KeyManager.
let sharedPrivateKeyResult: string | null = "aa".repeat(32);
let primaryPrivateKeyResult: string | null = null;
const getSharedPrivateKey = mock(async () => sharedPrivateKeyResult);
const getPrivateKey = mock(async () => primaryPrivateKeyResult);
mock.module("@oxyhq/core", () => ({
  KeyManager: { getSharedPrivateKey, getPrivateKey },
}));

const {
  SOCIAL_RECEIVE_GAP_LIMIT,
  getIdentityPrivateKeyBytes,
  deriveSocialReceiveWatchWindow,
  getSocialReceiveSpendingKey,
  computeWindowExtension,
} = await import("./social-receive");

const IDENTITY_PRIV_A = hexToBytes("aa".repeat(32));
const TESTNET = getNetwork("testnet");

describe("SOCIAL_RECEIVE_GAP_LIMIT", () => {
  test("is 20", () => {
    expect(SOCIAL_RECEIVE_GAP_LIMIT).toBe(20);
  });
});

describe("getIdentityPrivateKeyBytes", () => {
  test("prefers the shared identity over the primary one", async () => {
    sharedPrivateKeyResult = "aa".repeat(32);
    primaryPrivateKeyResult = "bb".repeat(32);
    const bytes = await getIdentityPrivateKeyBytes();
    expect(bytes).toEqual(IDENTITY_PRIV_A);
  });

  test("falls back to the primary identity when there is no shared one", async () => {
    sharedPrivateKeyResult = null;
    primaryPrivateKeyResult = "bb".repeat(32);
    const bytes = await getIdentityPrivateKeyBytes();
    expect(bytes).toEqual(hexToBytes("bb".repeat(32)));
  });

  test("returns null when neither identity is available (web / keyless)", async () => {
    sharedPrivateKeyResult = null;
    primaryPrivateKeyResult = null;
    expect(await getIdentityPrivateKeyBytes()).toBeNull();
  });

  test("CRITICAL: canonicalizes a short or uppercase hex key before decoding", async () => {
    // elliptic's getPrivate('hex') strips leading zero bytes ~1-in-256 times,
    // and legacy imports may be uppercase — both must decode to the exact
    // same 32 bytes as the fully-padded lowercase form, or the derived
    // social-receive branch would silently diverge from what the SAME
    // identity's public path (backend/payer) computes.
    sharedPrivateKeyResult = "AA".repeat(32); // uppercase, full length
    primaryPrivateKeyResult = null;
    const uppercaseBytes = await getIdentityPrivateKeyBytes();
    expect(uppercaseBytes).toEqual(IDENTITY_PRIV_A);

    sharedPrivateKeyResult = "1".repeat(63); // 63 chars -- needs left-padding to 64
    const shortBytes = await getIdentityPrivateKeyBytes();
    expect(shortBytes).toEqual(hexToBytes(`0${"1".repeat(63)}`));
  });
});

describe("deriveSocialReceiveWatchWindow", () => {
  test("derives the pinned addr(0..2) starting at 0", () => {
    const window = deriveSocialReceiveWatchWindow(IDENTITY_PRIV_A, 0, 3, TESTNET);
    expect(window).toEqual([
      { index: 0, address: "TGW3g56Q5PvpA8UangXnzX6va2MkfaRx5r" },
      { index: 1, address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ" },
      { index: 2, address: "TVsFKn7zkDN1QnMNe1thrJUEXBGiqnu19g" },
    ]);
  });

  test("a window starting mid-range derives the correct offset", () => {
    const window = deriveSocialReceiveWatchWindow(IDENTITY_PRIV_A, 2, 1, TESTNET);
    expect(window).toEqual([{ index: 2, address: "TVsFKn7zkDN1QnMNe1thrJUEXBGiqnu19g" }]);
  });

  test("count 0 returns an empty window", () => {
    expect(deriveSocialReceiveWatchWindow(IDENTITY_PRIV_A, 0, 0, TESTNET)).toEqual([]);
  });
});

describe("getSocialReceiveSpendingKey", () => {
  test("the spending key at index 0 matches the pinned vector", () => {
    const key = getSocialReceiveSpendingKey(IDENTITY_PRIV_A, 0);
    expect(Buffer.from(key).toString("hex")).toBe(
      "42d089c0f361d67b6add7279d67718bc89ddd35d2218696991c24d3902d26c86".slice(0, 64),
    );
  });
});

describe("computeWindowExtension", () => {
  test("no extension needed when the watched window already covers the gap limit", () => {
    // Nothing used yet (highestUsedIndex -1), window already covers 0..19.
    expect(computeWindowExtension(19, -1, 20)).toBeNull();
  });

  test("extends when the highest used index approaches the edge of the watched window", () => {
    // Used up to index 5, watched only up to 19 -> target = 5 + 20 = 25, extend 20..25.
    const extension = computeWindowExtension(19, 5, 20);
    expect(extension).toEqual({ start: 20, count: 6 });
  });

  test("extends from an empty window (first boot)", () => {
    const extension = computeWindowExtension(-1, -1, 20);
    expect(extension).toEqual({ start: 0, count: 20 });
  });

  test("extends by exactly the amount needed to restore the full gap limit", () => {
    // Used index 0 immediately after a 20-wide initial window (0..19):
    // target = 0 + 20 = 20, watched already covers up to 19 -> extend by 1 (index 20).
    const extension = computeWindowExtension(19, 0, 20);
    expect(extension).toEqual({ start: 20, count: 1 });
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/wallet/social-receive.test.ts`
Expected: FAIL — `Cannot find module './social-receive'`.

- [x] **Step 3: Implement**

Create `~/Oxy/OxyPay/packages/frontend/src/wallet/social-receive.ts`:

```ts
/**
 * Oxy Pay's on-device half of the social-receive scheme (design spec §4.3).
 * Reads the raw identity private key from `@oxyhq/core`'s EXISTING
 * `KeyManager.getSharedPrivateKey()`/`getPrivateKey()` — no `@oxyhq/core`
 * change needed; this mirrors `deriveIdentitySeed`'s own key-source priority
 * (shared ecosystem identity first, then this device's primary identity) but
 * SKIPS the HKDF step: the social-receive branch is, by design, the ONE
 * place the raw identity key is reused directly for money (spec §4.3's
 * key-separation note) — every other on-device use goes through
 * `deriveIdentitySeed`/`deriveScopedSeed`'s domain-separated HKDF instead.
 * Calls the published `@fairco.in/core` derivation primitives
 * (`deriveSocialReceiveAddress`, `deriveSocialReceiveSpendingKey`,
 * `publicKeyFromPrivateKey`) — generic secp256k1 crypto with no Oxy
 * dependency; this file is the ONLY place in the app that supplies it with
 * Oxy-identity-sourced key material. Also owns the gap-limit-extension math
 * as a pure function, kept here (not in `wallet-store.ts`) so it stays
 * directly unit-testable without any SQLite or SPV setup.
 */
import {
  hexToBytes,
  deriveSocialReceiveAddress,
  deriveSocialReceiveSpendingKey,
  publicKeyFromPrivateKey,
} from "@fairco.in/core";
import type { NetworkConfig } from "@fairco.in/core";
import { KeyManager as IdentityKeyManager } from "@oxyhq/core";

/**
 * How many unused social-receive addresses stay watched beyond the highest
 * USED index — mirrors the FairCoin BIP44 external-chain gap limit
 * (`EXTERNAL_GAP_LIMIT` in `key-manager.ts`).
 */
export const SOCIAL_RECEIVE_GAP_LIMIT = 20;

/**
 * Lowercase + left-pad to 64 hex chars. Mirrors `@oxyhq/core`'s internal
 * `KeyManager.canonicalPrivateKey` (private to that package, not exported) —
 * tolerates the 1-in-256 leading-zero-strip `elliptic`'s `getPrivate('hex')`
 * produces and legacy uppercase-stored keys. Every raw private-key hex
 * string read from `KeyManager` MUST be normalized this way before
 * hex-decoding, or a short/uppercase key silently decodes to the WRONG 32
 * bytes and the derived social-receive branch diverges from what the SAME
 * identity's PUBLIC path (backend/payer) computes.
 */
function canonicalizePrivateKeyHex(hex: string): string {
  return hex.toLowerCase().padStart(64, "0");
}

/**
 * The on-device identity's RAW private key bytes for the social-receive
 * branch ONLY (spec §4.3's key-separation note). `null` on web or a keyless
 * account — both `KeyManager` getters already return `null` in those cases,
 * so no extra platform check is needed here.
 */
export async function getIdentityPrivateKeyBytes(): Promise<Uint8Array | null> {
  const hex =
    (await IdentityKeyManager.getSharedPrivateKey()) ??
    (await IdentityKeyManager.getPrivateKey());
  if (!hex) {
    return null;
  }
  return hexToBytes(canonicalizePrivateKeyHex(hex));
}

/**
 * Compute `count` consecutive social-receive addresses starting at `start`,
 * from the identity PRIVATE key (native-only; the recipient's own device).
 * Address 0 is always the caller's stable default/favourite address.
 */
export function deriveSocialReceiveWatchWindow(
  identityPrivateKey: Uint8Array,
  start: number,
  count: number,
  network: NetworkConfig,
): { index: number; address: string }[] {
  const identityPublicKey = publicKeyFromPrivateKey(identityPrivateKey);
  const window: { index: number; address: string }[] = [];
  for (let i = start; i < start + count; i++) {
    window.push({
      index: i,
      address: deriveSocialReceiveAddress(identityPublicKey, i, network),
    });
  }
  return window;
}

/** The spending private key for social-receive child `index` (recipient only). */
export function getSocialReceiveSpendingKey(
  identityPrivateKey: Uint8Array,
  index: number,
): Uint8Array {
  return deriveSocialReceiveSpendingKey(identityPrivateKey, index);
}

/**
 * Decide whether the persisted, watched social-receive window needs to grow,
 * and if so, which NEW indices to derive — pure, no I/O. Called after
 * persisting a newly-used address; the caller derives + persists whatever
 * this returns and refreshes the Bloom filter if it returns non-null.
 *
 * @param highestWatchedIndex The highest index currently derived+persisted,
 *   or -1 if none yet.
 * @param highestUsedIndex The highest index a real payment has landed on, or
 *   -1 if none yet.
 * @param gapLimit {@link SOCIAL_RECEIVE_GAP_LIMIT} in production; injectable
 *   for tests.
 */
export function computeWindowExtension(
  highestWatchedIndex: number,
  highestUsedIndex: number,
  gapLimit: number,
): { start: number; count: number } | null {
  const target = highestUsedIndex + gapLimit;
  if (target <= highestWatchedIndex) {
    return null;
  }
  return { start: highestWatchedIndex + 1, count: target - highestWatchedIndex };
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/wallet/social-receive.test.ts`
Expected: PASS — including the canonicalization regression tests.

- [x] **Step 5: Bump the `@fairco.in/core` dependency**

Modify `~/Oxy/OxyPay/packages/frontend/package.json`: `"@fairco.in/core": "0.1.1"` (currently pinned EXACT, no caret) → the version Task 2 actually published. `@oxyhq/core`'s pin (`^12.7.0`) is UNCHANGED — no WS-S bump.

```bash
cd ~/Oxy/OxyPay
bun install
```
Expected: `bun.lock` updates to resolve the bumped `@fairco.in/core`; `@oxyhq/core`'s resolved version is unchanged.

- [x] **Step 6: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/package.json bun.lock packages/frontend/src/wallet/social-receive.ts packages/frontend/src/wallet/social-receive.test.ts
git commit -m "feat(frontend): on-device social-receive wrapper + window math (spec §4.3)"
```

---
## Task 12: Frontend — `wallet-store.ts` social-receive integration (HIGHEST RISK)

> ✅ **DONE** — commits `db5c8f7`+CRITICAL fix `8bace86` (1 fix cycle); re-review Approved. Review caught a money-unspendable lifecycle bug (setUpSocialReceive on 1/4 re-init paths) → folded into initialize() gated on identity wallet. Device-verify DEFERRED (expanded: lock/unlock + Pocket-switch repro). 2026-07-19.

Wires the social-receive branch into the existing SPV receive/spend pipeline: watching (Bloom filter), ownership (the receive path's `ownsAddress` check), gap-limit extension (mirrors the private tree's `markAddressUsed`-driven lookahead), and spending (the send path's private-key lookup). BLOCKED on Tasks 10, 11.

**Read this before touching the file:** `wallet-store.ts` has NO existing unit tests (confirmed: no `wallet-store.test.ts` anywhere in this repo) — every other piece of receive/spend logic is extracted into a pure module that IS tested (`apply-transaction.ts`, `coin-selection.ts`, `social-receive.ts` from Task 11) while the store itself is thin orchestration verified on a real device, per this plan's Global Constraints. This task follows the SAME split: every new piece of actual logic (window math, address derivation) already lives in Task 11's tested `social-receive.ts`; everything added here is orchestration that calls it. Because of that, this task has no "write failing test" step — its correctness gate is `tsc --noEmit` + the full existing test suite (to catch a signature mismatch or an accidentally-broken import) + a mandatory real-device manual verification pass (Step 6).

**Bloom filter invariant (read carefully — this is the easiest place to introduce a silent regression):** `SPVClient.setBloomFilter()` REPLACES the filter wholesale — it does not merge. There are THREE call sites in this file that rebuild it (`initialize()`'s own initial build, `processIncomingTransaction`'s `bloomNeedsRefresh` block, `getBuyDeliveryAddress`'s post-derive refresh); ALL of them must include both the private spending tree's addresses AND the social-receive branch's addresses, or one set silently stops being watched. This task introduces ONE shared helper (`buildCombinedBloomFilterHashes`) and routes every rebuild EXCEPT `initialize()`'s own initial one through it (that one intentionally stays as-is — see Step 3's note on why).

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/src/wallet/wallet-store.ts`

**Interfaces:**
- Consumes: `SOCIAL_RECEIVE_GAP_LIMIT`, `getIdentityPrivateKeyBytes`, `deriveSocialReceiveWatchWindow`, `getSocialReceiveSpendingKey`, `computeWindowExtension` (Task 11), `Database.insertSocialReceiveAddresses`/`getSocialReceiveAddresses`/`markSocialReceiveAddressUsed`/`getHighestUsedSocialReceiveIndex` (Task 10).
- Produces: `WalletState.socialReceiveDefaultAddress: string | null` — consumed by Task 16's `ReceiveSheet.tsx`. The store's `sendTransaction` action now transparently spends from a social-receive UTXO if one is selected — no signature change, existing callers (Task 15's `SocialRecipientPicker`/`SendSheet` flow) need no special handling.

- [x] **Step 1: Add imports and module-level state**

Modify `~/Oxy/OxyPay/packages/frontend/src/wallet/wallet-store.ts` — add a new import block right after the existing `identity-wallet` import (after the closing `} from "./identity-wallet";`):

```ts
import {
  SOCIAL_RECEIVE_GAP_LIMIT,
  getIdentityPrivateKeyBytes,
  deriveSocialReceiveWatchWindow,
  getSocialReceiveSpendingKey,
  computeWindowExtension,
} from "./social-receive";
```

Add two new module-level `let`s right after the existing `let spvClient: SPVClient | null = null;`:

```ts
/**
 * The on-device identity's raw private key, held ONLY for deriving
 * social-receive spending keys on demand (spec §4.3) — never used for the
 * private spending tree, which goes through `deriveIdentitySeed`'s HKDF
 * instead. `null` until `initializeFromIdentity` sets up social receive.
 */
let socialReceiveIdentityPrivateKey: Uint8Array | null = null;
/** address -> derivation index, for every currently-watched social-receive address (used + unused window). */
let socialReceiveAddressIndex: Map<string, number> = new Map();
```

Add `socialReceiveDefaultAddress: string | null;` to the `WalletState` interface, right after the existing `hasBackedUp: boolean;` field:

```ts
  /**
   * The recipient's stable social-receive default address (spec §4.3
   * `addr(0)`) — shown on the Receive screen alongside `@username`. `null`
   * until the social-receive window has been derived (web, keyless account,
   * or before `initializeFromIdentity` completes).
   */
  socialReceiveDefaultAddress: string | null;
```

Add `socialReceiveDefaultAddress: null as string | null,` to `DEFAULT_WALLET_STATE`, right after its existing `hasBackedUp: false,` line, and add `socialReceiveDefaultAddress: null,` to the store's initial state object (inside `create<WalletState>((set, get) => ({ ... })`), right after ITS existing `hasBackedUp: false,` line (these are two separate literals in the file — both need the field).

- [x] **Step 2: Add the three new module-level helper functions**

Modify `~/Oxy/OxyPay/packages/frontend/src/wallet/wallet-store.ts` — add these three functions right after `getActiveWalletAddresses` (before the "Incoming transaction processing" section comment):

```ts
/**
 * Every address hash the wallet should watch: the private spending tree PLUS
 * the social-receive branch (spec §4.3). `setBloomFilter` replaces the
 * filter wholesale, so every call site that rebuilds it must include BOTH
 * sets or the other silently drops out of coverage until the next refresh.
 */
function buildCombinedBloomFilterHashes(km: KeyManager): Uint8Array[] {
  return [...km.getAllAddresses(), ...socialReceiveAddressIndex.keys()].map(
    (addr) => decodeAddress(addr).hash,
  );
}

/**
 * Bring up the social-receive branch (spec §4.3) after the private spending
 * tree is already initialized: derive (or load the persisted) watch window,
 * populate the in-memory index map, publish the stable default address
 * (`addr(0)`) to the store, and fold the social addresses into the SPV Bloom
 * filter. Additive to `initialize()`'s own Bloom-filter setup — calling
 * `setBloomFilter` again here is safe (it replaces the filter wholesale, so
 * the FULL combined address set is passed every time, not a delta).
 */
async function setUpSocialReceive(
  db: Database,
  network: NetworkConfig,
  currentSpvClient: SPVClient | null,
  set: WalletSet,
): Promise<void> {
  const identityPrivateKey = await getIdentityPrivateKeyBytes();
  if (!identityPrivateKey) {
    // Web, or a race where identity was removed between initialize() and
    // here — initializeFromIdentity() already returned "no-identity" in the
    // normal case, so this is a defensive no-op, not the expected path.
    return;
  }
  socialReceiveIdentityPrivateKey = identityPrivateKey;

  let persisted = await db.getSocialReceiveAddresses();
  if (persisted.length === 0) {
    const initial = deriveSocialReceiveWatchWindow(
      identityPrivateKey,
      0,
      SOCIAL_RECEIVE_GAP_LIMIT,
      network,
    );
    await db.insertSocialReceiveAddresses(initial);
    persisted = await db.getSocialReceiveAddresses();
  }

  socialReceiveAddressIndex = new Map(persisted.map((row) => [row.address, row.index_num]));
  const defaultRow = persisted.find((row) => row.index_num === 0);
  set({ socialReceiveDefaultAddress: defaultRow?.address ?? null });

  if (currentSpvClient && keyManager) {
    currentSpvClient.setBloomFilter(buildCombinedBloomFilterHashes(keyManager));
  }
}

/**
 * Extend the persisted + in-memory social-receive watch window if the
 * highest USED index has moved close enough to its edge (spec §4.3 — mirrors
 * the private tree's `markAddressUsed`-driven lookahead extension). Returns
 * true if new addresses were derived (caller should refresh the Bloom
 * filter), false otherwise.
 */
async function extendSocialReceiveWindowIfNeeded(
  db: Database,
  network: NetworkConfig,
): Promise<boolean> {
  if (!socialReceiveIdentityPrivateKey) {
    return false;
  }
  const highestWatched = Math.max(-1, ...socialReceiveAddressIndex.values());
  const highestUsed = await db.getHighestUsedSocialReceiveIndex();
  const extension = computeWindowExtension(highestWatched, highestUsed, SOCIAL_RECEIVE_GAP_LIMIT);
  if (!extension) {
    return false;
  }
  const fresh = deriveSocialReceiveWatchWindow(
    socialReceiveIdentityPrivateKey,
    extension.start,
    extension.count,
    network,
  );
  await db.insertSocialReceiveAddresses(fresh);
  for (const { index, address } of fresh) {
    socialReceiveAddressIndex.set(address, index);
  }
  return true;
}

/**
 * Resolve the signing private key for `address`: the private spending tree
 * first, then the social-receive branch (spec §4.3) if the address isn't in
 * the tree. Throws if neither knows the address, or if a social address is
 * matched but the on-device identity key is unavailable (should not happen —
 * a social address can only be watched while the identity key was present).
 */
async function getSigningKeyForAddress(
  km: KeyManager,
  address: string,
): Promise<Uint8Array> {
  if (km.ownsAddress(address)) {
    return km.getPrivateKeyForAddress(address);
  }
  const socialIndex = socialReceiveAddressIndex.get(address);
  if (socialIndex !== undefined) {
    const identityPrivateKey =
      socialReceiveIdentityPrivateKey ?? (await getIdentityPrivateKeyBytes());
    if (!identityPrivateKey) {
      throw new Error(
        "Cannot sign for a social-receive address without the on-device identity key",
      );
    }
    return getSocialReceiveSpendingKey(identityPrivateKey, socialIndex);
  }
  throw new Error(`Address not found in key manager: ${address}`);
}
```

- [x] **Step 3: Run the typecheck to confirm the new code compiles (it isn't wired in yet, so nothing should behave differently)**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bunx tsc --noEmit`
Expected: no new errors (the three functions above are unused so far — that's fine, they're consumed in the next step).

- [x] **Step 4: Wire `resetWalletInternals` to clear the new module state**

Modify `resetWalletInternals()` — add two lines right after the existing `keyManager = null;`:

```ts
function resetWalletInternals(): void {
  if (peerUpdateInterval) {
    clearInterval(peerUpdateInterval);
    peerUpdateInterval = null;
  }
  if (spvClient) {
    spvClient.stop();
    spvClient = null;
  }
  if (keyManager) {
    keyManager.wipe();
  }
  keyManager = null;
  socialReceiveIdentityPrivateKey = null;
  socialReceiveAddressIndex = new Map();
  utxoSet = null;
  database = null;
  networkConfig = null;
  rescanDriverRunning = false;
  utxoReservation.clear();
  try {
    useContactsStore.getState().reset();
  } catch {
    // best-effort; store may not be initialised yet during early boot.
  }
}
```

- [x] **Step 5: Wire the receive path — `processIncomingTransaction`'s ownership check and used-address loop**

Modify the `applyTransactionToWallet` call inside `processIncomingTransaction` — change ONLY the `ownsAddress` callback argument:

```ts
  const result = applyTransactionToWallet(
    utxoSet,
    tx,
    txid,
    (address) =>
      (keyManager?.ownsAddress(address) ?? false) || socialReceiveAddressIndex.has(address),
    networkConfig,
    confirmation,
  );
```

Modify the used-address loop right below it (adds a new `if` block; the existing `keyManager.markAddressUsed` branch is unchanged):

```ts
  let bloomNeedsRefresh = false;
  for (const address of result.receiveAddresses) {
    await database.markAddressUsed(address);
    if (keyManager.markAddressUsed(address)) {
      bloomNeedsRefresh = true;
    }
    if (socialReceiveAddressIndex.has(address)) {
      await database.markSocialReceiveAddressUsed(address);
      if (await extendSocialReceiveWindowIfNeeded(database, networkConfig)) {
        bloomNeedsRefresh = true;
      }
    }
  }
```

Modify the `bloomNeedsRefresh` refresh block further down in the SAME function to use the combined helper instead of `keyManager.getAllAddresses()` alone:

```ts
  if (bloomNeedsRefresh && spvClient && keyManager) {
    spvClient.setBloomFilter(buildCombinedBloomFilterHashes(keyManager));
  }
```

- [x] **Step 6: Wire `getBuyDeliveryAddress`'s Bloom-filter refresh to the combined helper**

Modify the tail of `getBuyDeliveryAddress` — this address always comes from the PRIVATE tree (unrelated to social receive), but its Bloom-filter refresh must still include the social branch or that branch silently drops out of coverage from this point on:

```ts
    if (spvClient) {
      spvClient.setBloomFilter(buildCombinedBloomFilterHashes(keyManager));
    }

    return derived.address;
  },
```

(Only the `if (spvClient) { ... }` block changes — the rest of `getBuyDeliveryAddress` is untouched.)

- [x] **Step 7: Wire `initializeFromIdentity` to bring up social receive after the spending tree is up**

Modify `initializeFromIdentity`:

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
    if (database && networkConfig) {
      await setUpSocialReceive(database, networkConfig, spvClient, set);
    }
    return "initialized";
  },
```

(Only the new `if (database && networkConfig) { ... }` block is added; every other line is unchanged.)

- [x] **Step 8: Wire the spend path — `sendTransaction`'s signing loop**

Modify the signing loop inside `sendTransaction` — change ONLY the private-key lookup line (add `await`, swap the direct `localKeyManager.getPrivateKeyForAddress` call for the new fallback-aware helper):

```ts
      for (let i = 0; i < tx.inputs.length; i++) {
        const input = tx.inputs[i];
        const utxo = selection.selected.find(
          (u) => u.txid === input.txid && u.vout === input.vout,
        );
        if (!utxo) {
          throw new Error(`UTXO not found for input ${input.txid}:${input.vout}`);
        }

        const privateKey = await getSigningKeyForAddress(localKeyManager, utxo.address);
        tx.inputs[i] = {
          ...tx.inputs[i],
          scriptSig: signInput(tx, i, utxo.scriptPubKey, privateKey),
        };
      }
```

- [x] **Step 9: Typecheck**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bunx tsc --noEmit`
Expected: no errors.

- [x] **Step 10: Run the full frontend test suite**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src`
Expected: PASS — every existing test (`apply-transaction`/`receive`/`coin-selection`/`identity-wallet`/`key-manager`/etc.) plus Task 11's `social-receive.test.ts`, zero regressions. This does NOT exercise the wiring added in this task (no `wallet-store.test.ts` exists) — it only proves nothing else broke.

- [x] **Step 11: Verify on a real foregrounded device/emulator (testnet) — MANDATORY, this task has no automated coverage of its own wiring**

```bash
cd ~/Oxy/OxyPay/packages/frontend
bun run dev:frontend
```

On a real device/emulator, signed in with an Oxy testnet identity:
1. Complete onboarding so `initializeFromIdentity` runs. Confirm the app does NOT crash and reaches the home screen.
2. Send TESTNET FAIR from a DIFFERENT wallet (e.g. FAIRWallet or the Explorer's `send` MCP tool) directly to the derived `addr(0)` — you'll get this address from Task 16's Receive screen once that task lands; until then, log `socialReceiveDefaultAddress` from the store via a temporary `console.error` breakpoint (removed before commit) or the React Native debugger.
3. Confirm the incoming transaction is detected (balance increases, a "receive" row appears) WITHOUT restarting the app — this proves the Bloom filter included the social address from boot.
4. Send a small amount FROM that social-receive UTXO back out (coin control, or just let normal coin selection pick it up in a subsequent send) and confirm the transaction broadcasts successfully — this proves `getSigningKeyForAddress`'s fallback path signs correctly.
5. Force-quit and relaunch the app; confirm the previously-received social transaction is still shown (persisted window survives restart).

- [x] **Step 12: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/src/wallet/wallet-store.ts
git commit -m "feat(frontend): wire social-receive into the SPV receive/spend pipeline (spec §4.3)"
```

---

## Task 13: Frontend — `gateway-client.ts` social + enrichment calls

> ✅ **DONE** — commit `db1c7da`+CRITICAL fix `3242f78` (1 fix cycle); re-verified w/ regression proof. Review caught enrichAddresses double-unwrap ({data} auto-unwrap → undefined). 2026-07-19.

BLOCKED on Task 3 (shared-types) for the type contracts, and on Tasks 7/9 (backend routes) for end-to-end reachability — the code itself only needs the contracts to compile and can be written/unit-tested (with a mocked linked client) before the backend is deployed.

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/src/services/gateway-client.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/services/gateway-client.test.ts`

**Interfaces:**
- Consumes: `SocialNextAddressResponse`, `EnrichResponse`, `EnrichmentResult` (`@oxypay/shared-types`, Task 3), `gateway` (existing `LinkedHttpClient`, this file).
- Produces (consumed by Task 14's `SocialRecipientPicker`, Task 15's `SendSheet`, Task 17's `useTransactionEnrichment`):
  - `reserveNextSocialAddress(username: string, network: NetworkType): Promise<SocialNextAddressResponse>` — throws `KeylessRecipientError` for a keyless recipient (HTTP 409).
  - `enrichAddresses(addresses: string[]): Promise<Record<string, EnrichmentResult>>`
  - `class KeylessRecipientError extends Error`

- [x] **Step 1: Write the failing test**

Create `~/Oxy/OxyPay/packages/frontend/src/services/gateway-client.test.ts`:

```ts
import { describe, test, expect, mock, beforeEach } from "bun:test";

const postMock = mock(async (_path: string, _body: unknown): Promise<unknown> => {
  throw new Error("postMock not configured for this test");
});

mock.module("./oxy-services", () => ({
  oxyServices: {
    createLinkedClient: () => ({ client: { post: postMock } }),
  },
}));

const { reserveNextSocialAddress, enrichAddresses, KeylessRecipientError } = await import(
  "./gateway-client"
);

beforeEach(() => {
  postMock.mockReset();
});

describe("reserveNextSocialAddress", () => {
  test("returns the reserved address and index", async () => {
    postMock.mockImplementationOnce(async () => ({ address: "TAbC123", index: 1 }));

    const result = await reserveNextSocialAddress("alice", "testnet");

    expect(result).toEqual({ address: "TAbC123", index: 1 });
    expect(postMock).toHaveBeenCalledWith("/v1/social/alice/next_address", {
      network: "testnet",
    });
  });

  test("URL-encodes the username", async () => {
    postMock.mockImplementationOnce(async () => ({ address: "TAbC123", index: 1 }));
    await reserveNextSocialAddress("weird name", "testnet");
    expect(postMock).toHaveBeenCalledWith("/v1/social/weird%20name/next_address", {
      network: "testnet",
    });
  });

  test("wraps a 409 response into KeylessRecipientError", async () => {
    postMock.mockImplementationOnce(async () => {
      const err = new Error("keyless") as Error & { status: number };
      err.status = 409;
      throw err;
    });

    await expect(reserveNextSocialAddress("bob", "testnet")).rejects.toBeInstanceOf(
      KeylessRecipientError,
    );
  });

  test("re-throws a non-409 error unchanged", async () => {
    postMock.mockImplementationOnce(async () => {
      const err = new Error("server exploded") as Error & { status: number };
      err.status = 500;
      throw err;
    });

    await expect(reserveNextSocialAddress("carol", "testnet")).rejects.toThrow(
      "server exploded",
    );
  });
});

describe("enrichAddresses", () => {
  test("posts the batch and returns the data map", async () => {
    postMock.mockImplementationOnce(async () => ({
      data: {
        TAddr1: { kind: "unknown" },
        TAddr2: { kind: "merchant", displayName: "Shop" },
      },
    }));

    const result = await enrichAddresses(["TAddr1", "TAddr2"]);

    expect(postMock).toHaveBeenCalledWith("/v1/enrich", { addresses: ["TAddr1", "TAddr2"] });
    expect(result.TAddr1).toEqual({ kind: "unknown" });
    expect(result.TAddr2).toEqual({ kind: "merchant", displayName: "Shop" });
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/services/gateway-client.test.ts`
Expected: FAIL — `reserveNextSocialAddress is not a function` (only `submitTx` exists so far).

- [x] **Step 3: Implement**

Modify `~/Oxy/OxyPay/packages/frontend/src/services/gateway-client.ts` — add the `NetworkType` and new shared-types imports to the existing import line, and append the two new functions + error class after `submitTx`:

```ts
import type { NetworkType } from '@fairco.in/core';
import type {
  PaymentIntent,
  SocialNextAddressResponse,
  EnrichResponse,
  EnrichmentResult,
} from '@oxypay/shared-types';
import { oxyServices } from '@/services/oxy-services';
import { GATEWAY_API_URL } from '@/config';

export const gateway = oxyServices.createLinkedClient({ baseURL: GATEWAY_API_URL });

export async function submitTx(
  intentId: string,
  clientSecret: string,
  txid: string,
): Promise<PaymentIntent> {
  return gateway.client.post<PaymentIntent>(
    `/v1/payment_intents/${intentId}/submit_tx`,
    { client_secret: clientSecret, txid },
  );
}

/**
 * Thrown by {@link reserveNextSocialAddress} when the recipient has no Oxy
 * identity key to derive a receive address from (spec §4.5's "invite them"
 * path). Distinguished from every other failure by the backend's dedicated
 * `409` status (see `routes/social.ts`), so this wrapping never
 * misclassifies an unrelated server/network error as "keyless".
 */
export class KeylessRecipientError extends Error {
  constructor(username: string) {
    super(`@${username} has not set up an Oxy identity yet`);
    this.name = 'KeylessRecipientError';
  }
}

function hasStatus(error: unknown): error is { status: number } {
  return typeof error === 'object' && error !== null && 'status' in error &&
    typeof (error as { status: unknown }).status === 'number';
}

/**
 * Reserve the next fresh social-receive address for `@username` (spec §4.4
 * step 3). Possession of the caller's own Oxy bearer token (carried
 * automatically by the linked client) authorizes the call; the reservation
 * is also recorded server-side as the sender's attribution for this payment
 * (spec §4.8 bullet 2), so a later `enrichAddresses` call renders "Sent to
 * @username" from this app's OWN history without any further action here.
 */
export async function reserveNextSocialAddress(
  username: string,
  network: NetworkType,
): Promise<SocialNextAddressResponse> {
  try {
    return await gateway.client.post<SocialNextAddressResponse>(
      `/v1/social/${encodeURIComponent(username)}/next_address`,
      { network },
    );
  } catch (error: unknown) {
    if (hasStatus(error) && error.status === 409) {
      throw new KeylessRecipientError(username);
    }
    throw error;
  }
}

/**
 * Resolve display identity for a batch of the caller's own addresses (spec
 * §4.8) — "Paid at <merchant>" / "Sent to @x" / "Received from @x" / an
 * honest `unknown` for a pure external payment. Display-only: a failure here
 * must never be treated as a payment failure by callers.
 */
export async function enrichAddresses(
  addresses: string[],
): Promise<Record<string, EnrichmentResult>> {
  const response = await gateway.client.post<EnrichResponse>('/v1/enrich', { addresses });
  return response.data;
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bun test src/services/gateway-client.test.ts`
Expected: PASS.

- [x] **Step 5: Typecheck**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bunx tsc --noEmit`
Expected: no new errors.

- [x] **Step 6: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/src/services/gateway-client.ts packages/frontend/src/services/gateway-client.test.ts
git commit -m "feat(frontend): gateway-client social-receive + enrichment calls (spec §4.4, §4.8)"
```

---

## Task 14: Frontend — `UserAvatar.tsx` + `SocialRecipientPicker.tsx`

> ✅ **DONE** — commit `aefcd49`; task-review Approved. Media chokepoint (bare fileId), displayName ??, SocialRecipient shape, searchProfiles verified vs SDK source. Minor: barrel export for T16/T18. 2026-07-19.

The user-search UI for "pay a person" (spec §4.4 step 1): search Oxy users via `oxyServices.searchProfiles`, pick one. Structurally mirrors the existing `ContactPicker.tsx` (same `Modal` + search field + `FlashList` shape) but backed by the Oxy user directory instead of the local contacts DB, and renders identity via the canonical media chokepoint. BLOCKED on Task 13 only for the TYPE of the picked user's shape reuse convenience — no hard runtime dependency; can be built in parallel with it.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/components/UserAvatar.tsx`
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/components/SocialRecipientPicker.tsx`

**Interfaces:**
- Consumes: `oxyServices.searchProfiles(query, pagination?)` (`@oxyhq/core`, existing), Bloom `Avatar` (`@oxyhq/bloom/avatar`).
- Produces (consumed by Task 15's `SendSheet.tsx`):
  - `interface SocialRecipient { id: string; username: string; displayName?: string; avatarFileId?: string }`
  - `<UserAvatar avatarFileId? displayName? username size? />`
  - `<SocialRecipientPicker visible onSelect={(recipient: SocialRecipient) => void} onClose={() => void} />`

- [x] **Step 1: Implement `UserAvatar`**

Create `~/Oxy/OxyPay/packages/frontend/src/ui/components/UserAvatar.tsx`:

```tsx
/**
 * Bloom Avatar wrapper for an Oxy user — the canonical media chokepoint (a
 * bare file id resolved through the app-root `ImageResolverProvider`, Task
 * 17) plus the sanctioned `displayName ?? handle` fallback for the
 * placeholder initial. Used everywhere a user's avatar renders in Oxy Pay:
 * the recipient picker, the receive screen, and the transaction history.
 */
import type React from "react";
import { Avatar } from "@oxyhq/bloom/avatar";

export function UserAvatar({
  avatarFileId,
  displayName,
  username,
  size = 40,
}: {
  avatarFileId?: string;
  displayName?: string;
  username: string;
  size?: number;
}): React.JSX.Element {
  return (
    <Avatar source={avatarFileId} variant="thumb" size={size} name={displayName ?? username} />
  );
}
```

- [x] **Step 2: Implement `SocialRecipientPicker`**

Create `~/Oxy/OxyPay/packages/frontend/src/ui/components/SocialRecipientPicker.tsx`:

```tsx
/**
 * Recipient picker for "pay a person" (spec §4.4 step 1) — search Oxy users
 * by username/name and pick one. Mirrors `ContactPicker.tsx`'s Modal + search
 * + FlashList shape, backed by `oxyServices.searchProfiles` instead of the
 * local contacts database.
 */

import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ActivityIndicator } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@oxyhq/bloom/theme";
import { oxyServices } from "../../services/oxy-services";
import { UserAvatar } from "./UserAvatar";
import { t } from "../../i18n";

export interface SocialRecipient {
  id: string;
  username: string;
  displayName?: string;
  avatarFileId?: string;
}

interface SocialRecipientPickerProps {
  visible: boolean;
  onSelect: (recipient: SocialRecipient) => void;
  onClose: () => void;
}

/** Debounce delay before a keystroke triggers a search request. */
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const SEARCH_RESULT_LIMIT = 20;

function SocialRecipientRow({
  recipient,
  onPress,
}: {
  recipient: SocialRecipient;
  onPress: (recipient: SocialRecipient) => void;
}) {
  const handlePress = useCallback(() => {
    onPress(recipient);
  }, [recipient, onPress]);

  return (
    <Pressable
      className="flex-row items-center px-4 py-3 border-b border-border active:bg-background"
      onPress={handlePress}
    >
      <View className="mr-3">
        <UserAvatar
          avatarFileId={recipient.avatarFileId}
          displayName={recipient.displayName}
          username={recipient.username}
          size={40}
        />
      </View>
      <View className="flex-1">
        <Text className="text-foreground text-sm font-medium">
          {recipient.displayName ?? recipient.username}
        </Text>
        <Text className="text-muted-foreground text-xs mt-0.5">@{recipient.username}</Text>
      </View>
    </Pressable>
  );
}

export function SocialRecipientPicker({
  visible,
  onSelect,
  onClose,
}: SocialRecipientPickerProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["oxyUserSearch", debouncedQuery],
    queryFn: async (): Promise<SocialRecipient[]> => {
      const response = await oxyServices.searchProfiles(debouncedQuery, {
        limit: SEARCH_RESULT_LIMIT,
      });
      return response.data.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.name.displayName,
        avatarFileId: user.avatar ?? undefined,
      }));
    },
    enabled: debouncedQuery.length >= MIN_QUERY_LENGTH,
  });

  const results = data ?? [];

  const handleOpen = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
  }, []);

  const handleClose = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    onClose();
  }, [onClose]);

  const handleSelect = useCallback(
    (recipient: SocialRecipient) => {
      onSelect(recipient);
      handleClose();
    },
    [onSelect, handleClose],
  );

  const renderItem = useCallback(
    ({ item }: { item: SocialRecipient }) => (
      <SocialRecipientRow recipient={item} onPress={handleSelect} />
    ),
    [handleSelect],
  );

  const keyExtractor = useCallback((item: SocialRecipient) => item.id, []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} onShow={handleOpen}>
      <View className="flex-1 bg-background">
        <View className="pt-14 pb-3 px-6 flex-row items-center justify-between bg-background border-b border-border">
          <Text className="text-foreground text-lg font-bold">
            {t("socialRecipientPicker.title")}
          </Text>
          <Pressable onPress={handleClose} className="p-2">
            <Text className="text-primary text-base font-semibold">{t("common.close")}</Text>
          </Pressable>
        </View>

        <View className="px-4 py-3">
          <View className="bg-surface border border-border rounded-xl px-4 py-2.5">
            <TextInput
              className="text-foreground text-sm"
              placeholder={t("socialRecipientPicker.searchPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        {isFetching ? (
          <View className="items-center py-8">
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : debouncedQuery.length < MIN_QUERY_LENGTH ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-muted-foreground text-base text-center">
              {t("socialRecipientPicker.prompt")}
            </Text>
          </View>
        ) : results.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-muted-foreground text-base text-center">
              {t("socialRecipientPicker.empty")}
            </Text>
          </View>
        ) : (
          <FlashList
            data={results}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            className="flex-1"
            contentContainerClassName="pb-8"
          />
        )}
      </View>
    </Modal>
  );
}
```

- [x] **Step 3: Add the four new i18n keys (both locale blocks)**

Modify `~/Oxy/OxyPay/packages/frontend/src/i18n/index.ts` — translations live as flat dot-separated keys directly in this file (no separate JSON files), in two blocks: an English block (around the existing `"contactPicker.title": "Pick Contact",` line ~408) and a Spanish block (around the equivalent line ~1180). Add alongside the existing `contactPicker.*` keys in EACH block:

English block:
```ts
    "socialRecipientPicker.title": "Pay a person",
    "socialRecipientPicker.searchPlaceholder": "Search by username or name",
    "socialRecipientPicker.prompt": "Search for someone to pay",
    "socialRecipientPicker.empty": "No one found",
```

Spanish block:
```ts
    "socialRecipientPicker.title": "Pagar a una persona",
    "socialRecipientPicker.searchPlaceholder": "Buscar por usuario o nombre",
    "socialRecipientPicker.prompt": "Busca a alguien para pagarle",
    "socialRecipientPicker.empty": "Nadie encontrado",
```

- [x] **Step 4: Typecheck**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bunx tsc --noEmit`
Expected: no new errors.

- [x] **Step 5: Verify on a real foregrounded device/emulator**

Open the picker (once wired in Task 15), type at least 2 characters of a real testnet Oxy username, confirm results appear with avatar + display name + handle, confirm selecting one closes the picker and calls `onSelect`.

- [x] **Step 6: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/src/ui/components/UserAvatar.tsx packages/frontend/src/ui/components/SocialRecipientPicker.tsx packages/frontend/src/i18n/index.ts
git commit -m "feat(frontend): SocialRecipientPicker + UserAvatar (spec §4.4 step 1)"
```

---

## Task 15: Frontend — `SendSheet.tsx` — Person/Address recipient toggle

> ✅ **DONE** — commit `6348b69`+CRITICAL fix `83e6f59` (1 fix cycle); re-review Approved. Review caught a money-path stale-address race (switch-back armed Send with abandoned reservation) → generation-counter guard. Device-verify DEFERRED. 2026-07-19.

Wires the social send flow into the existing Send screen: "Pay a person" (default/primary) resolves `@username` → reserves a fresh receive address from the backend → proceeds through the SAME amount/fee/confirm/broadcast flow already built; "Send to FairCoin address" (secondary) is the untouched existing raw-address flow (spec §4.4). BLOCKED on Task 14 (picker) and Task 13 (reservation call). No test file — `SendSheet.tsx`, like every other file in `src/ui/`, has no existing unit test in this codebase; correctness is typecheck + real-device verification (same convention as Tasks 10/12).

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/SendSheet.tsx`

**Interfaces:**
- Consumes: `SocialRecipientPicker`, `SocialRecipient`, `UserAvatar` (Task 14), `reserveNextSocialAddress`, `KeylessRecipientError` (Task 13).
- Produces: no exported change — `SendSheet`'s own props (`address?`, `amount?`) are unchanged.

- [x] **Step 1: Add imports**

Modify `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/SendSheet.tsx` — add `ActivityIndicator` to the existing `react-native` import:

```ts
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator } from "react-native";
```

Add three new imports right after the existing `import { ContactPicker } from "../components/ContactPicker";` line:

```ts
import { SocialRecipientPicker, type SocialRecipient } from "../components/SocialRecipientPicker";
import { UserAvatar } from "../components/UserAvatar";
import { reserveNextSocialAddress, KeylessRecipientError } from "../../services/gateway-client";
```

- [x] **Step 2: Add new state and handlers**

Modify `SendSheet` — add right after the existing `const [showContactPicker, setShowContactPicker] = useState(false);` line:

```ts
  const [recipientMode, setRecipientMode] = useState<"person" | "address">("person");
  const [selectedRecipient, setSelectedRecipient] = useState<SocialRecipient | null>(null);
  const [showRecipientPicker, setShowRecipientPicker] = useState(false);
  const [reservingAddress, setReservingAddress] = useState(false);
  const [keylessRecipientUsername, setKeylessRecipientUsername] = useState<string | null>(null);
```

Add the handlers right after the existing `handleCloseContactPicker` callback:

```ts
  const handleOpenRecipientPicker = useCallback(() => {
    setKeylessRecipientUsername(null);
    setShowRecipientPicker(true);
  }, []);

  const handleCloseRecipientPicker = useCallback(() => {
    setShowRecipientPicker(false);
  }, []);

  const handleSelectRecipient = useCallback(
    async (recipient: SocialRecipient) => {
      setSelectedRecipient(recipient);
      setToAddress("");
      setKeylessRecipientUsername(null);
      setReservingAddress(true);
      try {
        const reservation = await reserveNextSocialAddress(recipient.username, network);
        setToAddress(reservation.address);
      } catch (e: unknown) {
        if (e instanceof KeylessRecipientError) {
          setKeylessRecipientUsername(recipient.username);
          setSelectedRecipient(null);
        } else {
          setError(e instanceof Error ? e.message : t("send.error.failedSend"));
          setSelectedRecipient(null);
        }
      } finally {
        setReservingAddress(false);
      }
    },
    [network],
  );

  const handleClearSelectedRecipient = useCallback(() => {
    setSelectedRecipient(null);
    setToAddress("");
    setKeylessRecipientUsername(null);
  }, []);

  const handleRecipientModeChange = useCallback((mode: "person" | "address") => {
    setRecipientMode(mode);
    setSelectedRecipient(null);
    setKeylessRecipientUsername(null);
    setToAddress("");
  }, []);
```

- [x] **Step 3: Replace the "Recipient" section with the mode toggle**

Modify `SendSheet` — replace the ENTIRE existing block, from the `{/* Recipient — card-less: a filled surface field, no border */}` comment through the closing `</View>` of the paste/scanQR/contacts button row (the whole "Recipient" `<View>` — the current file's lines ~456–543), with:

```tsx
        {/* Recipient — Person (primary) / Address (secondary) toggle, spec §4.4 */}
        <View>
          <View className="flex-row items-center justify-between">
            <Text className={SECTION_LABEL}>{t("send.sendTo")}</Text>
            <View className="flex-row bg-surface rounded-full p-0.5">
              <Pressable
                onPress={() => handleRecipientModeChange("person")}
                className={`px-3 py-1.5 rounded-full ${recipientMode === "person" ? "bg-primary/15" : ""}`}
              >
                <Text
                  className={`text-xs font-semibold ${recipientMode === "person" ? "text-primary" : "text-muted-foreground"}`}
                >
                  {t("send.recipientMode.person")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => handleRecipientModeChange("address")}
                className={`px-3 py-1.5 rounded-full ${recipientMode === "address" ? "bg-primary/15" : ""}`}
              >
                <Text
                  className={`text-xs font-semibold ${recipientMode === "address" ? "text-primary" : "text-muted-foreground"}`}
                >
                  {t("send.recipientMode.address")}
                </Text>
              </Pressable>
            </View>
          </View>

          {recipientMode === "person" ? (
            <View className="mt-2">
              <View className="bg-surface rounded-2xl px-4 py-3.5">
                {reservingAddress ? (
                  <View className="flex-row items-center py-1">
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <Text className="text-muted-foreground text-sm ml-2">
                      {t("send.recipientMode.reserving")}
                    </Text>
                  </View>
                ) : selectedRecipient ? (
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center flex-1">
                      <View className="mr-3">
                        <UserAvatar
                          avatarFileId={selectedRecipient.avatarFileId}
                          displayName={selectedRecipient.displayName}
                          username={selectedRecipient.username}
                          size={40}
                        />
                      </View>
                      <View className="flex-1">
                        <Text className="text-foreground text-base font-semibold">
                          {selectedRecipient.displayName ?? selectedRecipient.username}
                        </Text>
                        <Text className="text-muted-foreground text-xs mt-0.5">
                          @{selectedRecipient.username}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      className="p-1.5 rounded-full active:opacity-60"
                      onPress={handleClearSelectedRecipient}
                      accessibilityLabel={t("send.clearRecipient")}
                    >
                      <MaterialCommunityIcons
                        name="close-circle"
                        size={20}
                        color={theme.colors.textSecondary}
                      />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    className="flex-row items-center justify-between active:opacity-70"
                    onPress={handleOpenRecipientPicker}
                  >
                    <Text className="text-muted-foreground text-base">
                      {t("send.recipientMode.choosePlaceholder")}
                    </Text>
                    <MaterialCommunityIcons
                      name="account-search"
                      size={20}
                      color={theme.colors.primary}
                    />
                  </Pressable>
                )}
              </View>

              {keylessRecipientUsername ? (
                <View className="bg-primary/10 rounded-2xl p-3.5 mt-2.5">
                  <Text className="text-foreground text-sm text-center">
                    {t("send.recipientMode.keyless", { username: keylessRecipientUsername })}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <>
              <View className="bg-surface rounded-2xl px-4 py-3.5 mt-2">
                {matchedContact ? (
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center flex-1">
                      <View className="mr-3">
                        <ContactAvatar name={matchedContact.name} size={40} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-foreground text-base font-semibold">
                          {matchedContact.name}
                        </Text>
                        <Text className="text-muted-foreground text-xs mt-0.5">
                          {truncateAddress(matchedContact.address)}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      className="p-1.5 rounded-full active:opacity-60"
                      onPress={handleClearRecipient}
                      accessibilityLabel={t("send.clearRecipient")}
                    >
                      <MaterialCommunityIcons
                        name="close-circle"
                        size={20}
                        color={theme.colors.textSecondary}
                      />
                    </Pressable>
                  </View>
                ) : (
                  <TextInput
                    className="text-foreground text-base"
                    style={{ paddingVertical: 2 }}
                    placeholder={t("send.addressPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={toAddress}
                    onChangeText={setToAddress}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline={false}
                  />
                )}
              </View>

              <View className="flex-row gap-2 mt-2.5">
                <Pressable
                  className="flex-1 flex-row items-center justify-center bg-surface rounded-full px-3 py-2.5 active:opacity-70"
                  onPress={handlePaste}
                >
                  <MaterialCommunityIcons
                    name="content-paste"
                    size={14}
                    color={theme.colors.primary}
                  />
                  <Text className="text-primary text-xs ml-1.5 font-semibold">
                    {t("send.paste")}
                  </Text>
                </Pressable>
                <Pressable
                  className="flex-1 flex-row items-center justify-center bg-surface rounded-full px-3 py-2.5 active:opacity-70"
                  onPress={handleOpenScanner}
                >
                  <MaterialCommunityIcons
                    name="qrcode-scan"
                    size={14}
                    color={theme.colors.primary}
                  />
                  <Text className="text-primary text-xs ml-1.5 font-semibold">
                    {t("send.scanQR")}
                  </Text>
                </Pressable>
                <Pressable
                  className="flex-1 flex-row items-center justify-center bg-surface rounded-full px-3 py-2.5 active:opacity-70"
                  onPress={handleOpenContactPicker}
                >
                  <MaterialCommunityIcons
                    name="account-box"
                    size={14}
                    color={theme.colors.primary}
                  />
                  <Text className="text-primary text-xs ml-1.5 font-semibold">
                    {t("send.contacts")}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
```

- [x] **Step 4: Gate `canSend` on the reservation being resolved**

Modify the existing `canSend` computation to also require the address reservation isn't still in flight:

```ts
  const canSend =
    addressValid &&
    amountSats !== null &&
    amountSats > 0n &&
    validationError === null &&
    !reservingAddress;
```

- [x] **Step 5: Show the resolved recipient's name in the confirm dialog**

Modify the confirm `<Dialog>`'s first `<ListItem>` (`title={t("send.confirm.to")}`):

```tsx
          <ListItem
            title={t("send.confirm.to")}
            subtitle={
              recipientMode === "person" && selectedRecipient
                ? `${selectedRecipient.displayName ?? selectedRecipient.username} (@${selectedRecipient.username})`
                : matchedContact
                  ? matchedContact.name
                  : toAddress
            }
            showChevron={false}
          />
```

- [x] **Step 6: Skip the contact-saving prompt for a social send, and reset the new state on success**

Modify `handleConfirmSend` — the ONLY changes are (a) gating the "record recent recipient / prompt to save as contact" block behind `recipientMode === "address"`, and (b) resetting the new recipient state alongside the existing `setToAddress(""); setAmount("");`:

```ts
  const handleConfirmSend = useCallback(async () => {
    setError(null);
    try {
      if (amountSats === null || amountSats <= 0n) {
        setError(t("send.error.invalidAmount"));
        return;
      }
      const sentAddress = toAddress;
      const txid = await sendTransaction(sentAddress, amountSats, feeRate);
      hapticSuccess();
      playSent();
      setSuccess(null);
      setToAddress("");
      setAmount("");
      setSelectedRecipient(null);
      setKeylessRecipientUsername(null);
      setSentTxid(txid);
      sentControl.open();

      // Recent-recipients / save-as-contact only apply to raw-address sends —
      // a social-receive address is single-use, so saving it as a reusable
      // contact would be misleading (spec §4.3, addr(i>=1) is fresh per payment).
      if (recipientMode === "address") {
        const db = getDatabase();
        if (db) {
          db.addRecentRecipient(sentAddress);
          refreshRecentRecipients();

          const existingContact = await getContactByAddress(db, sentAddress);
          if (!existingContact) {
            setPendingSaveAddress(sentAddress);
            saveContactControl.open();
          }
        }
      }
    } catch (e: unknown) {
      hapticError();
      const msg =
        e instanceof Error ? e.message : t("send.error.failedSend");
      setError(msg);
    }
  }, [
    toAddress,
    amountSats,
    feeRate,
    sendTransaction,
    recipientMode,
    getContactByAddress,
    refreshRecentRecipients,
    saveContactControl,
    sentControl,
  ]);
```

- [x] **Step 7: Render the picker**

Modify the end of `SendSheet`'s returned JSX — add `<SocialRecipientPicker>` right after the existing `<ContactPicker>`:

```tsx
      {/* Social recipient picker (spec §4.4 step 1) */}
      <SocialRecipientPicker
        visible={showRecipientPicker}
        onSelect={handleSelectRecipient}
        onClose={handleCloseRecipientPicker}
      />
```

- [x] **Step 8: Add the new i18n keys (both locale blocks, same file/pattern as Task 14 Step 3)**

Modify `~/Oxy/OxyPay/packages/frontend/src/i18n/index.ts`:

English block:
```ts
    "send.recipientMode.person": "Person",
    "send.recipientMode.address": "Address",
    "send.recipientMode.choosePlaceholder": "Choose who to pay",
    "send.recipientMode.reserving": "Getting their address…",
    "send.recipientMode.keyless": "@{{username}} hasn't set up Oxy Pay yet. Invite them to get paid instantly next time.",
```

Spanish block:
```ts
    "send.recipientMode.person": "Persona",
    "send.recipientMode.address": "Dirección",
    "send.recipientMode.choosePlaceholder": "Elige a quién pagar",
    "send.recipientMode.reserving": "Obteniendo su dirección…",
    "send.recipientMode.keyless": "@{{username}} aún no configuró Oxy Pay. Invítalo para recibir pagos al instante la próxima vez.",
```

- [x] **Step 9: Typecheck**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bunx tsc --noEmit`
Expected: no new errors.

- [x] **Step 10: Verify on a real foregrounded device/emulator (testnet)**

1. Open Send. Confirm "Person" is the default selected mode.
2. Tap the recipient field, search a real testnet Oxy username, select it. Confirm the "Getting their address…" spinner appears then resolves to the avatar+name card.
3. Enter an amount, confirm, verify the send completes and the confirm dialog showed "Alice (@alice)" rather than a raw address.
4. Switch to "Address" mode, confirm the ORIGINAL paste/scan/contacts flow still works exactly as before (regression check).
5. Search for a KEYLESS testnet account (or ask another agent to create one via Commons without linking an identity) and confirm the "hasn't set up Oxy Pay yet" notice appears instead of a reservation.

- [x] **Step 11: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/src/ui/sheets/SendSheet.tsx packages/frontend/src/i18n/index.ts
git commit -m "feat(frontend): SendSheet Person/Address recipient toggle (spec §4.4)"
```

---

## Task 16: Frontend — `ReceiveSheet.tsx` — `@username` + stable social default address

> ✅ **DONE** — commit `534004a`; controller-verified (fallback order, @username gate, i18n, all-addresses untouched). 2026-07-19.

Spec §4.5: "Home shows your `@username` + your default address (`addr(0)`) with QR + copy + save-as-favourite." The screen's primary QR/copy target becomes the STABLE social-receive default address instead of the private spending tree's rotating receive address; the existing "all addresses" list (private tree) stays available for users who want a fresh private address. BLOCKED on Task 12 (`socialReceiveDefaultAddress` in the store).

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/ReceiveSheet.tsx`

**Interfaces:**
- Consumes: `WalletState.socialReceiveDefaultAddress` (Task 12), `useOxy().user.username` (`@oxyhq/services`, existing).

- [x] **Step 1: Add imports and read the new store field + the current user**

Modify `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/ReceiveSheet.tsx` — add to the existing imports:

```ts
import { useOxy } from "@oxyhq/services";
```

Modify the top of `ReceiveSheet` — add right after the existing `const addresses = useWalletStore((s) => s.addresses);` line:

```ts
  const socialReceiveDefaultAddress = useWalletStore((s) => s.socialReceiveDefaultAddress);
  const { user } = useOxy();
```

- [x] **Step 2: Prefer the social default address as the primary QR/copy target**

Modify the existing `displayAddress` computation:

```ts
  const displayAddress = selectedAddress ?? socialReceiveDefaultAddress ?? receiveAddress;
```

- [x] **Step 3: Show `@username` above the QR**

Modify the returned JSX — add a new block right after the existing `{heading ? ( ... ) : null}` title block, before the `{/* Big centered QR ... */}` comment:

```tsx
        {user?.username ? (
          <View className="items-center">
            <Text className="text-muted-foreground text-sm">{t("receive.payMeAt")}</Text>
            <Text className="text-foreground text-lg font-bold mt-0.5">@{user.username}</Text>
          </View>
        ) : null}
```

- [x] **Step 4: Add the new i18n key (both locale blocks, same file/pattern as Task 14 Step 3)**

Modify `~/Oxy/OxyPay/packages/frontend/src/i18n/index.ts`:

English block: `"receive.payMeAt": "Pay me at",`
Spanish block: `"receive.payMeAt": "Págame en",`

- [x] **Step 5: Typecheck**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bunx tsc --noEmit`
Expected: no new errors.

- [x] **Step 6: Verify on a real foregrounded device/emulator (testnet)**

1. Open Receive. Confirm `@<your username>` renders above the QR.
2. Confirm the QR/address shown is the SAME address across app restarts (the stable `addr(0)`) — compare against a value logged during Task 12's device verification.
3. Pay THAT exact address from a different testnet wallet and confirm it's detected as a receive in this wallet (proves `addr(0)` really is watched — should already be true from Task 12's verification, this just confirms the UI shows the right value).
4. Tap "All addresses" and confirm the private spending tree's addresses still list and copy correctly (regression check — unrelated to this change).

- [x] **Step 7: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/src/ui/sheets/ReceiveSheet.tsx packages/frontend/src/i18n/index.ts
git commit -m "feat(frontend): ReceiveSheet shows @username + stable social default address (spec §4.5)"
```

---

## Task 17: Frontend — `ImageResolverProvider` registration + `useTransactionEnrichment` hook

> ✅ **DONE** — commit `93df160`; task-review Approved. Provider boot-safe + canonical chokepoint, queryKey stable, degrade-to-{}. Verified vs installed pkg source. 2026-07-19.

Registers the canonical Oxy media chokepoint ONCE at the app root (required before `UserAvatar`/Bloom `Avatar` can resolve ANY bare file id anywhere in the app — this has never been wired in Oxy Pay before this plan) and adds the React Query wrapper around Task 13's `enrichAddresses`. BLOCKED on Task 13. No dedicated hook test — mirrors this codebase's own `useMarketData.ts` precedent (the hook has no test file; the underlying fetcher, `enrichAddresses`, is already tested in Task 13).

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/app/_layout.tsx`
- Create: `~/Oxy/OxyPay/packages/frontend/src/hooks/useTransactionEnrichment.ts`

**Interfaces:**
- Consumes: `enrichAddresses` (Task 13), `ImageResolverProvider` (`@oxyhq/bloom/image-resolver`), `oxyServices.getFileDownloadUrl(id, variant)` (`@oxyhq/core`, existing).
- Produces: `useTransactionEnrichment(addresses: string[]): Record<string, EnrichmentResult>` — consumed by Task 18.

- [x] **Step 1: Register the `ImageResolverProvider` at the app root**

Modify `~/Oxy/OxyPay/packages/frontend/app/_layout.tsx` — add the import:

```ts
import { ImageResolverProvider } from "@oxyhq/bloom/image-resolver";
```

Wrap `<BottomSheetModalProvider>` (and everything inside it) with the resolver provider, INSIDE the existing `<OxyProvider>` (so `oxyServices` is the same instance already configured with `OXY_BASE_URL`):

```tsx
            <OxyProvider
              oxyServices={oxyServices}
              clientId={OXY_CLIENT_ID}
              authRedirectUri={OXY_AUTH_REDIRECT_URI}
              storageKeyPrefix="oxypay"
              queryClient={queryClient}
            >
              <ImageResolverProvider value={(id, variant) => oxyServices.getFileDownloadUrl(id, variant)}>
                <BottomSheetModalProvider>
                  <AppContent
                    key={language}
                    ready={fontsLoaded && themeReady && languageReady}
                  />
                </BottomSheetModalProvider>
              </ImageResolverProvider>
            </OxyProvider>
```

- [x] **Step 2: Implement the enrichment hook**

Create `~/Oxy/OxyPay/packages/frontend/src/hooks/useTransactionEnrichment.ts`:

```ts
/**
 * Resolve display identity for the wallet's own transaction addresses (spec
 * §4.8) — batched and cached via React Query. Enrichment is display-only: a
 * failed request never surfaces as an error, callers just render raw
 * address + amount for whichever entries are missing from the returned map.
 */
import { useQuery } from "@tanstack/react-query";
import type { EnrichmentResult } from "@oxypay/shared-types";
import { enrichAddresses } from "../services/gateway-client";

/** Mirrors the backend's `ENRICH_MAX_ADDRESSES` cap. */
const MAX_ENRICH_BATCH = 50;
const ENRICHMENT_STALE_TIME_MS = 5 * 60 * 1000;

export function useTransactionEnrichment(
  addresses: string[],
): Record<string, EnrichmentResult> {
  const uniqueAddresses = [...new Set(addresses)].sort().slice(0, MAX_ENRICH_BATCH);

  const { data } = useQuery({
    queryKey: ["transactionEnrichment", uniqueAddresses],
    queryFn: () => enrichAddresses(uniqueAddresses),
    enabled: uniqueAddresses.length > 0,
    staleTime: ENRICHMENT_STALE_TIME_MS,
    // Display-only (spec §4.8) — a failed lookup must never surface as an
    // error state; render raw address + amount instead.
    throwOnError: false,
  });

  return data ?? {};
}
```

- [x] **Step 3: Typecheck**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bunx tsc --noEmit`
Expected: no new errors.

- [x] **Step 4: Verify on a real foregrounded device/emulator**

Confirm the app still boots cleanly (no crash from the new provider wrap) and any EXISTING `Avatar` usage elsewhere in the app (if any) still renders — this provider wrap is app-wide, so a mistake here is app-wide too.

- [x] **Step 5: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/app/_layout.tsx packages/frontend/src/hooks/useTransactionEnrichment.ts
git commit -m "feat(frontend): register ImageResolverProvider + useTransactionEnrichment hook (spec §4.8)"
```

---

## Task 18: Frontend — rich transaction identity in the list + detail views

> ✅ **DONE** — commit `36bf59f`; task-review Approved. Rich per-kind identity, graceful degrade, canonical media, viewer-scoped. **← WS-S FEATURE CODE COMPLETE (T1-18).** 2026-07-19.

The payoff of §4.8: "Paid at Mercaria" / "Sent to @alice" / "Received from @bob" with an avatar, instead of a raw address, in both the home Activity list and the transaction detail sheet. BLOCKED on Task 17.

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/src/ui/components/TransactionItem.tsx`
- Modify: `~/Oxy/OxyPay/packages/frontend/app/(tabs)/index.tsx`
- Modify: `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/TransactionDetailSheet.tsx`

**Interfaces:**
- Consumes: `useTransactionEnrichment` (Task 17), `EnrichmentResult` (`@oxypay/shared-types`, Task 3), Bloom `Avatar`.
- Produces: `TransactionItemProps.identity?: EnrichmentResult` — new optional prop; every existing caller (there is only one, `(tabs)/index.tsx`) keeps working unchanged if it omits the prop.

- [x] **Step 1: Extend `TransactionItem` with an optional identity override**

Modify `~/Oxy/OxyPay/packages/frontend/src/ui/components/TransactionItem.tsx` — add the import:

```ts
import { Avatar } from "@oxyhq/bloom/avatar";
import type { EnrichmentResult } from "@oxypay/shared-types";
```

Add `identity?: EnrichmentResult;` to `TransactionItemProps`, right after the existing `onPress?: (txid: string) => void;` field:

```ts
  /**
   * Resolved counterparty identity (spec §4.8) — when present, overrides the
   * default "Sent"/"Received" label + address subtitle + leading icon with
   * "Paid at <merchant>" / "Sent to @x" / "Received from @x" + their avatar.
   * Omit (or pass an `unknown`-kind result) to keep the default rendering —
   * the honest fallback for a pure external on-chain payment (spec §4.5).
   */
  identity?: EnrichmentResult;
```

Add a small label helper right after the existing `truncateAddress` function:

```ts
function describeIdentityLabel(type: TransactionType, identity: EnrichmentResult): string {
  if (identity.kind === "merchant") {
    return t("transaction.item.paidAt", {
      name: identity.displayName ?? t("transaction.item.merchant"),
    });
  }
  const name = identity.displayName ?? identity.username ?? "";
  return type === "send"
    ? t("transaction.item.sentToUser", { name })
    : t("transaction.item.receivedFromUser", { name });
}
```

Modify the component's destructured props to accept `identity`:

```ts
export function TransactionItem({
  txid,
  type,
  value,
  address,
  timestamp,
  confirmations,
  onPress,
  identity,
}: TransactionItemProps) {
```

Modify the leading-icon block (inside `<ConfirmationRing>`) to render an avatar when `identity` is resolved:

```tsx
      <View className="mr-3">
        <ConfirmationRing
          progress={confirmProgress}
          color={theme.colors.warning}
          size={44}
        >
          {identity ? (
            <Avatar
              source={identity.avatarFileId}
              variant="thumb"
              size={settled ? 44 : 36}
              name={identity.displayName ?? identity.username ?? ""}
            />
          ) : (
            <View
              className={`${settled ? "w-11 h-11" : "w-9 h-9"} rounded-full ${staticConfig.iconBg} items-center justify-center`}
            >
              <MaterialCommunityIcons
                name={staticConfig.icon}
                size={settled ? 20 : 18}
                color={iconColor}
              />
            </View>
          )}
        </ConfirmationRing>
      </View>
```

Modify the label + subtitle block right below it:

```tsx
      <View className="flex-1 mr-3">
        <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
          {identity ? describeIdentityLabel(type, identity) : t(staticConfig.labelKey)}
        </Text>
        <Text
          className="text-muted-foreground text-xs mt-0.5"
          numberOfLines={1}
        >
          {identity?.kind === "user" && identity.username ? `@${identity.username}` : truncated}
        </Text>
      </View>
```

- [x] **Step 2: Add the four new i18n keys (both locale blocks)**

Modify `~/Oxy/OxyPay/packages/frontend/src/i18n/index.ts`:

English block:
```ts
    "transaction.item.paidAt": "Paid at {{name}}",
    "transaction.item.merchant": "a merchant",
    "transaction.item.sentToUser": "Sent to {{name}}",
    "transaction.item.receivedFromUser": "Received from {{name}}",
    "transaction.with": "With",
```

Spanish block:
```ts
    "transaction.item.paidAt": "Pagado en {{name}}",
    "transaction.item.merchant": "un comercio",
    "transaction.item.sentToUser": "Enviado a {{name}}",
    "transaction.item.receivedFromUser": "Recibido de {{name}}",
    "transaction.with": "Con",
```

- [x] **Step 3: Wire enrichment into the home Activity list**

Modify `~/Oxy/OxyPay/packages/frontend/app/(tabs)/index.tsx` — add the import:

```ts
import { useTransactionEnrichment } from "../../src/hooks/useTransactionEnrichment";
```

Add right after the existing `const activityGroups = useMemo(() => groupByDay(transactions.slice(0, 10)), [transactions]);`:

```ts
  const enrichmentAddresses = useMemo(
    () => activityGroups.flatMap((group) => group.items.map((tx) => tx.address)),
    [activityGroups],
  );
  const enrichment = useTransactionEnrichment(enrichmentAddresses);
```

Modify the `<TransactionItem>` call inside the `activityGroups.map` render to pass the resolved identity (an `unknown`-kind result is passed through as `undefined` so the default rendering applies):

```tsx
                {group.items.map((tx) => (
                  <TransactionItem
                    key={tx.txid}
                    txid={tx.txid}
                    type={tx.type}
                    value={tx.amount}
                    address={tx.address}
                    timestamp={tx.timestamp}
                    confirmations={tx.confirmations}
                    onPress={openTxDetail}
                    identity={
                      enrichment[tx.address]?.kind !== "unknown"
                        ? enrichment[tx.address]
                        : undefined
                    }
                  />
                ))}
```

- [x] **Step 4: Wire enrichment into the transaction detail sheet**

Modify `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/TransactionDetailSheet.tsx` — add the import:

```ts
import { useTransactionEnrichment } from "../../hooks/useTransactionEnrichment";
```

Add right after the existing `const transaction = useMemo<WalletTransaction | undefined>(...)` block:

```ts
  const enrichment = useTransactionEnrichment(transaction ? [transaction.address] : []);
  const identity = transaction ? enrichment[transaction.address] : undefined;
```

Add a new `<DetailRow>` right before the existing `label={t("transaction.address")}` row, only rendered when identity resolves to something other than `unknown`:

```tsx
          {identity && identity.kind !== "unknown" ? (
            <DetailRow
              label={t("transaction.with")}
              value={
                identity.kind === "merchant"
                  ? (identity.displayName ?? t("transaction.item.merchant"))
                  : `${identity.displayName ?? identity.username ?? ""}${
                      identity.username ? ` (@${identity.username})` : ""
                    }`
              }
            />
          ) : null}
```

- [x] **Step 5: Typecheck**

Run: `cd ~/Oxy/OxyPay/packages/frontend && bunx tsc --noEmit`
Expected: no new errors.

- [x] **Step 6: Verify on a real foregrounded device/emulator (testnet)**

1. From Task 15/16's device verification, you should have at least one social send and one social receive in your history. Confirm the home Activity list shows "Sent to <name>" / "Received from <name>" with an avatar for those rows, and the default "Sent"/"Received" + address for any OTHER (external) transaction.
2. Tap a social transaction row and confirm the detail sheet shows a "With" row naming the counterparty, above the raw address.
3. Confirm a merchant PaymentIntent payment (if you have a live merchant/testnet flow available) shows "Paid at <merchant>" with the merchant's logo.
4. Turn off network (airplane mode) and confirm the list still renders — every row falls back to the default "Sent"/"Received" + address, no crash, no error banner (spec §4.8's "degrades gracefully").

- [x] **Step 7: Commit**

```bash
cd ~/Oxy/OxyPay
git add packages/frontend/src/ui/components/TransactionItem.tsx packages/frontend/app/\(tabs\)/index.tsx packages/frontend/src/ui/sheets/TransactionDetailSheet.tsx packages/frontend/src/i18n/index.ts
git commit -m "feat(frontend): rich transaction identity in list + detail views (spec §4.8)"
```

---

## Task 19: `security-reviewer` audit gate (MANDATORY before mainnet)

> ✅ **DONE (gate executed)** — security-reviewer audit run 2026-07-19. VERDICT: NOT mainnet-eligible — F-1 (HIGH, key-rotation shared-slot desync, fund-loss) blocks; owner routed F-1 upstream to identity-v2. F-2/F-3 owner-accepted+documented (memory). TESTNET-ONLY until F-1 fixed. 2026-07-19.

Spec §2.3, §7, §10 step 4: the derivation scheme — specifically the identity-key-derived social-receive branch, the ONE place the identity key is reused directly for money — MUST pass a `security-reviewer` audit before any mainnet-capable build ships. This task is the gate itself, not a code change. BLOCKED on every prior task in this plan.

**Files:** none (review only; findings get their own follow-up tasks/commits).

**Interfaces:** none.

- [x] **Step 1: Confirm every prerequisite task is committed and green**

```bash
cd ~/faircoin-core && bun test
cd ~/Oxy/OxyPay/packages/backend && bun test src
cd ~/Oxy/OxyPay/packages/shared-types && bun test
cd ~/Oxy/OxyPay/packages/frontend && bun test src && bunx tsc --noEmit
```
Expected: all green.

- [x] **Step 2: Invoke the `security-reviewer` agent**

Dispatch a `security-reviewer` agent (or, if working in Claude Code, run `/security-review`) against the full branch diff, with this explicit brief — do not let the review scope narrow to "changed lines only" for the crypto:

> Review the Oxy Pay social-receive derivation scheme end to end:
> 1. `@fairco.in/core` `~/faircoin-core/src/social-receive.ts` (generic secp256k1 scheme, published — confirm it has NOT gained any Oxy/DID-specific code, and that `@oxyhq/core` was NOT modified for this feature) + `packages/frontend/src/wallet/social-receive.ts`'s `getIdentityPrivateKeyBytes`/`canonicalizePrivateKeyHex` (OxyPay-owned glue that reads the raw key from `@oxyhq/core`'s EXISTING `getSharedPrivateKey`/`getPrivateKey` and feeds it to the published helper) — the deterministic `xpub_social`/`xprv_social`/`addr(i)` scheme that reuses the Oxy identity secp256k1 key directly for FairCoin derivation (design spec §4.3, §7c). Specifically assess: nonce-hygiene and cross-protocol signing risk between DID/identity signing and FairCoin transaction signing sharing the same EC key; whether the public-key normalization (compressed vs uncompressed, in `@fairco.in/core`) AND the private-key-hex canonicalization (short/uppercase, in OxyPay's `social-receive.ts`) are applied at every entry point, not just the ones this plan's tests happened to cover; whether an attacker who learns a user's social-receive addresses (all public, on-chain) can derive anything about the private spending tree (should be impossible — different derivation roots, and `@oxyhq/core`'s `deriveScopedSeed` HKDF is one-way) or about future/past social indices beyond what the deterministic scheme already intentionally allows.
> 2. `packages/backend/src/services/socialReceive.ts` + `routes/social.ts` — confirm the backend NEVER handles a private key, the atomic reservation is race-free under real concurrent load (not just the test's `Promise.all`), and the `SocialReceiveCursor`/`SocialSendAttribution` collections have no IDOR (a caller can only create attribution rows for THEIR OWN sender identity, resolved server-side from the auth token, never client-supplied).
> 3. `packages/backend/src/services/enrichment.ts` — confirm a viewer can NEVER see a counterparty for an address they weren't the sender or recipient of (already unit-tested in Task 8, re-verify the query logic itself, not just the tests).
> 4. `packages/frontend/src/wallet/wallet-store.ts`'s Task 12 changes — confirm the raw identity private key (`socialReceiveIdentityPrivateKey`) is cleared on every teardown path (`resetWalletInternals`, confirmed lock/switch-wallet/wipe callers), never logged, never persisted to SQLite, and that `getSigningKeyForAddress`'s fallback cannot be tricked into signing with the identity-derived key for an address it doesn't actually own (re-derivation, not a lookup table an attacker could poison).
> 5. Confirm the residual risks already documented in spec §7 (unlocked device + app access → spend; lost device + lost recovery phrase → unrecoverable; `addr(0)` reuse by design) are the ONLY residual risks — flag anything this plan introduced beyond them.

- [x] **Step 3: Triage findings**

For each finding: CRITICAL/HIGH → block, do not ship to mainnet until fixed (open a follow-up task in a NEW plan or amend this one before execution completes); MEDIUM/LOW → judgment call, document the accepted risk in `~/Oxy/OxyPay/AGENTS.md` if deliberately deferred (never silently drop a finding).

- [x] **Step 4: Record the outcome**

Once the review is clean (or all CRITICAL/HIGH findings are fixed and re-verified), record it — a commit message, a note in `~/Oxy/OxyPay/AGENTS.md`, or a memory entry — stating explicitly: "social-receive derivation scheme security-reviewed on <date>, mainnet-eligible." Nothing in this plan or its dependents should ship to a mainnet-capable build before this line exists somewhere durable.
