# FAIRWallet SPV Audit

A code-only audit of the FairCoin SPV (Simple Payment Verification) implementation in `src/core/`, `src/p2p/`, and `src/wallet/`. Performed on 2026-04-11.

No network / integration tests were run: there is no local FairCoin test network available. The audit focuses on reading the source, identifying gaps versus a complete SPV wallet, flagging bugs that a human reviewer should look at next, and adding unit tests for the pure cryptographic and parsing modules.

> ## Update — 2026-07-16 (verified against live mainnet)
> The wallet was tested end-to-end against the live node `187.33.154.215` and
> three root causes that made **receiving impossible** were fixed (all on `main`):
> 1. **Protocol mismatch.** faircoin Core 3.0.5 does **not** implement
>    `getheaders`/`headers`; it uses the legacy block-announcement path. The SPV
>    client was rewritten from headers-first to `getblocks → inv →
>    getdata(MSG_FILTERED_BLOCK) → merkleblock`, building the header chain from
>    the header carried in each merkle block. New blocks (`inv` MSG_BLOCK) are now
>    requested as filtered blocks too, so a payment confirms the instant its block
>    arrives (live confirmation).
> 2. **Broken Quark block hash.** `@fairco.in/core`'s Quark computed the wrong id
>    for every block (BMW-512 `add_elt` double-offset + Groestl-512 table/rotation/
>    Q-constant/IV bugs). Fixed and released as `@fairco.in/core@0.1.1`, verified
>    byte-for-byte against `FairCoin/src` and real mainnet block ids.
> 3. **Dead peers.** DNS seeds didn't resolve and every hardcoded fallback was
>    offline; the fallback list now points at live NODE_BLOOM nodes and the
>    `seed1/seed2.fairco.in` DNS seeds were repointed to live A-records.
>
> Sections below describing the headers-first sync (esp. §1 rows 3–5 and the
> `spv-client.ts` header-sync notes) are **historical** — the live sync path is
> now block-first as above.

---

## 1. Completeness versus a complete SPV wallet

| # | Capability | Status | Notes |
|---|------------|--------|-------|
| 1 | Connect to peers via DNS seeds + persistent peer list | ⚠️ Partial | DNS-over-HTTPS works. No persistent peer list saved in SQLite; `failedAddresses` is in-memory only. |
| 2 | version/verack handshake | ✅ Implemented | `src/p2p/peer.ts` |
| 3 | Request headers (`getheaders` → `headers`) | ✅ Implemented | `src/p2p/spv-client.ts` |
| 4 | Validate header chain (PoW, difficulty, linkage) | ❌ **Missing** | **No PoW check.** **No prev-hash linkage check.** **No difficulty-retarget check.** Headers from any peer are trusted verbatim. |
| 5 | Sync to tip with checkpoints | ⚠️ Partial | Checkpoint file exists (`src/core/checkpoints.ts`) but contains only the genesis block; no code reads it during sync. |
| 6 | Bloom filter (`filterload`) | ✅ Implemented | `src/p2p/bloom-filter.ts` (BIP37) — tested. |
| 7 | Request merkle blocks (`getdata` for filtered blocks) | ✅ Implemented | `spv-client.ts` |
| 8 | Verify merkle proofs for received transactions | ⚠️ Partial | `validateMerkleProof` exists, but (a) does not check that all flag bits were consumed (b) is not tested against real merkleblocks. |
| 9 | Detect reorgs and rewind UTXO set | ❌ **Missing** | No reorg detection, no UTXO rewind. `maxReorgDepth` is declared but never used. |
| 10 | Track UTXOs for the user's addresses | ⚠️ Partial | `UTXOSet` class exists, `Database.insertUTXO` exists. But `SPVClient.processTransaction` does NOT add received outputs to the UTXO set — the wallet-store `onTransaction` handler is an empty `() => {}` placeholder. **Received funds will never appear in the wallet.** |
| 11 | Build + sign + broadcast transactions | ✅ Implemented | `buildTransaction` + `signInput` + `SPVClient.broadcastTransaction`. Tested. |
| 12 | Mempool / zero-conf handling | ❌ Missing | No mempool tracking. |
| 13 | Masternode list sync | ⚠️ Partial | Message serialization exists (`src/p2p/masternode.ts`), but no code syncs the masternode list or tracks `mnb`/`mnp` messages. |
| 14 | FastSend / InstantSend support | ⚠️ Partial | Message types, vote tracker, and `canUseFastSend` exist (`src/p2p/fastsend.ts`), but `wallet-store.sendTransaction` never broadcasts as `ix`. FastSend is plumbed but unused. |
| 15 | BIP44 address gap limit | ⚠️ Partial | `KeyManager` pre-generates 20 external + 10 change addresses. `scanForUsedAddresses` exists but requires a caller-provided `checkFn`. The gap limit is not re-extended on receive unless `getNextAddress` is called — which is a UX-level flow, not a sync-level flow. |

