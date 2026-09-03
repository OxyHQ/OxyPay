# Oxy Pay L2 — Shared Pockets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a group of Oxy users create an m-of-n shared FairCoin pocket (a P2SH multisig address whose cosigners are Oxy `@username`s), fund it, and spend from it by collecting end-to-end-encrypted partial signatures over the existing Oxy relay — with the OxyPay backend acting as a keyless metadata registry + message router that can never move funds.

**Architecture:** Each member derives a dedicated per-pocket cosigner keypair from their Oxy identity via the one-way `KeyManager.deriveScopedSeed` HKDF (mini-design `2026-07-19-l2-pocket-key-derivation.md`), shares only the compressed public key — self-attested with their identity key — to a backend metadata registry, and every device independently re-derives the redeem script from the **BIP67-sorted** cosigner set (a single shared `@fairco.in/core` helper, so the address is byte-identical everywhere). Spending reuses the testnet-proven L1 multisig path (`@fairco.in/core` + `FAIRWallet/src/wallet/multisig.ts`, ported into OxyPay): a proposer builds an unsigned single-input spend, distributes an E2E-encrypted signing request over a membership-scoped Socket.IO room, each cosigner decodes it against their OWN watched UTXO set (M2 anti-blind-signing) and returns an encrypted partial, and the **proposer's device** collects ≥m valid partials and finalizes locally, handing the backend only the finished raw transaction to broadcast. The backend holds no key material at any step.

**Tech Stack:** `@fairco.in/core@≥0.3.1` (`@noble/hashes`, `@noble/secp256k1`, `@scure/bip32` — all already dependencies; `bun:test`), `@oxyhq/core` (consumed as-is — `KeyManager.deriveScopedSeed`, `deriveSharedSecret`, `encryptAead`/`decryptAead`, `hkdfSha256`, `SignatureService`/identity signing, `resolveDid`, `getProfileByUsername`, `createOxyAuthMiddleware`/`getRequiredOxyUserId`, `authSocket` — zero L2 changes), OxyPay backend (Bun, Express, Mongoose, Socket.IO, Zod, `bun:test` + `mongodb-memory-server`), OxyPay frontend (Expo SDK 57 / RN 0.86, Zustand, expo-sqlite, `@tanstack/react-query`, Bloom, `bun:test`), `@oxypay/shared-types`.

## Global Constraints

- **Self-custody / MiCA firewall — no exception.** No backend surface accepts, stores, or can reconstruct a private key or a cosigner partial in plaintext. The backend is a keyless metadata registry + message router + broadcaster; it can cause grief/DoS, never theft (spec §6).
- **Keys never leave the device.** The per-pocket cosigner private key and the identity key touch memory only on-device, transiently, to derive/sign. Only compressed public keys, identity-signed attestations, opaque E2E ciphertexts, and finished raw transactions ever leave a device.
- **Key-derivation mini-design is a hard prerequisite.** Every cosigner-key derivation MUST follow `docs/superpowers/specs/2026-07-19-l2-pocket-key-derivation.md`. It requires a `security-reviewer` gate (Task 21) before mainnet, AND it inherits WS-S's **F-1** blocker via the shared identity-key source → **L2 is testnet-only until F-1 is fixed upstream in identity-vault v2.**
- **Canonical BIP67 sort is a fund-loss-class correctness requirement.** Every redeem script — on every device AND in the backend registry — is built from the cosigner pubkeys via the single shared `buildSortedMultisigRedeemScript` (Task 2). Getting the order wrong = silent divergent addresses = fund loss. Pinned as a regression vector.
- **Fix upstream, never patch the consumer; package boundary is load-bearing.** Generic secp256k1/multisig crypto lives ONCE in `@fairco.in/core` (published); identity-key ACCESS + ECDH/AEAD stay in `@oxyhq/core` (already shipped, platform-agnostic, MUST NOT import faircoin); only Oxy product glue lives in OxyPay. No divergent reimplementation of any primitive.
- **Publish before consume.** Republish `@fairco.in/core` (Task 2), verify propagation with a clean external install + import, THEN bump every consumer. Never `bun publish` from uncommitted state.
- **`@oxyhq/core` has NO task, NO publish gate, NO version bump in this plan.** If any step imports a NEW `@oxyhq/core` symbol, that is a plan bug — L2 uses only already-published surface (`deriveScopedSeed`, `deriveSharedSecret`, `encryptAead`/`decryptAead`, `hkdfSha256`, `SignatureService`, `resolveDid`, `getProfileByUsername`, `getUsersByIds`, `createOxyAuthMiddleware`, `getRequiredOxyUserId`, `authSocket`, `verifySecret`, `safeFetch`).
- **`@oxyhq/core/server` auth helpers only** — no app-local bearer parsers, no hand-rolled JWT decoding. Socket rooms derive from `socket.user.id`; ownership-check membership before every join (never trust a client-supplied pocket id as authorization).
- **Explicit field whitelist on every write** — never `new Model(req.body)`, never spread `req.body`. Mass-assignment = IDOR.
- **Unique rate-limit prefix per limiter** (`rl:<scope>:`). New limiters in this plan: `rl:pockets:write:`, `rl:pockets:read:`, `rl:pockets:relay:`, `rl:pockets:broadcast:`.
- **bun only.** `bun test`, `bunx`, never npm/npx. Regenerate + commit `bun.lock` in the SAME commit as any `package.json` bump.
- **No** `as any`, `@ts-ignore`/`@ts-expect-error`, `!` non-null assertions, `console.log`, silent `catch {}`, or TODO/FIXME/HACK. TypeScript strict.
- **M2 anti-blind-signing is a hard requirement, not optional copy.** The co-sign screen (Task 18) MUST decode the spend against the device's OWN confirmed UTXO set and require explicit user confirmation before the per-pocket key signs. This is where 100% of the real-money risk concentrates (L1 audit M2, spec §4.3, §6).
- **Verify runtime UI on a real foregrounded device/emulator** (Bloom/Reanimated/expo-router rules) before calling any frontend task done. Jest/tsc do NOT catch render/navigation/animation/layout bugs.

---

## Prerequisites & coordination (read before starting)

- **WS-S landed ✅** — identity-pubkey resolution (`resolveDid`/`resolveIdentityPublicKey`), the social recipient picker, and the gateway client patterns this plan reuses are code-complete (testnet-only). No L2 task re-implements them.
- **Key-derivation design (A) + its `security-reviewer` gate** — Task 9 implements the mini-design; Task 21 is the gate. Testnet derivation may proceed once the design is reviewed; mainnet is blocked on Task 21 AND F-1.
- **F-1 inherited** — L2 reads the identity key through the same source as WS-S, so it stays testnet-only until F-1 is fixed in identity-vault v2. Do NOT ship a mainnet L2 build against this plan alone.
- **Backend lands on the shared gateway branch — COORDINATE, do NOT edit in parallel.** The OxyPay backend work (Tasks 3–7) touches `packages/backend/src/server.ts` (router + socket wiring) and `packages/backend/src/realtime/socket.ts`, which the active gateway session (`feat/oxypay-fase2-gateway`, plan `2026-07-18-fase2-f20-gateway-gaps.md`) owns. Tasks that add NEW files (models, new route files, new service files) are safe to author in parallel; the two SHARED-FILE edits — mounting the pocket router in `server.ts` and adding the relay events in `socket.ts` — MUST be serialized with the gateway session (confirm sole ownership before writing; path-scope every `git add`). Each such task below is marked **[COORDINATE: shared backend file]**.

---

## File Structure

**Repo A — `~/faircoin-core` (`@fairco.in/core`, publish gate — coordinate with any concurrent `feat/multisig` bump):**
- Create: `src/multisig-cosigner.ts` — `deriveMultisigCosignerKeypair`, `buildSortedMultisigRedeemScript`.
- Modify: `src/index.ts` — export the two new symbols.
- Modify: `package.json` — version bump (no new deps; `@scure/bip32`/`@noble/hashes` already present).
- Test: `test/multisig-cosigner.test.ts`.

**`@oxyhq/core` (`~/Oxy/OxyHQServices`): NO CHANGES.** `deriveScopedSeed`, `deriveSharedSecret`, `encryptAead`/`decryptAead`, `hkdfSha256`, identity signing, and `resolveDid` are already published. This package must never import `@fairco.in/core`.

**Repo B — `~/Oxy/OxyPay/packages/shared-types`:**
- Create: `src/sharedPocket.ts` — `SharedPocketDTO`, `SharedPocketMemberDTO`, `SharedPocketStatus`, `CreateSharedPocketRequest`, `AttestPocketMemberRequest`, `SigningRequestEnvelope`, `PocketRelayMessage`, `PocketRelayMessageType`, `PocketBroadcastRequest`, `PocketBroadcastResponse`, `POCKET_RELAY_EVENTS`.
- Modify: `src/index.ts` — export the new module.
- Test: `src/__tests__/sharedPocket.test.ts`.

**Repo B — `~/Oxy/OxyPay/packages/backend`:**
- Create: `src/models/SharedPocket.ts`, `src/models/SharedPocketMember.ts`, `src/models/PocketRelayEnvelope.ts`.
- Create: `src/services/sharedPocket.ts` — registry: `createPocketRegistryEntry`, `attestPocketMember`, `listPocketsForUser`, `getPocketForMember`, `assertPocketMember`, `computeRegistryAddress`.
- Create: `src/services/pocketRelay.ts` — `enqueueRelayEnvelope`, `drainRelayInbox`, `pocketRoom`.
- Create: `src/routes/pockets.ts` — `createPocketsRouter`.
- Modify: `src/realtime/socket.ts` — add membership-scoped pocket relay events. **[COORDINATE: shared backend file]**
- Modify: `src/server.ts` — mount `createPocketsRouter`, extend `GatewayDeps`, pass relay deps to `initSocket`. **[COORDINATE: shared backend file]**
- Tests: `src/services/__tests__/sharedPocket.test.ts`, `src/services/__tests__/pocketRelay.test.ts`, `src/routes/__tests__/pockets.test.ts`, `src/realtime/__tests__/pocketRelay.socket.test.ts`.

