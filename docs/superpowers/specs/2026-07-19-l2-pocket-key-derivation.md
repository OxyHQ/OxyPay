# Oxy Pay L2 — Per-Pocket Cosigner Key Derivation (mini-design)

> **Status:** MINI-DESIGN — the one prerequisite the approved L2 spec (Decision 1) flagged before any cosigner key is derived. NOT code, NOT an implementation plan.
> **Date:** 2026-07-19
> **Gate:** This scheme MUST pass a dedicated `security-reviewer` pass before any **mainnet** cosigner key is derived. Testnet derivation may proceed against this design once reviewed at the design level; mainnet is blocked on the reviewer sign-off AND on WS-S's F-1 (see §7).
> **Parent:** `2026-07-19-oxypay-l2-shared-pockets.md` (owner-approved) §2, Decision 1.
> **Builds on:** WS-S's landed social-receive scheme (`@fairco.in/core` `src/social-receive.ts`), `@oxyhq/core` `KeyManager.deriveScopedSeed` / `crypto/kdf.ts` / `crypto/ecdh.ts` / `crypto/aead.ts`, and the testnet-proven L1 multisig in `@fairco.in/core` (`multisig-script.ts`) + `FAIRWallet/src/wallet/multisig.ts`.

---

## 0. TL;DR

Each member derives a **dedicated per-pocket cosigner keypair** from their Oxy identity via the **one-way** `KeyManager.deriveScopedSeed(info)` HKDF (the app never touches the raw identity private key), domain-separated by `pocketId` + network + a scheme-version tag, then expands that seed into a secp256k1 keypair with `@scure/bip32`'s `HDKey.fromMasterSeed`. Only the **compressed public key** is shared — published to the backend metadata registry as a **self-attested** entry signed by the member's identity key. The n cosigner pubkeys are combined in **BIP67 lexicographic order** (a single shared `@fairco.in/core` helper both devices AND the backend call) so every party derives the byte-identical redeem script and P2SH address.