---

## 2. Modules audited

### Core protocol primitives

| File | LoC | Implements | Status |
|------|-----|-----------|--------|
| `src/core/encoding.ts` | 498 | hex/bytes, varint, base58check, BIP39 WIF, `BufferWriter`/`BufferReader`, LE integer I/O | ✅ Implemented and tested (`encoding.test.ts`) |
| `src/core/address.ts` | 145 | hash160, P2PKH/P2SH address encoding, validateAddress, addressToScriptHash | ✅ Implemented and tested (`address.test.ts`) |
| `src/core/script.ts` | 207 | Opcodes, pushData, P2PKH/P2SH template builders, script-type detection | ✅ Implemented, covered transitively via address/transaction tests |
| `src/core/transaction.ts` | 397 | serialize/deserialize, hashTransaction (double-SHA256), signInput (DER + low-S), buildTransaction with coin selection + change | ✅ Implemented and tested (`transaction.test.ts`) |
| `src/core/hd-wallet.ts` | 165 | BIP39 mnemonic, PBKDF2 seed derivation, BIP32 HDKey wrapper, BIP44 path helper | ✅ Implemented and tested (`hd-wallet.test.ts`) |
| `src/core/network.ts` | 121 | Mainnet/testnet config (magic, ports, version bytes, genesis, BIP44 coin type) | ✅ Implemented and tested (`network.test.ts`) |
| `src/core/checkpoints.ts` | 57 | Checkpoint list + lookup helpers | ⚠️ Only the genesis block is in the mainnet and testnet lists. Checkpoint lookup is not consumed by the SPV client. |
| `src/core/bip38.ts` | 660 | BIP38 encrypt/decrypt with scrypt + AES-256-ECB (pure TS, no external AES) | ⚠️ Implemented but not tested. The pure-TS AES-256-ECB is large, non-trivial, and relies on a row-major internal layout that differs from textbook AES; needs test vectors from the BIP38 spec. |
| `src/core/format-amount.ts` | 95 | `formatUnits`, `formatFair`, `parseFairToUnits` | ✅ Implemented and tested (`format-amount.test.ts`) |
| `src/core/quark-hash.ts` | ~1300 | Quark 9-round multi-hash (BLAKE-512, BMW-512, Groestl-512, JH-512, Skein-512, Keccak-512) + block header serialisation | 🐛 **Had a critical bug — partially fixed**. See §4 below. |
| `src/core/uri.ts` | 93 | BIP21 `faircoin:` URI parser | ✅ Implemented, untested (trivial) |
| `src/core/branding.ts` | 44 | Static constants (coin name, symbols, explorer URLs) | ✅ Static data |

### SPV / P2P

| File | LoC | Implements | Status |
|------|-----|-----------|--------|
| `src/p2p/messages.ts` | 753 | Header framing, version/verack, getheaders/headers, inv/getdata, merkleblock, tx, filterload, ping/pong, addr | ✅ Implemented and tested (`messages.test.ts`) |
| `src/p2p/bloom-filter.ts` | 209 | BIP37 bloom filter + MurmurHash3 + `BloomFilter.forAddresses` (optimal sizing) | ✅ Implemented and tested (`bloom-filter.test.ts`) |
| `src/p2p/peer.ts` | 427 | Single-peer TCP connection, version handshake, ping keepalive, message dispatch | ⚠️ Implemented but only exercises the wire format. No integration tests. |
| `src/p2p/peer-manager.ts` | 322 | Multi-peer pool, DNS seed discovery, reconnection, fail-count backoff | ⚠️ Implemented but no persistence (see §1.1) |
| `src/p2p/spv-client.ts` | 659 | Header sync, merkle proof validation, bloom filter, tx broadcast | 🐛 Missing PoW check, missing prev-hash linkage check, missing reorg handling, `processTransaction` does not update UTXO set. See §4. |
| `src/p2p/dns-seeds.ts` | 145 | DoH + native resolver + hardcoded fallback peers | ⚠️ Hardcoded fallback peers may be stale and will rot over time |
| `src/p2p/header-store.ts` | 84 | `HeaderStore` bridge to SQLite | ✅ Trivial adapter |
| `src/p2p/masternode.ts` | 416 | mnb/mnp serialisation + signing | ⚠️ Plumbed but unused (see §1.13) |
| `src/p2p/fastsend.ts` | 275 | `ix` message type, `TxLockVote` parser, `FastSendTracker` | ⚠️ Plumbed but unused (see §1.14) |
| `src/p2p/socket-provider.ts` | 275 | RN / Electron socket bridge | ✅ Implemented |