**Repo B — `~/Oxy/OxyPay/packages/frontend`:**
- Create: `src/wallet/multisig.ts` — ported from `FAIRWallet/src/wallet/multisig.ts` (L1 spend path over OxyPay's `Database`/`KeyManager`).
- Create: `src/wallet/pocket-cosigner-key.ts` — `derivePocketCosignerKeypair`, `signPocketMemberAttestation`, `verifyPocketMemberAttestation`, `identityPubkeyFingerprint`.
- Create: `src/wallet/shared-pocket.ts` — `buildSharedPocketAddress`, `verifySharedPocketAddress`, `registerSharedPocketWatch`, `SharedPocketDescriptor`.
- Modify: `src/storage/database.ts` — `shared_pockets` + `shared_pocket_members` + `pocket_relay_inbox` tables + methods.
- Create: `src/services/pocket-relay.ts` — `encryptRelayMessage`, `decryptRelayMessage`, `publishSigningRequest`, `subscribePocketRelay`, `drainPocketInbox`.
- Create: `src/services/gateway-pockets.ts` — `createSharedPocket`, `attestMembership`, `listSharedPockets`, `getSharedPocket`, `broadcastPocketSpend`, `KeylessMemberError`.
- Modify: `src/wallet/wallet-store.ts` — shared-pocket watch registration + per-pocket UTXO view + `inputValuesForRequest`.
- Create: `src/ui/sheets/CreateSharedPocketSheet.tsx`, `src/ui/sheets/PocketInviteSheet.tsx`, `src/ui/sheets/ProposeSpendSheet.tsx`, `src/ui/sheets/CoSignSheet.tsx`.
- Create: `src/ui/components/SharedPocketCard.tsx`, `src/ui/components/CoSignSummary.tsx`, `src/ui/components/PendingCoSignBanner.tsx`.
- Create: `src/hooks/useSharedPockets.ts`, `src/hooks/usePocketRelay.ts`, `src/hooks/usePendingCoSigns.ts`.
- Modify: `app/(tabs)/index.tsx` — surface shared pockets + the pending co-sign banner.
- Modify: `app/_layout.tsx` — start the relay/inbox drain on authenticated boot.
- Create: `app/pockets/shared/[id].tsx` — shared-pocket detail (balance, members, fund, propose, activity).
- Tests: colocated `*.test.ts` for every non-UI module.

**Cross-repo / cross-task gates:**
- Task 2 (`@fairco.in/core` publish) blocks any task importing the new derivation/sort symbols: Task 9, Task 10 (transitively via Task 9), and the backend registry's address computation (Task 4).
- Task 1 (shared-types) blocks every backend + frontend task that imports a pocket DTO — do it first.
- Backend Tasks 3–7 are independent of the frontend and can run in parallel with frontend Tasks 8–11, EXCEPT the two `[COORDINATE]` shared-file edits (Tasks 5, 6) which serialize with the gateway session.
- Frontend UI Tasks 14–20 depend on the service/derivation layer (Tasks 8–13) and on the backend routes (Tasks 4–7) being reachable for end-to-end verification.
- Task 21 (security-reviewer gate) is BLOCKED on everything.

---

## Task 1: shared-types — Shared Pocket + relay contracts

**Files:**
- Create: `~/Oxy/OxyPay/packages/shared-types/src/sharedPocket.ts`
- Modify: `~/Oxy/OxyPay/packages/shared-types/src/index.ts`
- Test: `~/Oxy/OxyPay/packages/shared-types/src/__tests__/sharedPocket.test.ts`

**Interfaces:**
- Consumes: `NetworkType` from `@fairco.in/core` (already used by `SocialSendAttribution` etc.).
- Produces (consumed by backend + frontend; signatures are load-bearing, do not rename):
  - `type SharedPocketStatus = 'pending' | 'active'` — `pending` until all invited members have attested + confirmed the address; `active` thereafter.
  - `type PocketRelayMessageType = 'signing_request' | 'partial'`.
  - `interface SharedPocketMemberDTO { userId: string; cosignerPubHex: string; attestationSig: string; confirmed: boolean }`
  - `interface SharedPocketDTO { id: string; network: NetworkType; threshold: number; memberCount: number; address: string; redeemScriptHex: string; status: SharedPocketStatus; members: SharedPocketMemberDTO[]; createdByUserId: string; createdAt: string; expiresAt: string | null }`
  - `interface CreateSharedPocketRequest { network: NetworkType; threshold: number; members: { userId: string; cosignerPubHex: string; attestationSig: string }[]; address: string; redeemScriptHex: string }` — the creator submits the metadata (sorted set + m); the backend re-derives `address` from `members[].cosignerPubHex` and REJECTS on mismatch (Task 4).
  - `interface AttestPocketMemberRequest { cosignerPubHex: string; attestationSig: string; confirmedAddress: string }` — a member's own attestation + the address their device independently derived (must equal the stored `address`).
  - `interface SigningRequestEnvelope { requestId: string; pocketId: string; proposerUserId: string; txHex: string; inputIndex: number; redeemScriptHex: string; createdAt: string; expiresAt: string }` — the PLAINTEXT signing-request payload (this is what gets E2E-encrypted before it touches the relay; the backend never sees it decrypted). Mirrors `SerializedMultisigSigningRequest` + routing/expiry.
  - `interface PocketRelayMessage { pocketId: string; requestId: string; type: PocketRelayMessageType; fromUserId: string; toUserId: string; nonceB64: string; ciphertextB64: string; aadB64: string }` — the opaque wire envelope the relay routes. The backend sees ONLY these fields; `ciphertextB64` is never decryptable by it.
  - `interface PocketBroadcastRequest { pocketId: string; requestId: string; rawTxHex: string }`
  - `interface PocketBroadcastResponse { txid: string }`
  - `const POCKET_RELAY_EVENTS = { subscribe: 'pocket.subscribe', message: 'pocket.message', inboxDrained: 'pocket.inbox_drained' } as const` — the Socket.IO event names, shared by backend + frontend so neither hard-codes a string.

- [ ] **Step 1: Write the failing shape test**

Create `sharedPocket.test.ts` asserting the contract is structural-only (no runtime logic) and that a representative `PocketRelayMessage` round-trips through `JSON.parse(JSON.stringify(x))` unchanged, and that `POCKET_RELAY_EVENTS` values are the exact literals above.

```ts
import { describe, test, expect } from 'bun:test';
import { POCKET_RELAY_EVENTS, type PocketRelayMessage } from '../sharedPocket';

describe('sharedPocket contracts', () => {
  test('relay event names are stable literals', () => {
    expect(POCKET_RELAY_EVENTS).toEqual({
      subscribe: 'pocket.subscribe',
      message: 'pocket.message',
      inboxDrained: 'pocket.inbox_drained',
    });
  });

  test('PocketRelayMessage is JSON-stable (opaque wire envelope)', () => {
    const msg: PocketRelayMessage = {
      pocketId: 'p1', requestId: 'r1', type: 'partial',
      fromUserId: 'u1', toUserId: 'u2',
      nonceB64: 'AAAA', ciphertextB64: 'BBBB', aadB64: 'CCCC',
    };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd ~/Oxy/OxyPay/packages/shared-types && bun test src/__tests__/sharedPocket.test.ts` → FAIL (`Cannot find module '../sharedPocket'`).

- [ ] **Step 3: Write `src/sharedPocket.ts`** with exactly the interfaces + const in the Interfaces block above (all `export`; `POCKET_RELAY_EVENTS` `as const`).

- [ ] **Step 4: Export from `src/index.ts`** — add `export * from './sharedPocket';`.

- [ ] **Step 5: Run test + typecheck** — `bun test src/__tests__/sharedPocket.test.ts` → PASS; `bun run build` (tsc) → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/sharedPocket.ts packages/shared-types/src/index.ts packages/shared-types/src/__tests__/sharedPocket.test.ts
git commit -m "feat(shared-types): add Shared Pocket + E2E relay contracts"
```

---

## Task 2: `@fairco.in/core` — cosigner-key + sorted-redeem-script helpers (PUBLISH GATE)

Adds the two tiny generic-secp256k1 helpers the mini-design specifies (§3). Lands in `~/faircoin-core` (zero Oxy dependency). Coordinate the version bump with any concurrent `feat/multisig` work in that repo (single combined bump if both are in flight).

**Files:**
- Create: `~/faircoin-core/src/multisig-cosigner.ts`
- Modify: `~/faircoin-core/src/index.ts`
- Modify: `~/faircoin-core/package.json` (version bump only)
- Test: `~/faircoin-core/test/multisig-cosigner.test.ts`

**Interfaces:**
- Consumes: `HDKey` (`@scure/bip32`), `createMultisigRedeemScript`, `bytesToHex` (this package).
- Produces:
  - `deriveMultisigCosignerKeypair(seed: Uint8Array): { privateKey: Uint8Array; publicKey: Uint8Array }` — `HDKey.fromMasterSeed(seed)`; `publicKey` is the canonical 33-byte compressed encoding, `privateKey` is 32 bytes. Throws if `@scure/bip32` yields a neutered/invalid node.
  - `buildSortedMultisigRedeemScript(m: number, pubkeys: Uint8Array[]): Uint8Array` — BIP67-sorts `pubkeys` (ascending unsigned-byte comparison of each compressed encoding) then calls `createMultisigRedeemScript(m, sorted)`. The SINGLE source of truth for cosigner ordering across every consumer.

- [ ] **Step 1: Write the failing tests (property-based — do NOT hand-fabricate hex)**

The correctness properties that matter are determinism, order-independence, and round-trip — none require a magic constant. (Pin an actual hex vector only after implementing, by asserting the computed value equals itself across two calls; see Step 4.)

```ts
import { describe, test, expect } from 'bun:test';
import { bytesToHex, parseMultisigRedeemScript } from '../src/index.js';
import {
  deriveMultisigCosignerKeypair,
  buildSortedMultisigRedeemScript,
} from '../src/multisig-cosigner.js';

describe('deriveMultisigCosignerKeypair', () => {
  test('is deterministic and returns a 32B priv + 33B compressed pub', () => {
    const seed = new Uint8Array(32).fill(7);
    const a = deriveMultisigCosignerKeypair(seed);
    const b = deriveMultisigCosignerKeypair(seed);
    expect(a.privateKey.length).toBe(32);
    expect(a.publicKey.length).toBe(33);
    expect([0x02, 0x03]).toContain(a.publicKey[0]); // compressed prefix
    expect(bytesToHex(a.publicKey)).toBe(bytesToHex(b.publicKey));
  });

  test('different seeds give unlinkable (different) pubkeys', () => {
    const p = deriveMultisigCosignerKeypair(new Uint8Array(32).fill(1)).publicKey;
    const q = deriveMultisigCosignerKeypair(new Uint8Array(32).fill(2)).publicKey;
    expect(bytesToHex(p)).not.toBe(bytesToHex(q));
  });
});

describe('buildSortedMultisigRedeemScript (BIP67)', () => {
  const k = (fill: number) => deriveMultisigCosignerKeypair(new Uint8Array(32).fill(fill)).publicKey;

  test('is order-independent: any input permutation yields the identical script', () => {
    const a = k(11), b = k(22), c = k(33);
    const s1 = buildSortedMultisigRedeemScript(2, [a, b, c]);
    const s2 = buildSortedMultisigRedeemScript(2, [c, a, b]);
    const s3 = buildSortedMultisigRedeemScript(2, [b, c, a]);
    expect(bytesToHex(s1)).toBe(bytesToHex(s2));
    expect(bytesToHex(s1)).toBe(bytesToHex(s3));
  });

  test('emits pubkeys in ascending compressed-byte (hex) order', () => {
    const a = k(11), b = k(22), c = k(33);
    const { pubkeys } = parseMultisigRedeemScript(buildSortedMultisigRedeemScript(2, [c, a, b]));
    const hexes = pubkeys.map(bytesToHex);
    expect([...hexes]).toEqual([...hexes].sort());
  });
});
```

- [ ] **Step 2: Run, verify fail** — `cd ~/faircoin-core && bun test test/multisig-cosigner.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/multisig-cosigner.ts`**

```ts
/**
 * Per-pocket multisig cosigner-key derivation + canonical (BIP67) redeem-script
 * assembly. Generic secp256k1 — no Oxy/DID dependency. `deriveMultisigCosignerKeypair`
 * expands a 32-byte domain-separated seed (Oxy Pay sources it from
 * `KeyManager.deriveScopedSeed`, but this module has no knowledge of that) into a
 * cosigner keypair; `buildSortedMultisigRedeemScript` is the SINGLE ordering
 * authority so every cosigner device and the backend derive the byte-identical
 * address (see the L2 key-derivation mini-design §2.4).
 */
import { HDKey } from '@scure/bip32';
import { bytesToHex } from './encoding.js';
import { createMultisigRedeemScript } from './multisig-script.js';

export function deriveMultisigCosignerKeypair(
  seed: Uint8Array,
): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const node = HDKey.fromMasterSeed(seed);
  if (!node.privateKey || !node.publicKey) {
    throw new Error('deriveMultisigCosignerKeypair: seed produced a neutered/invalid node');
  }
  // `@scure/bip32` publicKey is already the canonical 33-byte compressed encoding.
  return { privateKey: node.privateKey, publicKey: node.publicKey };
}