**Why this is strictly safer than WS-S's social-receive branch:** WS-S had to reuse the identity key's EC point directly (payers derive receive addresses from the recipient's *public* identity key over a *public* chain code → non-hardened BIP32 → the F-2 "leaked child key recovers the identity master key" exposure, owner-accepted under a "never export a child key" guarantee). L2 has **no such constraint**: no external party ever derives a member's cosigner key — the member computes it themselves and shares only the resulting public key — so the derivation can go through a **one-way HKDF** (`deriveScopedSeed`) instead of a reversible EC-point reuse. A leaked per-pocket private key reveals **nothing** about the identity master key, and the per-pocket key is never used for DID signing, so L2 also **removes** the one cross-protocol signing surface WS-S carried.

---

## 1. Requirements (from the approved spec, Decision 1)

The derivation MUST be:

1. **Deterministic across reinstall** — a member re-deriving from the same Oxy identity + same `pocketId` gets the byte-identical keypair, so a fresh install can rejoin an existing pocket and sign, with no server-held key material.
2. **Unlinkable across pockets on-chain** — a user's cosigner pubkey in pocket X reveals nothing about their pubkey in pocket Y to a chain observer. (Contrast: reusing the bare identity pubkey would place the SAME key in every pocket, publicly linking all of a user's shared pockets — the exact linkage Decision 1 rejected.)
3. **Non-leaking of the identity master key** — exposure of a per-pocket private key (it signs real spends and its partial signatures traverse the relay, so "never expose it" is NOT an available assumption here) MUST NOT allow recovery of the Oxy identity private key. This is the hard "do not reintroduce or worsen F-2" constraint.
4. **Public-key shareable without exposing anything** — cosigners exchange only the compressed cosigner public key to build the redeem script; nothing private, and nothing that lets a third party impersonate a member.
5. **Canonically ordered** — the n cosigner pubkeys are combined in one agreed order (BIP67), so every member and the backend independently arrive at the same address (§2's hard correctness requirement).

---

## 2. The derivation scheme

### 2.1 Inputs

| Symbol | Meaning | Where it comes from |
|---|---|---|
| `IK_priv` | Member's Oxy identity secp256k1 private key (32 bytes) | On-device only. **Never handled directly** — accessed solely through `KeyManager.deriveScopedSeed` (the app receives an HKDF output, not the raw key). |
| `pocketId` | The pocket's globally-unique identifier | Backend-minted 128-bit random id (`SharedPocket.id`), learned by every member from the metadata registry (Decision 2). A **domain separator**, not a secret (see §5.7). |
| `network` | `"mainnet"` \| `"testnet"` | Local wallet network. Bound into the domain string so a testnet and mainnet pocket of the same id can never collide. |
| `SCHEME_VERSION` | `"v1"` | Constant, so a future scheme change is a new, non-colliding domain. |

### 2.2 Derivation (each member, on-device)

```
info        = "oxypay/faircoin/pocket-cosigner/" + SCHEME_VERSION + ":" + network + ":" + pocketId
pocketSeed  = KeyManager.deriveScopedSeed(info)
              // @oxyhq/core, native-only. Internally:
              //   HKDF-SHA256(ikm = IK_priv,
              //               salt = "oxy-identity-scoped-seed-v1",   // SDK-fixed, existing
              //               info = <the string above>,
              //               L    = 32)
              // Returns a 32-byte domain-separated seed. The app never sees IK_priv.
cosigner    = deriveMultisigCosignerKeypair(pocketSeed)
              // @fairco.in/core (new thin helper, §3). = HDKey.fromMasterSeed(pocketSeed),
              //   returns { privateKey: 32B, publicKey: 33B compressed }.
cosignerPriv = cosigner.privateKey     // on-device only, used to sign multisig partials
cosignerPub  = cosigner.publicKey      // 33-byte COMPRESSED — the only value shared
```

**Two stages, both one-way, on purpose:**
- **Stage 1 (`deriveScopedSeed` = HKDF-SHA256 keyed on `IK_priv`)** is the identity-key firewall: HKDF is a PRF, so `pocketSeed` (and anything derived from it) is computationally independent of `IK_priv` — you cannot invert it to recover the identity key. This is what closes the F-2 class for L2 (requirement 3). Reusing the ALREADY-SHIPPED `deriveScopedSeed` means **no `@oxyhq/core` change** and means the raw identity key never crosses the package boundary into OxyPay (unlike WS-S's social-receive, which by necessity read `getPrivateKey()`/`getSharedPrivateKey()` directly).
- **Stage 2 (`HDKey.fromMasterSeed`)** expands the 32-byte seed into a valid secp256k1 keypair using `@scure/bip32`'s already-audited master-key derivation (`I = HMAC-SHA512("Bitcoin seed", pocketSeed)`, `I_L` validated in `[1, n-1]`). Reusing this proven primitive avoids hand-rolling scalar rejection-sampling and matches the existing ecosystem pattern (`KeyManager.fromSeed` → `HDKey.fromMasterSeed` for the spending tree). The compressed public key is `@scure/bip32`'s canonical 33-byte encoding.

Determinism (requirement 1) is immediate: same `IK_priv` + same `info` → same `pocketSeed` → same keypair. Unlinkability (requirement 2) follows from HKDF: two different `pocketId`s yield independent seeds → independent, uncorrelated pubkeys on-chain.

> **Design note — why NOT the WS-S social-receive scheme:** WS-S builds `xprv_social = HDKey({ privateKey: IK_priv, chainCode: HMAC(IK_pub) })` then **non-hardened** `deriveChild(i)`. Because the chain code is public and the child is non-hardened, `{ parent xpub, any child privkey } → parent privkey` (BIP32's well-known non-hardened weakness = F-2). L2 must NOT copy this. The reason WS-S *had* to is that the **payer** derives receive addresses from the recipient's *public* identity key with no interaction — an inherently public-derivable, reversible construction. L2 has no payer-derives-your-key requirement: the member derives their own key and hands out only the public result, so L2 uses the one-way HKDF path that WS-S could not. Hardened-vs-non-hardened is moot here because the parent (`pocketSeed`) is already an HKDF output, not the identity key.

### 2.3 Sharing the public key (self-attested)

A member publishes to the backend registry (Decision 2) a `SharedPocketMember` entry:

```
{
  pocketId,
  userId,
  network,
  cosignerPubHex,          // 33-byte compressed, hex
  attestation: sign_identity( canonicalize({ pocketId, userId, network, cosignerPubHex }) )
                            // signed with the member's IDENTITY key (KeyManager / SignatureService),
                            // verifiable via their DID (resolveDid → identity pubkey)
}
```

The `attestation` binds `identity(userId) ⇒ cosignerPubHex`. Every other member, before trusting the entry, resolves the member's DID (the WS-S `resolveIdentityPublicKey` path, unchanged) and verifies the signature. This is what prevents a malicious member or coordinator from planting a pubkey they control into another member's slot (§5.2).

### 2.4 Building the address (canonical sort — HARD correctness requirement)

`createMultisigRedeemScript(m, pubkeys)` bakes pubkeys into the script **in the exact order given** — it does NOT sort (`faircoin-core/src/multisig-script.ts:37`, doc comment: *"Pubkeys must be given in the exact order all cosigners agree on"*). If two devices order the cosigner set differently, they compute different scripts → different addresses → **silent fund loss**, the same class the WS-S plan pinned for chain-code normalization.

**Mandatory rule:** the n cosigner pubkeys are ordered by **BIP67** — lexicographic ascending comparison of the 33-byte **compressed** encodings as unsigned byte sequences (equivalently: hex-string ascending; no tiebreaker, since a pubkey collision is cryptographically impossible). Then, and only then, `createMultisigRedeemScript(m, sortedPubkeys)`.

To make divergence structurally impossible rather than merely documented, the sort + build is a **single shared function** — `buildSortedMultisigRedeemScript(m, pubkeys)` in `@fairco.in/core` (§3) — imported and called identically by:
- every member's device (to derive + verify the pocket address before accepting an invite), and
- the backend's own address computation for the metadata registry (Decision 2 requires the backend to re-derive from the same sorted list).

The redeem script — and therefore the address — is thereby a pure function of `{ sorted pubkeys, m }`, byte-identical for everyone. BIP67 is the industry-standard precedent (Bitcoin's "deterministic P2SH multisig addresses through public key sorting"), so this is a well-trodden construction, not a bespoke ordering.

### 2.5 Address confirmation (trustless membership)

Per the spec's creation flow, a member's device NEVER trusts a backend-supplied address or redeem script at face value. On invite it: resolves every cosigner's identity pubkey (`resolveDid`), verifies each member's §2.3 self-attestation, takes the registry's `cosignerPubHex` set, runs `buildSortedMultisigRedeemScript` + `multisigAddress` locally, and confirms the result equals what the creator's device shows and what the registry stores. A registry entry that fails re-derivation or attestation is **rejected, not trusted** (Decision 2). Membership is final only once all accepting parties independently confirm the same derived address — the multisig-native analogue of a shared-secret confirmation defending against a coordinator quietly substituting a pubkey.

---

## 3. Where the code lives (package boundaries)

Following the established WS-S split (generic crypto in `@fairco.in/core`, identity-key ACCESS in `@oxyhq/core`, Oxy glue in OxyPay):

- **`@oxyhq/core` — NO CHANGE.** `KeyManager.deriveScopedSeed(info)` already exists and takes an arbitrary `info` string (`packages/core/src/crypto/keyManager.ts:2624`). L2 passes a pocket-scoped `info`; the SDK does the HKDF. `deriveSharedSecret` (ECDH), `encryptAead`/`decryptAead`, `hkdfSha256`, and the identity signing/`resolveDid` surface used for §2.3 attestation + §5's relay encryption are ALL already published. `@oxyhq/core` must stay platform-agnostic and never import `@fairco.in/core`.
- **`@fairco.in/core` — two tiny new helpers** (generic secp256k1, zero Oxy dependency, published in one bump; coordinate with any concurrent `feat/multisig` work in that repo):
  - `deriveMultisigCosignerKeypair(seed: Uint8Array): { privateKey: Uint8Array; publicKey: Uint8Array }` — `HDKey.fromMasterSeed(seed)` → `{ privateKey (32B), publicKey (33B compressed) }`. Centralizes the compressed-encoding guarantee (mirrors how `publicKeyFromPrivateKey` was added for social-receive).
  - `buildSortedMultisigRedeemScript(m: number, pubkeys: Uint8Array[]): Uint8Array` — BIP67-sorts the compressed pubkeys, then calls the existing `createMultisigRedeemScript(m, sorted)`. The single source of truth for the §2.4 ordering, called by frontend AND backend.
- **OxyPay** — the Oxy-specific glue: passes the pocket-scoped `info` to `deriveScopedSeed`, calls the two `@fairco.in/core` helpers, signs/verifies the §2.3 identity attestation, and drives the registry + relay. No divergent reimplementation of any primitive.

---

## 4. Interaction with the existing multisig + social plumbing

- **Cosigner discovery reuses WS-S unmodified.** `resolveDid(userId) → verificationMethod[].publicKeyHex` (`resolveIdentityPublicKey`, `backend/src/services/socialReceive.ts:31`) turns an `@username` invite list into identity pubkeys — used here to (a) verify each member's §2.3 attestation and (b) key the §5 relay encryption. No new pubkey-discovery mechanism.
- **The derived keypair feeds the proven L1 path unchanged.** `cosignerPub` → `buildSortedMultisigRedeemScript` → `createMultisigRedeemScript`/`multisigAddress`/`registerMultisigWatchAddress`; `cosignerPriv` → `signMultisigInput` (inside `signMultisigSendRequest`). L1 is generic over "some secp256k1 cosigner keypair" — this design just specifies *which* keypair and *what order*.
- **Normalization already handled.** `createMultisigRedeemScript` validates pubkeys are 33 or 65 bytes; our helper always feeds 33-byte compressed keys from `@scure/bip32`, so there is no compressed/uncompressed ambiguity of the kind WS-S's chain-code HMAC had to normalize.

---

## 5. Threat model (for the mandatory `security-reviewer` gate)

Enumerated so the reviewer has an explicit checklist. Items 1–3 are the ones Decision 1 specifically demanded; 4–7 are the surrounding surface.

**5.1 Leaked per-pocket private key.**
- *Recovering the identity master key:* **Not possible.** `cosignerPriv` is `HDKey.fromMasterSeed(HKDF-SHA256(IK_priv, …))` — two one-way functions between it and `IK_priv`. This is the primary improvement over WS-S F-2 and MUST be the reviewer's first confirmation.
- *Recovering the member's other pockets' keys:* Not possible — each pocket's seed is an independent HKDF output (different `info`).
- *Spending:* A leaked single key still only produces ONE partial. Funds move only at ≥m signatures, so one leaked key below threshold cannot spend (self-custody invariant, spec §6).

**5.2 Malicious member / malicious coordinator substitutes a pubkey.**
- Threat: in a 2-of-3 `{A,B,C}`, malicious A registers `{A, A', C}` (A' a second key A controls) to hold two of the three slots and self-lower the threshold to A alone.
- Defense: **per-member identity attestation (§2.3)** — each `cosignerPubHex` is signed by that member's identity key and verified by every other device against the member's DID. A cannot forge B's slot because A cannot sign as B. Combined with the **address-match confirmation (§2.5)**, this closes both "substitute to change the address" and "substitute to lower the threshold." The reviewer should confirm both checks are enforced before a device treats a pocket as active.

**5.3 Malicious / compromised backend registry.**
- The registry holds metadata only — cosigner user ids, per-pocket **public** keys, threshold, redeem-script/address metadata — and **never** private key material (Decision 2). A compromised registry can mislead (DoS, wrong invite, withheld entry) but cannot forge spending authority: forged metadata fails every device's independent re-derivation (§2.5) AND the §2.3 attestation check. Worst case is grief/DoS, never theft (spec §6). This preserves the MiCA self-custody firewall.

**5.4 Key rotation (interaction with WS-S F-1).**
- If a member rotates their Oxy identity key, `deriveScopedSeed` yields a DIFFERENT `pocketSeed` → a different cosigner key. The pocket's redeem script still references the OLD `cosignerPub`, so the rotated member can no longer sign — the same fund-stranding class as F-1, and **Decision 4 (no re-key in v1)** means there is no in-place fix: a rotated (or lost-key) member forces a manual migration to a new pocket.
- **Requirements this places on the implementation:**
  1. Record, at pocket creation, enough to detect a later rotation (e.g. persist the identity-pubkey fingerprint the pocket was derived against), so the device can surface *"you rotated your Oxy key — this pocket must be migrated"* rather than silently deriving a wrong key and appearing to "lose" funds.
  2. Treat a detected rotation exactly like Decision 4's key-loss path (migration + the mandatory creation-time warning).
- **Inherited blocker:** L2's derivation reads the identity key through the SAME source as WS-S (`deriveScopedSeed` → `getSharedPrivateKey() ?? getPrivateKey()`), so **L2 inherits WS-S's F-1 verbatim and stays testnet-only until F-1 is fixed upstream in the identity-vault v2 session.** This is a hard mainnet prerequisite alongside the reviewer gate.

**5.5 Cross-protocol / nonce hygiene.**
- The per-pocket key signs FairCoin sighashes via `signMultisigInput` (`@noble/secp256k1` deterministic RFC6979, low-S normalized — `multisig-sign.ts:79`). It is a **fresh key never used for DID signing**, so — unlike WS-S's social-receive branch, which reused the identity EC point and therefore required a cross-protocol/nonce-reuse review — L2 has **no shared-key cross-protocol surface at all**. The reviewer should confirm the per-pocket key is used ONLY for multisig ECDSA and never for identity/DID operations, making this a net reduction in cross-protocol exposure vs WS-S.

**5.6 Relay-layer key use (E2E encryption — see the L2 plan, Decision 5).**
- Signing requests + partials are E2E-encrypted device-to-device using the ecosystem's sanctioned pattern: `deriveSharedSecret(myIK_priv, theirIK_pub)` (ECDH, `@oxyhq/core/crypto/ecdh.ts`, already used for Commons device transfer) → `hkdfSha256` with a relay-context `info` → `encryptAead`/`decryptAead` (XChaCha20-Poly1305), with `aad` binding `{pocketId, messageType, round}` to prevent cross-pocket/cross-round replay. This reuses the **identity** key for ECDH (encryption, not signing — no signing-oracle exposure) and keeps the per-pocket **signing** key single-purpose. The reviewer should confirm the relay never sees plaintext spend metadata and that the ECDH context binding is present.

**5.7 Weak / attacker-chosen `pocketId`.**
- `pocketId` is a **domain separator**, whose only security requirement is **uniqueness per pocket** (so a user's keys don't collide across their own pockets) — NOT secrecy or unpredictability. A backend-minted random 128-bit id satisfies uniqueness. A malicious backend that reuses an id only causes that member to reuse their OWN cosigner key for two pockets (a minor unlinkability regression for that user, not a key compromise) and gains nothing, since it still cannot compute any `cosignerPub` (that needs `IK_priv`, behind HKDF). The reviewer should confirm no security property is assumed of `pocketId` beyond uniqueness.

---

## 6. Residual risks (documented, not closed here)

- **Unlinkability is best-effort, not perfect.** On-chain the cosigner pubkeys are unlinkable, but the backend registry (Decision 2) necessarily knows the `userId ⇒ cosignerPub ⇒ pocket` mapping to serve discovery. This is the accepted Decision 2 trade-off (metadata registry), not a derivation flaw. A user wanting stronger unlinkability from the backend is out of scope for v1.
- **M2 anti-blind-signing** (the co-sign UI showing the decoded spend before the per-pocket key signs) is a UI requirement carried in the L2 plan, not this derivation doc — but the per-pocket key's whole value depends on it, so it is called out here as a linked hard requirement.
- **Standard self-custody residuals** apply unchanged (unlocked device + app access → spend; lost device + lost recovery phrase → unrecoverable).

---

## 7. Gate summary (blocking, before mainnet)

1. **`security-reviewer` pass** on this scheme — nonce hygiene, the §5 threat model, and specifically confirming §5.1 (no identity-master-key recovery) and §5.5 (no cross-protocol reuse). Same gate WS-S's identity-key reuse required, applied fresh to this new derivation path.
2. **WS-S F-1 fixed + re-verified** upstream (identity-vault v2) — L2 inherits it via the shared identity-key source (§5.4).

Until both clear, L2 shared-pocket derivation is **testnet-only**.