### Wallet integration

| File | LoC | Implements | Status |
|------|-----|-----------|--------|
| `src/wallet/key-manager.ts` | 291 | BIP44 address pre-generation, gap-limit scanning | ⚠️ Uses `nextExternalIndex` / `nextChangeIndex` counters that start at 0 on every init — the wallet does not remember which addresses have been used across restarts. |
| `src/wallet/utxo-set.ts` | 231 | In-memory UTXO tracking, balance, coin selection (largest-first) | ✅ Implemented |
| `src/wallet/wallet-store.ts` | 1080 | Zustand store orchestrating keys, UTXOs, SPV client, multi-wallet, backup | 🐛 `onTransaction` handler is an empty placeholder; incoming funds are never added to the wallet. |
| `src/wallet/contacts-store.ts` | 112 | Contacts list | ✅ Out of audit scope |

---

## 3. Tests added in this audit

Nine new test files, all using Bun's built-in test runner. 222 tests total, all passing.

```
src/core/address.test.ts      — 28 tests
src/core/encoding.test.ts     — 48 tests
src/core/format-amount.test.ts — 24 tests
src/core/hd-wallet.test.ts    — 22 tests
src/core/network.test.ts      — 21 tests
src/core/quark-hash.test.ts   — 18 tests
src/core/transaction.test.ts  — 20 tests
src/p2p/bloom-filter.test.ts  — 12 tests
src/p2p/messages.test.ts      — 29 tests
```

Run with:

```
bun test src
```

A `test` script was added to `package.json`.

### Test vector sourcing

- **Bitcoin-compatible vectors**: canonical BIP39 trial mnemonic `"abandon abandon … about"` produces a well-known reference seed (`5eb00bbd…`) that is pinned in `hd-wallet.test.ts`. Any BIP39 regression will fail this test.
- **secp256k1 generator G**: its compressed public key is a universal test value. Its hash160 is `751e76e8…`. These are pinned in `address.test.ts`. They guard against regressions in the address encoder, checksum, or base58 alphabet.
- **FairCoin-specific addresses**: derived deterministically from the trial mnemonic at `m/44'/119'/0'/0/0`. Pinned in `hd-wallet.test.ts`. These guard against regressions in the BIP44 coin type (119), `pubKeyHash` version byte (35), and `bip32.private` version bytes.

### Coverage gaps

- **`bip38.ts`** is not tested. The BIP38 spec provides known test vectors; writing those tests is the obvious next step.
- **`script.ts`** is not tested directly — only covered transitively via `address.test.ts` (`extractAddressFromScript`) and `transaction.test.ts` (`createP2PKHScript`). A dedicated `script.test.ts` covering `pushData` across all length classes (0, 1-16, 17-75, 76-255, 256-65535) would be worth adding.
- **`uri.ts`** is not tested — it's trivial BIP21 parsing, but a handful of round-trip tests would be cheap.
- **`checkpoints.ts`** is not tested — the module is mostly data with trivial lookups.
- **`p2p/peer.ts`**, **`peer-manager.ts`**, **`spv-client.ts`** require a mock socket provider to test end-to-end. The existing `SocketProvider` interface is well-designed for this, but the mock infrastructure doesn't exist yet.

---

## 4. Bugs found

### 🐛 1. Broken BLAKE-512 in Quark hash — **FIXED during this audit**