/**
 * BIP67: sort the compressed cosigner pubkeys ascending as unsigned byte
 * sequences (equivalently hex-ascending), then build the redeem script. Pure
 * function of {m, pubkey set} — no tiebreaker is needed because pubkeys are
 * unique. Callers MUST route every redeem-script build through here so no two
 * parties ever order the set differently (silent fund-loss vector).
 */
export function buildSortedMultisigRedeemScript(m: number, pubkeys: Uint8Array[]): Uint8Array {
  const sorted = [...pubkeys].sort((a, b) => (bytesToHex(a) < bytesToHex(b) ? -1 : bytesToHex(a) > bytesToHex(b) ? 1 : 0));
  return createMultisigRedeemScript(m, sorted);
}
```

- [ ] **Step 4: Export + pin a self-consistency vector** — add both symbols to `src/index.ts`. Append to the test a determinism-pin: compute `buildSortedMultisigRedeemScript(2, [k(11),k(22),k(33)])` once, store its hex in a `const EXPECTED`, and assert equality on a second call — this locks the algorithm against an accidental future change without fabricating a constant (the value is whatever the real crypto produces; capture it from the passing test run).

- [ ] **Step 5: Run tests + typecheck** — `bun test test/multisig-cosigner.test.ts` → PASS; `bun run typecheck` → clean.

- [ ] **Step 6: Commit, publish, verify propagation** — follow the `publish` skill discipline: bump `package.json`, `bun install`, commit + push to `main` FIRST, `bun pm pack` and inspect the tarball (new file present, `workspace:*` if any resolve), then `bun publish`. Verify with a clean external `bun add @fairco.in/core@<new>` + `import('@fairco.in/core')` in a scratch dir resolving both new symbols. Only then bump the OxyPay consumers' dependency (a later task's `bun.lock` change).

```bash
git add src/multisig-cosigner.ts src/index.ts package.json test/multisig-cosigner.test.ts bun.lock
git commit -m "feat: per-pocket cosigner-key + BIP67 sorted redeem-script helpers"
```

---

## Task 3: Backend — Shared Pocket registry + relay-inbox models

**Files:**
- Create: `~/Oxy/OxyPay/packages/backend/src/models/SharedPocket.ts`
- Create: `~/Oxy/OxyPay/packages/backend/src/models/SharedPocketMember.ts`
- Create: `~/Oxy/OxyPay/packages/backend/src/models/PocketRelayEnvelope.ts`
- Test: `~/Oxy/OxyPay/packages/backend/src/models/__tests__/sharedPocketModels.test.ts`

**Interfaces:**
- Produces (Mongoose models; documents mirror the DTOs from Task 1 minus server-only fields):
  - `SharedPocket` doc: `{ id: string (unique), network, threshold, memberCount, address, redeemScriptHex, status, createdByUserId, expiresAt?: Date }` + `timestamps`. **No key material** — `redeemScriptHex`/`address` are metadata (hints), re-derivable and re-verified by every device (Decision 2).
  - `SharedPocketMember` doc: `{ pocketId, userId, network, cosignerPubHex, attestationSig, confirmed: boolean }` + `timestamps`; unique index `(pocketId, userId)`.
  - `PocketRelayEnvelope` doc: `{ pocketId, requestId, type, fromUserId, toUserId, nonceB64, ciphertextB64, aadB64, expiresAt: Date }` + `timestamps`; TTL index on `expiresAt` (Decision 9 expiry). Opaque blobs only — the backend can never decrypt `ciphertextB64`.

- [ ] **Step 1: Write the failing model test** (using `mongodb-memory-server`, the existing backend test harness): assert the unique `(pocketId, userId)` index rejects a duplicate member insert, and that `PocketRelayEnvelope` has a TTL index on `expiresAt`.

```ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { SharedPocketMember } from '../SharedPocketMember';
import { PocketRelayEnvelope } from '../PocketRelayEnvelope';

let mongo: MongoMemoryServer;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('member (pocketId,userId) is unique', async () => {
  await SharedPocketMember.syncIndexes();
  const base = { pocketId: 'p1', userId: 'u1', network: 'testnet', cosignerPubHex: '02aa', attestationSig: 'sig', confirmed: false };
  await SharedPocketMember.create(base);
  await expect(SharedPocketMember.create(base)).rejects.toThrow();
});

test('relay envelope has a TTL index on expiresAt', async () => {
  await PocketRelayEnvelope.syncIndexes();
  const idx = await PocketRelayEnvelope.collection.indexes();
  expect(idx.some((i) => i.key?.expiresAt === 1 && typeof i.expireAfterSeconds === 'number')).toBe(true);
});
```

- [ ] **Step 2: Run, verify fail.** `cd ~/Oxy/OxyPay/packages/backend && bun test src/models/__tests__/sharedPocketModels.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement the three models** — Mongoose schemas matching the Interfaces block; `network` enum `['mainnet','testnet']`; `status` enum `['pending','active']`; `type` enum `['signing_request','partial']`; `SharedPocketMemberSchema.index({ pocketId: 1, userId: 1 }, { unique: true })`; `PocketRelayEnvelopeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })`. Follow the existing `SocialSendAttribution.ts` / `PaymentIntent.ts` model style (typed `interface ...Doc`, `Schema<...Doc>`, `model<...Doc>(...)`).

- [ ] **Step 4: Run test + tsc.** → PASS; `bun run build` clean.

- [ ] **Step 5: Commit** — `git add packages/backend/src/models/SharedPocket.ts packages/backend/src/models/SharedPocketMember.ts packages/backend/src/models/PocketRelayEnvelope.ts packages/backend/src/models/__tests__/sharedPocketModels.test.ts` + commit `feat(backend): Shared Pocket registry + relay-inbox models`.

---

## Task 4: Backend — keyless registry service (create / attest / list / verify)

The metadata-registry brain (Decision 2). Every mutation re-derives the address from the submitted cosigner pubkeys via the SAME `buildSortedMultisigRedeemScript` the devices use (Task 2), so a registry entry that does not re-derive is rejected — the backend is never a source of cryptographic truth, only a consistency-checked hint store.

**Files:**
- Create: `~/Oxy/OxyPay/packages/backend/src/services/sharedPocket.ts`
- Test: `~/Oxy/OxyPay/packages/backend/src/services/__tests__/sharedPocket.test.ts`

**Interfaces:**
- Consumes: `getNetwork`, `hexToBytes`, `buildSortedMultisigRedeemScript`, `multisigAddress` (`@fairco.in/core@<Task 2>`); `SharedPocket`/`SharedPocketMember` (Task 3); `CreateSharedPocketRequest`/`SharedPocketDTO` etc. (Task 1); `newId` (`lib/ids.ts`).
- Produces:
  - `computeRegistryAddress(members: {cosignerPubHex: string}[], threshold: number, network: NetworkType): string` — the backend's OWN sorted-address computation; throws on invalid pubkey/threshold.
  - `createPocketRegistryEntry(input: CreateSharedPocketRequest, createdByUserId: string): Promise<SharedPocketDTO>` — validates `threshold ∈ [1, members.length]`; recomputes `computeRegistryAddress(...)` and REJECTS (`PocketAddressMismatchError`) if it ≠ `input.address`; persists the `SharedPocket` (`status:'pending'`, `id = newId('pocket')`) + one `SharedPocketMember` per member (`confirmed:false`); does NOT store any key. Returns the DTO.
  - `attestPocketMember(pocketId, userId, req: AttestPocketMemberRequest): Promise<SharedPocketDTO>` — asserts the caller is an invited member; verifies `req.confirmedAddress === pocket.address` (device independently agreed on the address, §2.5) else `PocketAddressMismatchError`; sets that member `confirmed:true` (+ persists their `cosignerPubHex`/`attestationSig` if not already); flips `status:'active'` once ALL members are confirmed.
  - `listPocketsForUser(userId, network): Promise<SharedPocketDTO[]>` — pockets the user is a member of (reinstall recovery + discovery).
  - `getPocketForMember(pocketId, userId): Promise<SharedPocketDTO | null>` — null if the user is not a member (no membership leak).
  - `assertPocketMember(pocketId, userId): Promise<void>` — throws `NotPocketMemberError` if not a confirmed-or-invited member (used by routes + relay auth).
  - Error classes: `PocketAddressMismatchError`, `NotPocketMemberError`, `PocketValidationError`.