The pure-TS `blake512` function in `src/core/quark-hash.ts` (lines 225–320) had multiple defects. Empirically, it:

- Returned the **same output for every 80-byte input**, regardless of content. This meant every FairCoin block header, regardless of nonce, prev-hash, or merkle root, hashed to the same value (`2153f736f00560facc159b2b2f71203cec16d829220db41777c4715b8d19eb35`). This is catastrophic for PoW verification.
- Returned **the same output for multiple small inputs** (e.g. `[0x00]`, `[0x01]`, `[0xff]`).
- Did not match the canonical BLAKE-512 test vectors from the SPH reference.

Because BLAKE-512 is the first round of Quark, and h1 is the only thing carrying input information, a broken BLAKE-512 causes every subsequent round to become input-independent too.

**Fix applied**: replaced the custom function with `@noble/hashes/blake1#blake512`, which matches the spec test vectors. The original function was renamed `_legacyBlake512Broken` and left in place as a documentation artefact — it is no longer called and can be deleted in a follow-up commit.

**Verification**: `quark-hash.test.ts > quarkHash correctness` now passes, including the "different block headers produce different hashes" test that was failing pre-fix.

**Residual risk — ⚠️ not fully resolved**: Quark still depends on four more custom pure-TS hash implementations: `bmw512`, `groestl512`, `jh512`, and `skein512`. These each produce **different outputs for different inputs** (verified empirically), but they have not been tested against the SPH reference test vectors. It is possible that any of them still produces the wrong output — just not a *constant* one. If so, FairCoin's PoW verification in this wallet will never match what masternodes compute. Since the SPV client does not currently validate PoW at all (see bug #3 below), this is a latent risk rather than an active one, but it must be resolved before PoW validation is added.

### 🐛 2. `wallet-store.onTransaction` is an empty placeholder

`src/wallet/wallet-store.ts:349-353`:

```ts
spvClient.setEvents({
  onTransaction: (_tx, _blockHash) => {
    // Incoming transactions are processed by the SPV client.
    // Future: parse outputs, match to wallet addresses, add UTXOs.
  },
  ...
```

Incoming transactions delivered by the SPV client are dropped on the floor. Concretely:

- Users will never see received funds show up in the wallet
- The `transactions` list in the Zustand store will only ever contain outbound sends
- Balance will only reflect UTXOs that existed in the database before startup

**Impact**: the wallet cannot receive FAIR without manual database manipulation. This is a blocker for wallet usability.

**Fix needed**: implement the handler. For each output in `_tx`, check if its `scriptPubKey` decodes to an address managed by `KeyManager`. If so, insert into the database and add to the in-memory `UTXOSet`. Also insert the transaction into the `transactions` table.

### 🐛 3. No header chain validation in `processHeadersResponse`

`src/p2p/spv-client.ts:460-513`:

- **PoW is never checked**: the headers are deserialised and stored without computing `quarkHash(header) < target`.
- **Prev-hash linkage is never checked**: the code does not verify that `headers[i].prevBlock === hash(headers[i-1])`. A malicious peer can inject an arbitrary chain of headers at any point.
- **Difficulty retargeting is never verified**: there is no equivalent of Bitcoin Core's `CheckProofOfWork` or the difficulty-adjustment window check.

**Impact**: a single malicious peer can feed the wallet a fake header chain leading to a fake "tip". Combined with a bloom filter query, the attacker could deliver fake merkle blocks whose fabricated headers reference their fake chain. Because the merkle proof only checks consistency with the fake merkle root, this allows fake "confirmed" payments to be displayed in the wallet UI.

**Fix needed**: add a `validateHeader` step that checks prev-hash linkage, target encoding, and `quarkHash < target`. Refuse to accept any header batch that does not chain onto the current tip.

### 🐛 4. No reorg detection / UTXO rewind

`maxReorgDepth: 100` is declared in `network.ts` but never read. There is no code path that:

- Detects when a peer serves a header chain that diverges from the stored tip
- Rewinds the UTXO set to the fork point
- Re-applies transactions from the new chain

**Impact**: if the wallet is online during a deep reorg, it will display stale data and may spend outputs that no longer exist on the winning chain.

### 🐛 5. BIP44 address cursors reset on every wallet init

`src/wallet/key-manager.ts:49-50`:

```ts
private nextExternalIndex = 0;
private nextChangeIndex = 0;
```

These counters are instance fields with no persistence. On every `initialize()` call the wallet pre-generates the first 20 external and 10 change addresses and resets the cursors. The database is consulted for existing addresses, but `KeyManager` itself does not know how far it had advanced previously.

**Impact**: users who have used many addresses may repeatedly receive the same "next receive address" on different launches of the app, which can be confusing, and the gap-limit scan may miss transactions sent to addresses beyond the initial window.

### 🐛 6. `validateMerkleProof` does not reject trailing flag bits

`spv-client.ts:151-229`. After the recursive traversal, the function does not check that all `flags` bits were consumed. A malicious peer could pad extra bits that the validator silently ignores. This is a low-severity spec gap (does not break the merkle root check) but should be fixed for robustness.

### 🐛 7. `base58CheckDecode` rejects 0-byte payloads

`src/core/encoding.ts:67`: the check `data.length < 5` means `base58CheckEncode(new Uint8Array(0))` produces an output that does not round-trip through `base58CheckDecode`. Low-impact — no caller actually encodes a 0-byte payload — but worth fixing for symmetry. Change the guard to `< 4` (4 bytes is the minimum: 0-byte payload + 4-byte checksum).

### 🐛 8. Empty Bloom filter matches every element

`src/p2p/bloom-filter.ts:129-137`: `contains()` returns `true` vacuously when `numHashFuncs === 0`, because the for-loop body never executes. `BloomFilter.forAddresses([])` constructs a filter with `numHashFuncs=0`, so every call to `contains()` on the resulting filter returns true. Low-impact — the SPV client only calls `forAddresses` with a non-empty address list — but worth a guard: a 0-hash-func filter should return `false` from `contains` by default.

### 🐛 9. `key-manager.ts` has a `require` statement that would be a lint error in strict ESM

Actually no such statement — re-verified. Strike this.

---

## 5. Recommended improvements (non-bug)

- **R1**: Add `saveHeaders` atomicity. Headers arrive in batches of up to 2,000. If the batch insert partially succeeds, the chain height diverges from the database. Consider wrapping in a SQLite transaction and rolling back on failure.
- **R2**: Persist known peers to SQLite. Currently `PeerManager.knownAddresses` is in-memory. A persistent peer cache would reduce reliance on DNS seeds across restarts.
- **R3**: Persist address cursors (`nextExternalIndex`, `nextChangeIndex`) to SQLite.
- **R4**: Pre-compute checkpoint hashes every few thousand blocks and hardcode them in `checkpoints.ts`. Current list has only the genesis.
- **R5**: Add a `ProtocolVersion` negotiation step — the peer sends its version, but nothing currently caps the wallet's behaviour based on that version. If a peer advertises a lower protocol version than the wallet requires, the connection should be dropped.
- **R6**: Add an `onError` logger on `PeerManager`. The current stub silently drops all errors, making debugging difficult.
- **R7**: Replace the remaining custom pure-TS hash functions (BMW, Groestl, JH, Skein) with reference implementations. `@noble/hashes` does not ship them, so this likely means vendoring a well-tested JS port like `sphlib-js` or rewriting against the SPH C reference with test vectors.
- **R8**: Add integration tests with a mock `SocketProvider`. The `SocketProvider` interface is well-designed for this; the mock infrastructure doesn't exist yet. Simulating a peer that feeds pre-captured headers + merkleblocks would validate the full sync + UTXO pipeline without requiring a real network.

---

## 6. Open questions for the user

1. **Do we need to match the FairCoin C reference for Quark hash?** If the plan is to fully validate PoW, yes — and the audit recommends R7 (replace BMW/Groestl/JH/Skein). If the plan is to trust peer-provided headers on a short chain that's checkpoint-pinned, a partial correctness is acceptable.
2. **Is the masternode / FastSend plumbing intentional dead code?** Both modules are fully wired up but not invoked. Either hook them into `wallet-store.sendTransaction` or delete them until needed.
3. **What is the expected UTXO discovery flow?** Even with bug #2 fixed, the wallet can only "see" transactions delivered by peers after the bloom filter is loaded. Catching up historical sends to a restored wallet needs either an initial rescan loop (request merkle blocks from checkpoint → tip) or a server-assisted scan. Which model does the product want?