> **Note — attestation signature verification.** The backend stores each member's identity-signed `attestationSig` but does NOT itself verify it against the member's DID (that is every peer DEVICE's job, §2.3/§2.5 — the security model treats the backend as untrusted). The backend's ONE cryptographic check is the address re-derivation (`computeRegistryAddress`), which is what makes a substituted pubkey produce a different address and thus fail a device's confirmation. Keep the backend keyless and verification-light on purpose; do not add server-side signature trust that devices would then be tempted to rely on.

- [ ] **Step 1: Write the failing service test** — cover: (a) create with a correct `address` succeeds and stores N members `confirmed:false`; (b) create with a tampered `address` throws `PocketAddressMismatchError`; (c) `attestPocketMember` with a mismatched `confirmedAddress` throws; (d) status flips to `active` only after the last member attests; (e) `getPocketForMember` returns null for a non-member; (f) `computeRegistryAddress` is permutation-independent (same address regardless of `members` order in the request — because it goes through the BIP67 sort).

```ts
test('computeRegistryAddress is permutation-independent', () => {
  const a = { cosignerPubHex: pubHexA }, b = { cosignerPubHex: pubHexB }, c = { cosignerPubHex: pubHexC };
  expect(computeRegistryAddress([a, b, c], 2, 'testnet'))
    .toBe(computeRegistryAddress([c, a, b], 2, 'testnet'));
});
test('create rejects a tampered address', async () => {
  await expect(createPocketRegistryEntry({ ...validReq, address: 'ftamperedaddr' }, 'u1'))
    .rejects.toBeInstanceOf(PocketAddressMismatchError);
});
```

(Derive `pubHexA/B/C` in the test from `deriveMultisigCosignerKeypair(seed)` so they are real compressed keys; compute `validReq.address` with `computeRegistryAddress` itself so the happy path is self-consistent.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `services/sharedPocket.ts`** per the Interfaces block. `computeRegistryAddress` = `multisigAddress(buildSortedMultisigRedeemScript(threshold, members.map(m => hexToBytes(m.cosignerPubHex))), getNetwork(network))`. Follow the atomic-write + duplicate-key patterns from `services/socialReceive.ts`.

- [ ] **Step 4: Run test + tsc.** → PASS; clean.

- [ ] **Step 5: Commit** — `feat(backend): keyless Shared Pocket registry service`.

---

## Task 5: Backend — pockets REST routes **[COORDINATE: shared backend file `server.ts`]**

**Files:**
- Create: `~/Oxy/OxyPay/packages/backend/src/routes/pockets.ts`
- Modify: `~/Oxy/OxyPay/packages/backend/src/server.ts` (mount router + extend `GatewayDeps`) — **confirm sole ownership with the gateway session; path-scope the `git add`.**
- Test: `~/Oxy/OxyPay/packages/backend/src/routes/__tests__/pockets.test.ts`

**Interfaces:**
- Consumes: `createPocketRegistryEntry`/`attestPocketMember`/`listPocketsForUser`/`getPocketForMember` (Task 4); `requireOxyUser` (the same auth dep `createSocialRouter`/`createEnrichRouter` already receive — `server.ts:225`); `getRequiredOxyUserId` (`@oxyhq/core/server`); Zod schemas for the request bodies.
- Produces: `createPocketsRouter({ requireOxyUser }): Router` exposing:
  - `POST /v1/pockets` (auth, `rl:pockets:write:`) → body `CreateSharedPocketRequest`, `createdByUserId = getRequiredOxyUserId(req)` (server-resolved, never from the body) → 201 `SharedPocketDTO`. Maps `PocketAddressMismatchError`/`PocketValidationError` → 400.
  - `POST /v1/pockets/:id/attest` (auth, `rl:pockets:write:`) → body `AttestPocketMemberRequest`, userId server-resolved → `SharedPocketDTO`. `NotPocketMemberError` → 403.
  - `GET /v1/pockets?network=` (auth, `rl:pockets:read:`) → `SharedPocketDTO[]` for the caller.
  - `GET /v1/pockets/:id` (auth, `rl:pockets:read:`) → `SharedPocketDTO` or 404 (also 404 for a non-member — no membership existence leak).

- [ ] **Step 1: Write the failing route test** — supertest against a router mounted with a stub `requireOxyUser` that injects a fixed userId (mirror `routes/__tests__/social.test.ts`): create → 201; attest by a non-member → 403; `GET /v1/pockets/:id` by a non-member → 404; missing/invalid body → 400. Assert the default (real-auth) path is 401 when no identity is injected.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `routes/pockets.ts`** — Zod-validate each body with an explicit field whitelist (never spread `req.body`); resolve userId via `getRequiredOxyUserId`; wrap handlers in the existing `asyncHandler`/error-to-status pattern from `routes/social.ts`.

- [ ] **Step 4: Wire into `server.ts`** — add `pocketsWriteRateLimit`/`pocketsReadRateLimit` (unique prefixes), `app.use(createPocketsRouter({ requireOxyUser: deps.requireOxyUser }))`, and extend `GatewayDeps` if a new dep is needed. **Before editing: message the gateway session, confirm `server.ts` is not mid-edit; `git add packages/backend/src/server.ts` only.**

- [ ] **Step 5: Run backend suite + tsc** — `bun test` (whole backend suite, order-independent) + `bun run build` → clean.

- [ ] **Step 6: Commit** — `feat(backend): Shared Pocket REST routes (create/attest/list/get)`.

---

## Task 6: Backend — E2E relay (membership-scoped socket room + durable inbox) **[COORDINATE: shared backend files `socket.ts`, `server.ts`]**

The one genuinely new backend capability: routing opaque E2E-encrypted signing requests + partials between member devices (Decision 5, 10), with a durable inbox for offline cosigners (Decision 9). The backend NEVER decrypts.

**Files:**
- Create: `~/Oxy/OxyPay/packages/backend/src/services/pocketRelay.ts`
- Modify: `~/Oxy/OxyPay/packages/backend/src/realtime/socket.ts` (add pocket events) — **[COORDINATE]**
- Modify: `~/Oxy/OxyPay/packages/backend/src/server.ts` (pass relay deps to `initSocket`) — **[COORDINATE]**
- Tests: `~/Oxy/OxyPay/packages/backend/src/services/__tests__/pocketRelay.test.ts`, `src/realtime/__tests__/pocketRelay.socket.test.ts`

**Interfaces:**
- Consumes: `PocketRelayEnvelope` (Task 3); `assertPocketMember` (Task 4); `PocketRelayMessage`/`POCKET_RELAY_EVENTS` (Task 1).
- Produces:
  - `pocketRoom(pocketId: string): string` → `pocket:${pocketId}`.
  - `enqueueRelayEnvelope(msg: PocketRelayMessage, expiresAt: Date): Promise<void>` — persists the opaque envelope for offline delivery.
  - `drainRelayInbox(pocketId: string, userId: string): Promise<PocketRelayMessage[]>` — returns + deletes envelopes addressed to `toUserId === userId` for that pocket (delivered-once semantics).
  - Socket wiring in `initSocket`: on `POCKET_RELAY_EVENTS.subscribe` `{pocketId}` — REQUIRE `socket.user?.id` (reject anonymous), `assertPocketMember(pocketId, socket.user.id)` (ownership check), then `socket.join(pocketRoom(pocketId))` and immediately `drainRelayInbox` → emit each as `POCKET_RELAY_EVENTS.message` to that socket, then `inboxDrained` ack. On `POCKET_RELAY_EVENTS.message` `PocketRelayMessage` from a member — assert the sender is a member AND `msg.fromUserId === socket.user.id` (no spoofing), then relay: emit to the room (online delivery) AND `enqueueRelayEnvelope` (offline durability); the intended recipient's device dedupes by `requestId`+`type`+`fromUserId`.

> **Auth boundary:** the existing connection is identity-OPTIONAL (`optionalSocketAuth`, for anonymous checkout payers). The pocket relay events therefore MUST individually assert `socket.user?.id` and membership — exactly as the existing code's doc comment warns ("if a future event needs to be identity/merchant-scoped, it must check `socket.user` itself"). Rooms derive from the server-resolved `socket.user.id` + registry membership, NEVER from a client-supplied member list. Reuse the existing `FixedWindowLimiter` for `rl:pockets:relay:` per-socket message throttling.

- [ ] **Step 1: Write the failing service test** — `enqueueRelayEnvelope` then `drainRelayInbox` returns it once and empties (second drain returns `[]`); a drain for a different `userId` returns `[]`.

- [ ] **Step 2: Write the failing socket test** — using an in-process `socket.io` server + client (mirror the harness `initSocket` tests use, injecting a stub `socketAuth` that sets `socket.user`): a non-member `subscribe` is rejected; a member `subscribe` joins + drains; a `message` with `fromUserId !== socket.user.id` is dropped; a valid `message` reaches a second member's socket in the room.

- [ ] **Step 3: Run both, verify fail.**

- [ ] **Step 4: Implement `services/pocketRelay.ts` + the socket events.** Keep envelopes opaque — never parse `ciphertextB64`. **Before editing `socket.ts`/`server.ts`: confirm sole ownership with the gateway session; path-scope each `git add`.**

- [ ] **Step 5: Run backend suite + tsc** → clean.

- [ ] **Step 6: Commit** — `feat(backend): keyless E2E pocket relay (socket room + durable inbox)`.

---

## Task 7: Backend — broadcast a finished shared-pocket transaction

The proposer's device finalizes locally (frontend Task 19) and hands the backend ONLY the fully-signed raw tx to broadcast (spec §4.6). The backend reuses its existing broadcast path; it never sees a key or a partial.

**Files:**
- Modify: `~/Oxy/OxyPay/packages/backend/src/routes/pockets.ts` (add the broadcast route)
- Modify (if needed): `~/Oxy/OxyPay/packages/backend/src/services/explorer.ts` (reuse/extend the existing broadcast helper)
- Test: extend `src/routes/__tests__/pockets.test.ts`

**Interfaces:**
- Consumes: `assertPocketMember` (Task 4); the existing server-side broadcast (the same path single-user sends already use — `services/explorer.ts` / `SPVClient.broadcastTransaction` equivalent); `PocketBroadcastRequest`/`PocketBroadcastResponse` (Task 1).
- Produces: `POST /v1/pockets/:id/broadcast` (auth, `rl:pockets:broadcast:`) → body `PocketBroadcastRequest`, caller must be a member (`assertPocketMember`) → broadcasts `rawTxHex` → 200 `{ txid }`. The tx is already fully signed and about to be public, so this leaks nothing beyond broadcasting itself (spec §4.6). Validates `rawTxHex` is hex + non-empty; maps a broadcast/explorer failure to a 502 with a clean error (never a silent `catch {}`).

- [ ] **Step 1: Write the failing route test** — a member broadcast calls the (stubbed) broadcaster with the raw hex and returns its txid; a non-member → 403; a broadcaster failure → 502.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the route** reusing the existing broadcast helper; add `rl:pockets:broadcast:`.

- [ ] **Step 4: Run backend suite + tsc** → clean.

- [ ] **Step 5: Commit** — `feat(backend): broadcast finished shared-pocket transactions`.

---

## Task 8: Frontend — port the L1 multisig spend path into OxyPay

`FAIRWallet/src/wallet/multisig.ts` (watch registration + `buildMultisigSendDraft`/`exportSigningRequest`/`decodeMultisigSpend`/`signMultisigSendRequest`/`finalizeMultisigSend`) is the testnet-proven L1 path but is not yet in OxyPay's `src/wallet/`. Bring it in the SAME way WS-P Pockets was pulled (subtree/adapt), retargeting its `Database`/`KeyManager` imports to OxyPay's own (`src/storage/database.ts`, `src/wallet/key-manager.ts`). This is a near-verbatim port — do NOT re-derive the crypto.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/wallet/multisig.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/multisig.test.ts`

**Interfaces:**
- Consumes: `@fairco.in/core` multisig primitives (already a dependency); OxyPay `Database`, `KeyManager`.
- Produces (re-exported for later tasks; identical signatures to FAIRWallet's): `registerMultisigWatchAddress`, `loadWatchAddressesIntoKeyManager`, `buildMultisigSendDraft`, `exportSigningRequest`, `decodeMultisigSpend`, `signMultisigSendRequest`, `finalizeMultisigSend`, and the `MultisigSendDraft`/`MultisigSpendSummary`/`SignedMultisigPartial` types.

- [ ] **Step 1: Copy `FAIRWallet/src/wallet/multisig.ts` → OxyPay** and adjust ONLY the two local imports (`../storage/database`, `./key-manager`) to OxyPay's paths. **Verified gap (do not skip):** OxyPay's `Database` does NOT yet expose `insertWatchAddress`/`getWatchAddresses`, nor `KeyManager.registerWatchAddress` — these exist in FAIRWallet (`src/storage/database.ts:819,835`; `src/wallet/key-manager.ts:345`) but were not part of the WS-P/WS-S subtree pulls. Port the watch-address table + the three methods VERBATIM from FAIRWallet (a `watch_addresses(address PK, redeem_script_hex, label)` table via a new migration in `database.ts`, and the in-memory `registerWatchAddress`/registered-set on `KeyManager`) as part of this task — matching FAIRWallet's contract byte-for-byte so the ported `multisig.ts` needs no signature changes.

- [ ] **Step 2: Write a port-parity test** — `decodeMultisigSpend` throws on a wrong `inputValues` length; `finalizeMultisigSend` throws on a multi-input draft; a round-trip `buildMultisigSendDraft → exportSigningRequest → decodeMultisigSpend` yields the expected `{outputs, fee, inputCount}` for a hand-built single-input draft. (Reuse the assertions from FAIRWallet's own multisig tests.)

- [ ] **Step 3: Run + tsc** → PASS; clean.

- [ ] **Step 4: Commit** — `feat(oxypay): port L1 multisig spend path from FAIRWallet`.

---

## Task 9: Frontend — per-pocket cosigner key derivation + identity attestation

Implements the mini-design §2.2–§2.3. Kept as a pure, directly-unit-testable module (no SQLite/SPV), mirroring how `src/wallet/social-receive.ts` isolates its derivation math.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/wallet/pocket-cosigner-key.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/pocket-cosigner-key.test.ts`

**Interfaces:**
- Consumes: `KeyManager.deriveScopedSeed` (`@oxyhq/core`, already published); `deriveMultisigCosignerKeypair` (`@fairco.in/core@<Task 2>`); `SignatureService`/`KeyManager` identity signing + `resolveDid`-derived pubkey verify (`@oxyhq/core`); `canonicalize` (`@oxyhq/core`) for a stable attestation payload; `bytesToHex`/`hexToBytes` (`@fairco.in/core`); `NetworkType` (`@fairco.in/core`).
- Produces:
  - `pocketCosignerInfo(network: NetworkType, pocketId: string): string` → `` `oxypay/faircoin/pocket-cosigner/v1:${network}:${pocketId}` `` (the mini-design domain string; the ONE place it is spelled — no other module hard-codes it).
  - `derivePocketCosignerKeypair(network, pocketId): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array } | null>` — `deriveScopedSeed(pocketCosignerInfo(...))` → `deriveMultisigCosignerKeypair(seed)`; `null` on web / keyless account (seed is `null`).
  - `signPocketMemberAttestation(network, pocketId, userId, cosignerPubHex): Promise<string>` — identity-signs `canonicalize({ pocketId, userId, network, cosignerPubHex })`, returns the signature hex (mini-design §2.3).
  - `verifyPocketMemberAttestation(member: SharedPocketMemberDTO, network, pocketId, identityPubkeyHex): boolean` — verifies the attestation against the member's identity pubkey (resolved by the caller via the WS-S `resolveIdentityPublicKey` path); a peer device calls this before trusting a registry entry (§2.5).
  - `identityPubkeyFingerprint(): Promise<string | null>` — a stable fingerprint (e.g. `sha256(current identity pubkey)` hex) captured at pocket creation so a later key rotation is DETECTABLE (mini-design §5.4). `null` on web/keyless.

- [ ] **Step 1: Write the failing tests (property-based; mock `deriveScopedSeed`)** — inject a deterministic fake `deriveScopedSeed` (returns `hkdfSha256(fixedSeed, salt, info, 32)` so different `pocketId`s give different seeds without a real device identity):
  - determinism: same `(network, pocketId)` → same `publicKey` across two calls;
  - unlinkability: different `pocketId` → different `publicKey`;
  - attestation round-trip: `verifyPocketMemberAttestation` accepts a signature produced by `signPocketMemberAttestation` for the matching identity key and REJECTS a signature over a different `cosignerPubHex` (substitution defense, §5.2);
  - `pocketCosignerInfo('testnet','p1')` equals the exact literal.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `pocket-cosigner-key.ts`.** Keep it null-safe on web/keyless exactly like `social-receive.ts`'s `getIdentityPrivateKeyBytes`. Never log/persist a private key.

- [ ] **Step 4: Run + tsc** → PASS; clean.

- [ ] **Step 5: Commit** — `feat(oxypay): per-pocket cosigner key derivation + identity attestation`.

---

## Task 10: Frontend — shared-pocket address build/verify + watch registration

Turns a confirmed cosigner set into the byte-identical P2SH address every member agrees on (mini-design §2.4–§2.5), and wires it into the SPV watch pipeline (spec §3, symmetric/trustless balance visibility). Pure address logic separated from I/O for unit-testability.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/wallet/shared-pocket.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/shared-pocket.test.ts`

**Interfaces:**
- Consumes: `buildSortedMultisigRedeemScript`, `multisigAddress`, `hexToBytes`, `getNetwork`, `NetworkType` (`@fairco.in/core`); `registerMultisigWatchAddress` (Task 8); `SharedPocketDTO`/`SharedPocketMemberDTO` (Task 1); OxyPay `Database`/`KeyManager`.
- Produces:
  - `interface SharedPocketDescriptor { pocketId: string; network: NetworkType; threshold: number; cosignerPubHexes: string[]; redeemScriptHex: string; address: string }`
  - `buildSharedPocketAddress(threshold, cosignerPubHexes, network): { redeemScriptHex: string; address: string }` — `buildSortedMultisigRedeemScript(threshold, cosignerPubHexes.map(hexToBytes))` → `redeemScriptHex` + `multisigAddress(...)`. The device's OWN computation, never trusting the server's.
  - `verifySharedPocketAddress(dto: SharedPocketDTO): boolean` — recomputes from `dto.members[].cosignerPubHex` + `dto.threshold` and returns `computed.address === dto.address && computed.redeemScriptHex === dto.redeemScriptHex`. A pocket that fails this is REJECTED by the UI (§2.5).
  - `registerSharedPocketWatch(database, keyManager, descriptor): Promise<string>` — `registerMultisigWatchAddress(database, keyManager, hexToBytes(descriptor.redeemScriptHex), getNetwork(descriptor.network), label='shared-pocket')` so the device watches the pocket's balance independently (spec §3).

- [ ] **Step 1: Write the failing tests** — build two `cosignerPubHexes` orderings of the same set and assert `buildSharedPocketAddress` yields identical `{redeemScriptHex,address}` (BIP67 order-independence surfaced at the OxyPay layer); `verifySharedPocketAddress` returns `false` for a DTO whose `address` was tampered; returns `true` for a self-consistent DTO built via `buildSharedPocketAddress`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `shared-pocket.ts`.**

- [ ] **Step 4: Run + tsc** → PASS; clean.

- [ ] **Step 5: Commit** — `feat(oxypay): shared-pocket address build/verify + watch registration`.

---

## Task 11: Frontend — local persistence for shared pockets + relay inbox

**Files:**
- Modify: `~/Oxy/OxyPay/packages/frontend/src/storage/database.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/storage/database.shared-pocket.test.ts`

**Interfaces:**
- Produces (new tables + methods on `Database`, following the existing `social_receive_addresses` migration pattern):
  - Table `shared_pockets(id PK, network, threshold, member_count, address, redeem_script_hex, status, created_by_user_id, identity_fingerprint, created_at, expires_at)`.
  - Table `shared_pocket_members(pocket_id, user_id, cosigner_pub_hex, confirmed, PRIMARY KEY(pocket_id, user_id))`.
  - Table `pocket_relay_inbox(request_id, pocket_id, type, from_user_id, created_at, PRIMARY KEY(request_id, type, from_user_id))` — a local dedupe ledger so a message delivered via BOTH the live room AND the durable drain is processed once.
  - Methods: `upsertSharedPocket(SharedPocketDescriptor & {status, identityFingerprint, memberCount, createdByUserId, expiresAt})`, `getSharedPockets(network)`, `getSharedPocket(id)`, `upsertPocketMembers(pocketId, members)`, `markRelayMessageSeen(requestId, type, fromUserId): boolean` (returns `false` if already seen — dedupe), `deleteSharedPocket(id)`.

- [ ] **Step 1: Write the failing DB test** — upsert a pocket + members, read them back; `markRelayMessageSeen` returns `true` first time, `false` second time (dedupe).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the migration + methods** (bump the schema version the way `database.ts` already versions migrations; never drop existing tables).

- [ ] **Step 4: Run + tsc** → PASS; clean.

- [ ] **Step 5: Commit** — `feat(oxypay): persist shared pockets + relay dedupe ledger`.

---

## Task 12: Frontend — E2E relay client (ECDH + AEAD envelopes + socket transport)

Implements Decision 5 (E2E encryption) over Decision 10 (existing Socket.IO). Reuses the ecosystem's sanctioned ECDH→HKDF→AEAD pattern (mini-design §5.6). The plaintext is a `SigningRequestEnvelope` or a `SignedMultisigPartial`; only ciphertext + routing metadata ever hit the relay.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/services/pocket-relay.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/services/pocket-relay.test.ts`

**Interfaces:**
- Consumes: `deriveSharedSecret`, `hkdfSha256`, `encryptAead`, `decryptAead`, `AEAD_*` (`@oxyhq/core`); the identity private key (via `getIdentityPrivateKeyBytes` from `src/wallet/social-receive.ts` — the SAME WS-S helper, reused, not re-implemented) and the counterparty identity pubkey (WS-S `resolveIdentityPublicKey` path); `PocketRelayMessage`/`SigningRequestEnvelope`/`POCKET_RELAY_EVENTS` (Task 1); the gateway socket (extend `services/gateway-socket.ts`'s single connection or open a typed pocket namespace).
- Produces:
  - `RELAY_HKDF_INFO = 'oxypay/pocket-relay/v1'` (the KDF context binding).
  - `encryptRelayMessage(myIdentityPrivHex, theirIdentityPubHex, pocketId, requestId, type, plaintext: object): PocketRelayMessage` — ECDH → `hkdfSha256(shared, salt, RELAY_HKDF_INFO, 32)` → `encryptAead(key, utf8(JSON.stringify(plaintext)), aad)` with `aad = utf8(\`${pocketId}:${type}:${requestId}\`)` (cross-pocket/cross-round replay binding, mini-design §5.6). Returns the opaque wire envelope (base64 fields).
  - `decryptRelayMessage<T>(myIdentityPrivHex, msg: PocketRelayMessage): T` — inverse; throws on tamper/wrong-key (AEAD auth failure) — never a silent `catch {}`.
  - `publishSigningRequest(pocket: SharedPocketDTO, envelope: SigningRequestEnvelope): Promise<void>` — encrypts the envelope SEPARATELY to each OTHER member (pairwise) and emits one `POCKET_RELAY_EVENTS.message` per recipient.
  - `subscribePocketRelay(pocketId, onMessage: (m: PocketRelayMessage) => void): Promise<Subscription>` — emits `POCKET_RELAY_EVENTS.subscribe {pocketId}`, receives both the live room stream AND the drained inbox as `message` events; the caller dedupes via `Database.markRelayMessageSeen`.
  - `sendPartial(pocket, proposerUserId, requestId, partial: SignedMultisigPartial['partial']): Promise<void>` — encrypts the partial to the proposer and emits it.

- [ ] **Step 1: Write the failing crypto test** — `encryptRelayMessage` then `decryptRelayMessage` round-trips a JSON payload; decrypt with the WRONG private key throws; a tampered `ciphertextB64` throws; the same plaintext under two calls yields DIFFERENT `nonceB64`/`ciphertextB64` (random nonce). Use two real secp256k1 keypairs and assert `deriveSharedSecret` symmetry underpins it.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `pocket-relay.ts`.** Encode `nonce`/`ciphertext`/`aad` as base64 for the wire; JSON-encode the plaintext object. Keep the socket typed (extend the `ServerToClientEvents`/`ClientToServerEvents` in `gateway-socket.ts` with the pocket events, no casts).

- [ ] **Step 4: Run + tsc** → PASS; clean.

- [ ] **Step 5: Commit** — `feat(oxypay): E2E encrypted pocket relay client`.

---

## Task 13: Frontend — gateway REST client for the pocket registry

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/services/gateway-pockets.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/services/gateway-pockets.test.ts`

**Interfaces:**
- Consumes: the existing authed HTTP client used by `gateway-client.ts` (bearer via `oxyServices.getAccessToken()`); the Task 1 request/response DTOs.
- Produces:
  - `createSharedPocket(req: CreateSharedPocketRequest): Promise<SharedPocketDTO>` (`POST /v1/pockets`).
  - `attestMembership(pocketId, req: AttestPocketMemberRequest): Promise<SharedPocketDTO>` (`POST /v1/pockets/:id/attest`).
  - `listSharedPockets(network): Promise<SharedPocketDTO[]>` (`GET /v1/pockets?network=`).
  - `getSharedPocket(id): Promise<SharedPocketDTO>` (`GET /v1/pockets/:id`).
  - `broadcastPocketSpend(req: PocketBroadcastRequest): Promise<PocketBroadcastResponse>` (`POST /v1/pockets/:id/broadcast`).
  - `class KeylessMemberError extends Error` — thrown when resolving an invited `@username` that has no identity key (mirrors WS-S's `KeylessRecipientError`), so the create flow surfaces "invite them to set up Oxy Pay" instead of failing opaquely.

- [ ] **Step 1: Write the failing client test** — mock the HTTP layer; assert each method hits the right path/verb with the right body, and that a 400 address-mismatch surfaces a typed error, a keyless-recipient path throws `KeylessMemberError`.

- [ ] **Step 2: Run, verify fail. Step 3: Implement. Step 4: Run + tsc. Step 5: Commit** — `feat(oxypay): gateway REST client for shared pockets`.

---

## Task 14: Frontend UI — create-shared-pocket flow

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/CreateSharedPocketSheet.tsx`
- Create: `~/Oxy/OxyPay/packages/frontend/src/hooks/useSharedPockets.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/hooks/useSharedPockets.test.ts`

**Interfaces:**
- Consumes: `SocialRecipientPicker` (WS-S, reused for `@username` member selection); `resolveIdentityPublicKey`-equivalent client call to resolve each member's identity pubkey; `derivePocketCosignerKeypair`/`signPocketMemberAttestation` (Task 9); `buildSharedPocketAddress` (Task 10); `createSharedPocket` (Task 13); `Database.upsertSharedPocket`/`upsertPocketMembers` (Task 11).
- Produces: `useSharedPockets()` (React Query: `listSharedPockets` + create mutation) and the `CreateSharedPocketSheet` Bloom sheet.

- [ ] **Step 1: Write the failing hook test** — the create mutation, given a member set, (a) derives the creator's cosigner key, (b) resolves each member's identity pubkey, (c) computes the address via `buildSharedPocketAddress`, (d) calls `createSharedPocket` with the exact computed `address`/`redeemScriptHex`, (e) persists locally. Assert a keyless member aborts with `KeylessMemberError` before any network write.

- [ ] **Step 2: Run, verify fail. Step 3: Implement the hook + sheet.** The sheet: member picker (min 1 other, max 15 → n ≤ 16 per L1 cap), a threshold `m` selector with a **sane default of "everyone must approve" (`m = n`)** for small pockets (Decision 3's UI budget), and a **mandatory, unmissable key-loss warning** before finalize (Decision 4): "If any member loses their key/device, their spot cannot be replaced — recovery means moving funds to a new pocket." Finalize is disabled until the warning is acknowledged.

- [ ] **Step 4: Verify on a real foregrounded device/emulator** — create a 2-of-2 testnet pocket end-to-end; confirm the address renders and matches the second device. **Step 5: Commit** — `feat(oxypay): create-shared-pocket flow`.

---

## Task 15: Frontend UI — invite / accept + address confirmation

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/PocketInviteSheet.tsx`
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/components/SharedPocketCard.tsx`
- Test: colocated logic test for the accept path (extract a pure `acceptInvite(dto)` helper).

**Interfaces:**
- Consumes: `getSharedPocket` (Task 13); `verifySharedPocketAddress` (Task 10); `verifyPocketMemberAttestation` (Task 9) for EACH member (resolving each member's identity pubkey); `derivePocketCosignerKeypair`/`signPocketMemberAttestation`/`identityPubkeyFingerprint` (Task 9); `attestMembership` (Task 13).
- Produces: the accept flow — an invited member's device (1) fetches the pocket, (2) `verifySharedPocketAddress` REJECTS on mismatch, (3) verifies every member's identity attestation (§2.5 — reject on any failure), (4) derives its OWN cosigner key, confirms its own pubkey is the one in the registry for its slot, (5) calls `attestMembership` with `confirmedAddress = dto.address` and its attestation, (6) persists the pocket + `identityPubkeyFingerprint`. Shows the SAME mandatory key-loss warning (Decision 4) before accepting.

- [ ] **Step 1: Write the failing accept-path test** — accept succeeds for a self-consistent DTO; throws/blocks for a DTO failing `verifySharedPocketAddress`; blocks for a DTO where a member's attestation does not verify (substitution defense).

- [ ] **Step 2: Run, verify fail. Step 3: Implement.** **Step 4: Device-verify the two-device confirm loop** (both devices show the identical address before either finalizes). **Step 5: Commit** — `feat(oxypay): pocket invite/accept + address confirmation`.

---

## Task 16: Frontend UI — funding + shared-pocket detail (balance, members)

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/app/pockets/shared/[id].tsx`
- Modify: `~/Oxy/OxyPay/packages/frontend/src/wallet/wallet-store.ts` (shared-pocket watch registration + per-pocket UTXO view)
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/wallet-store.shared-pocket.test.ts`

**Interfaces:**
- Consumes: `registerSharedPocketWatch` (Task 10); the existing SPV/UTXO pipeline in `wallet-store.ts`; `getSharedPockets` (Task 13).
- Produces: on authenticated wallet init, `wallet-store` registers every persisted shared pocket's watch address (spec §3, so balance is visible independently of any other member/the backend) and exposes `sharedPocketUtxos(pocketId)` + `sharedPocketBalance(pocketId)` derived views. The detail screen shows: balance, the member list (avatars via the canonical media chokepoint + `displayName ?? handle`), the pocket address with QR + copy (open-jar funding, Decision 8 — "anyone can send here"), and CTAs to Propose a spend / view activity.

- [ ] **Step 1: Write the failing store test** — after `initializeFromIdentity`, a persisted shared pocket's address is watched and `sharedPocketBalance` sums only that pocket's UTXOs.

- [ ] **Step 2: Run, verify fail. Step 3: Implement.** **Step 4: Device-verify** funding a testnet pocket: send FairCoin to the address from another wallet → balance appears on BOTH members' devices with no backend involvement. **Step 5: Commit** — `feat(oxypay): shared-pocket funding + detail screen`.

---

## Task 17: Frontend UI — propose a spend + distribute the signing request

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/ProposeSpendSheet.tsx`
- Create: `~/Oxy/OxyPay/packages/frontend/src/hooks/usePocketRelay.ts`
- Test: `usePocketRelay.test.ts` (pure proposal-builder helper)

**Interfaces:**
- Consumes: `buildMultisigSendDraft`/`exportSigningRequest` (Task 8) over the pocket's watched UTXO set; `publishSigningRequest` (Task 12); `SigningRequestEnvelope` (Task 1). Any member may propose (Decision 6).
- Produces: `buildSpendProposal(pocket, recipientAddress, amount, feeRate, utxo): SigningRequestEnvelope` — picks ONE pocket UTXO (L1 single-input constraint — surface a clear "consolidate first" message if the largest UTXO is insufficient, spec §4 inherited constraint), builds the draft, exports the signing request, wraps it with `requestId` (fresh uuid), `proposerUserId`, and an `expiresAt` (Decision 9 TTL — define `POCKET_SIGNING_REQUEST_TTL_MS`, e.g. 24h, as a named constant). The sheet: recipient + amount entry (reuse SendSheet primitives), fee-from-pot note (Decision 7), then `publishSigningRequest` to the other cosigners and record the pending request locally.

- [ ] **Step 1: Write the failing builder test** — `buildSpendProposal` produces an envelope whose decoded summary (`decodeMultisigSpend`) matches the intended recipient/amount; throws a typed "insufficient single UTXO — consolidate" error when no single UTXO covers amount+fee.

- [ ] **Step 2: Run, verify fail. Step 3: Implement.** **Step 4: Device-verify** the request reaches the co-signer device (online). **Step 5: Commit** — `feat(oxypay): propose shared-pocket spend + distribute signing request`.

---

## Task 18: Frontend UI — the co-sign screen (M2 anti-blind-signing) — HARD REQUIREMENT

Where 100% of the real-money risk concentrates (L1 audit M2, spec §4.3, §6). This screen is a hard requirement, not optional copy.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/sheets/CoSignSheet.tsx`
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/components/CoSignSummary.tsx`
- Modify: `~/Oxy/OxyPay/packages/frontend/src/wallet/wallet-store.ts` (add `inputValuesForRequest`)
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/inputValuesForRequest.test.ts`

**Interfaces:**
- Consumes: `decryptRelayMessage` (Task 12) → `SigningRequestEnvelope`; `decodeMultisigSpend`/`signMultisigSendRequest` (Task 8); `derivePocketCosignerKeypair` (Task 9) for the signing key; `sendPartial` (Task 12).
- Produces:
  - `inputValuesForRequest(pocketId, envelope): bigint[]` on `wallet-store` — resolves each input's value from THIS device's OWN confirmed UTXO set (keyed by the request's input outpoints), NEVER from the proposer/relay (L1 audit M2 — trusting the proposer's input value lets a malicious coordinator understate the fee). Throws if an outpoint is not in the device's confirmed set (refuse to sign what you can't independently value).
  - `CoSignSheet` flow: decrypt → `decodeMultisigSpend(request, inputValuesForRequest(...), network)` → render `CoSignSummary` (every recipient + amount, the fee = totalInput − totalOutput, the pocket it spends from) → require EXPLICIT confirm (+ device unlock/PIN per the existing spend-auth gate) → `signMultisigSendRequest` with the per-pocket key → `sendPartial` (encrypted) back to the proposer. A decode failure (unreadable output, over-spend, unknown outpoint) shows a hard error and NO sign path.

- [ ] **Step 1: Write the failing `inputValuesForRequest` test** — returns the device's own UTXO values for known outpoints; THROWS for an outpoint not in the confirmed set (the anti-understated-fee guard). Add a `CoSignSummary` snapshot/render test asserting recipient/amount/fee are all shown.

- [ ] **Step 2: Run, verify fail. Step 3: Implement.** No blind-sign path may exist — signing is reachable ONLY after an explicit confirm on a successfully-decoded summary.

- [ ] **Step 4: Device-verify on a real foregrounded device** — a co-signer sees the exact recipient/amount/fee, an over-spend/tampered request is refused, and only an explicit confirm produces a partial. **Step 5: Commit** — `feat(oxypay): M2 co-sign screen (decoded summary + explicit confirm)`.

---

## Task 19: Frontend — proposer collects, finalizes, and broadcasts

The proposer's device is the collector/finalizer (spec §4.5 — the backend can't, because partials are E2E-encrypted). Needs no private key to finalize.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/wallet/pocket-finalize.ts`
- Test: `~/Oxy/OxyPay/packages/frontend/src/wallet/pocket-finalize.test.ts`

**Interfaces:**
- Consumes: `decryptRelayMessage` (Task 12) → each returned partial; `verifyPartialSignature`/`finalizeMultisigSend` (Task 8); `broadcastPocketSpend` (Task 13); the locally-held `MultisigSendDraft` for the pending `requestId`.
- Produces:
  - `collectPartial(state, partial): CollectState` — accumulates DISTINCT-cosigner partials for a `requestId`; `verifyPartialSignature` (over the correct sighash) REJECTS any that don't verify before accepting (mirrors `finalizeMultisigSend`'s own guard); dedupes by pubkey.
  - `finalizeAndBroadcast(draft, partials, pocketId, requestId): Promise<{ txid: string }>` — once ≥m valid partials are held, `finalizeMultisigSend(draft, partials)` locally → `broadcastPocketSpend({ pocketId, requestId, rawTxHex })`. This step touches NO private key (spec §4.5), which is exactly why it is safe on an ordinary member's device.

- [ ] **Step 1: Write the failing test** — with a hand-built 2-of-2 draft + two real partials (signed via the L1 path in the test), `collectPartial` accepts both, rejects a partial that doesn't verify, and `finalizeAndBroadcast` calls the (stubbed) broadcaster with a raw tx whose txid equals `finalizeMultisigSend`'s. Assert it refuses to broadcast with < m partials.

- [ ] **Step 2: Run, verify fail. Step 3: Implement. Step 4: Run + tsc.** **Step 5: Device-verify** a full 2-of-2 testnet spend end-to-end (propose → co-sign → collect → finalize → broadcast → confirmed on-chain). **Step 6: Commit** — `feat(oxypay): proposer-side collect/finalize/broadcast`.

---

## Task 20: Frontend UI — pending co-sign notifications (in-app, expiry-aware)

Decision 9: pending requests surface in-app; each carries an expiry; a stale, unacted request shows as expired rather than lingering.

**Files:**
- Create: `~/Oxy/OxyPay/packages/frontend/src/ui/components/PendingCoSignBanner.tsx`
- Create: `~/Oxy/OxyPay/packages/frontend/src/hooks/usePendingCoSigns.ts`
- Modify: `~/Oxy/OxyPay/packages/frontend/app/(tabs)/index.tsx` (surface the banner)
- Modify: `~/Oxy/OxyPay/packages/frontend/app/_layout.tsx` (start `subscribePocketRelay` + inbox drain on authenticated boot)
- Test: `usePendingCoSigns.test.ts`

**Interfaces:**
- Consumes: `subscribePocketRelay`/`drainPocketInbox` (Task 12); `Database.markRelayMessageSeen` (Task 11); the pending-request store; the `expiresAt` on each `SigningRequestEnvelope` (Task 1).
- Produces: `usePendingCoSigns()` — a derived list of not-yet-acted, not-yet-expired co-sign requests for pockets the user is a member of (state-derived; NO `useEffect` for the derivation — compute `expired = now > expiresAt` at render). The banner deep-links each into `CoSignSheet` (Task 18); expired ones render as "expired" and are non-actionable. Boot wiring drains the durable inbox once on authenticated start so a request that arrived while offline appears on next open.

- [ ] **Step 1: Write the failing hook test** — given inbox items with mixed `expiresAt`, the hook returns only live pending items as actionable and marks past-expiry ones expired; dedupes an item delivered via both live + drain.

- [ ] **Step 2: Run, verify fail. Step 3: Implement.** Follow the boot-mount safety rule (no suspenseful hooks in a boot-mounted component; the banner renders null until it has data). **Step 4: Device-verify** — a request sent while the co-signer is offline appears in-app on next open; an expired one shows as expired. **Step 5: Commit** — `feat(oxypay): pending co-sign notifications (in-app, expiry-aware)`.

---

## Task 21: security-reviewer gate (BLOCKED on all) — mandatory before mainnet

The hard prerequisite from the key-derivation mini-design §7 and spec Decision 1. Do NOT ship a mainnet-capable build until this passes AND WS-S's F-1 is fixed.

**Files:** none (review + a findings doc under `docs/superpowers/`).

- [ ] **Step 1: Dispatch the `security-reviewer` agent** against the full L2 surface with the mini-design's §5 threat model as the checklist. Require explicit confirmation of:
  - §5.1 — a leaked per-pocket key CANNOT recover the identity master key (the HKDF firewall holds; verify `deriveScopedSeed` → `deriveMultisigCosignerKeypair` is genuinely one-way and the raw identity key never crosses into OxyPay).
  - §5.2 — pubkey-substitution is closed by identity attestation + address confirmation (both enforced before a pocket goes active/signable).
  - §5.3 — the backend is keyless; forged metadata fails device re-derivation; worst case is DoS, never theft (MiCA firewall intact).
  - §5.5 — the per-pocket key is used ONLY for multisig ECDSA, never DID signing (no cross-protocol reuse; a net reduction vs WS-S).
  - §5.6 — the relay never sees plaintext spend metadata; ECDH context binding (`aad`) is present.
  - §4.3 M2 — the co-sign screen sources `inputValues` from the device's own confirmed UTXO set and requires explicit confirm; no blind-sign path exists.
  - The BIP67 canonical-sort invariant is enforced through the single `buildSortedMultisigRedeemScript` on every device AND the backend (no divergent-address vector).
- [ ] **Step 2: Confirm the F-1 dependency** — L2 inherits WS-S's F-1 via the shared identity-key source; mainnet is blocked until identity-vault v2 fixes it. Record this explicitly in the findings.
- [ ] **Step 3: Address findings**, re-review, and only then flag L2 as mainnet-eligible (still gated on F-1). Until then: **testnet-only.**

---

## Self-Review

**1. Spec coverage** (each L2 spec decision → task):
- Decision 1 (per-pocket derived key) → mini-design (A) + Tasks 2, 9; gate Task 21. ✅
- Decision 2 (backend metadata registry, never trusted) → Tasks 3, 4 (backend re-derivation) + Task 10/15 (device re-derive & confirm). ✅
- Decision 3 (configurable m-of-n + UX budget) → Task 14 (threshold selector + sane default). ✅
- Decision 4 (no re-key; mandatory warning; rotation detection) → Tasks 14, 15 (warning) + Task 9 `identityPubkeyFingerprint` + Task 11 persistence. ✅
- Decision 5 (E2E encrypted relay) → Task 12 (ECDH+AEAD) + Task 6 (keyless relay). ✅
- Decision 6 (any member proposes) → Task 17. ✅
- Decision 7 (fee from pot) → Task 17 (fee-from-pot note; L1 default stands). ✅
- Decision 8 (open-jar funding) → Task 16. ✅
- Decision 9 (in-app notification + expiry) → Tasks 17 (TTL) + 20 (banner). ✅
- Decision 10 (existing Socket.IO) → Task 6 (pocket room on the existing io) + Task 12. ✅
- §2 canonical SORT (hard correctness) → Task 2 (`buildSortedMultisigRedeemScript`), enforced device+backend (Tasks 4, 10). ✅
- §4 spend flow (propose/distribute/decode-confirm/partial/collect-finalize/broadcast) → Tasks 8, 17, 18, 19, 7. ✅
- §4.3 M2 → Task 18 (hard-flagged). ✅
- §5 relay (what it sees/can't) → Tasks 6, 12. ✅
- §6 trust model / MiCA firewall → enforced by keyless Tasks 3–7 + Task 21 gate. ✅
- Inherited single-UTXO L1 constraint → Task 17 (consolidate message). ✅

**2. Placeholder scan** — no "TBD/handle edge cases/etc.". Crypto tests are property-based (determinism/round-trip/order-independence) rather than fabricated hex constants; the ONE pinned vector (Task 2 Step 4) is explicitly captured from the real passing run, not invented. ✅

**3. Type consistency** — DTO/type names (`SharedPocketDTO`, `SharedPocketMemberDTO`, `CreateSharedPocketRequest`, `AttestPocketMemberRequest`, `SigningRequestEnvelope`, `PocketRelayMessage`, `PocketBroadcastRequest/Response`, `POCKET_RELAY_EVENTS`) and function names (`deriveMultisigCosignerKeypair`, `buildSortedMultisigRedeemScript`, `derivePocketCosignerKeypair`, `buildSharedPocketAddress`/`verifySharedPocketAddress`, `computeRegistryAddress`, `encryptRelayMessage`/`decryptRelayMessage`, `inputValuesForRequest`, `collectPartial`/`finalizeAndBroadcast`) are used identically across the tasks that produce and consume them. ✅

**Prerequisites called out:** WS-S landed ✅; key-derivation design (A) + Task 21 gate; F-1 inherited (testnet-only); backend shared-file edits (Tasks 5, 6) coordinate with the active gateway session. ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-21-l2-shared-pockets.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
2. **Inline Execution** — batch execution with checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.

**Do NOT begin execution until:** (a) the key-derivation mini-design (A) has had its design-level `security-reviewer` look, and (b) the active gateway session confirms it is safe to serialize the two shared-backend-file edits (Tasks 5, 6).
