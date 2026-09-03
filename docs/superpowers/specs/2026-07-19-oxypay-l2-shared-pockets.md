# Oxy Pay — Layer 2: Shared Pockets between Oxy users

> **Status:** APPROVED design — OWNER-APPROVED 2026-07-19. Design approved, ready for `writing-plans`. This document is a design spec, not code and not an implementation plan.
> **Date:** 2026-07-19
> **Builds on:** `2026-07-18-oxypay-oxy-identity-social-redesign-design.md` (WS-S social identity, Pockets) and the now **testnet-confirmed** generic Layer 1 multisig in `@fairco.in/core`/FAIRWallet (`src/wallet/multisig.ts`; audit `sec-t10-audit.md`; proof `testnet-probe-result.md`).
> **Does NOT re-litigate:** L1 crypto correctness (proven), the self-custody principle (established), or WS-S's identity→FairCoin derivation (established). This document is scoped to the NEW thing L2 adds: turning a multisig address into a social, multi-Oxy-user product feature.
>
> **PREREQUISITES before implementation begins:**
> 1. **WS-S must land** (identity-pubkey resolution via `resolveDid`) — Shared Pockets has no cosigner-discovery path without it.
> 2. **The per-pocket key-derivation scheme (§2, Decision 1) needs its own mini-design + a `security-reviewer` gate** before any mainnet cosigner key is derived this way. This is a hard prerequisite, not a nice-to-have — do not implement cosigner key derivation against this spec alone.

## 1. What a Shared Pocket is

A **Shared Pocket** is an m-of-n P2SH multisig FairCoin address whose n cosigners are Oxy users, identified by `@username` and represented on-chain by a **dedicated per-pocket cosigner key** derived from their identity key (see §2, Decision 1 — NOT the bare identity pubkey). It is the social sibling of the existing single-user **Pocket** (a BIP44 account index under one person's own HD seed, `FAIRWallet/src/wallet/pockets.ts`), but the two are structurally different, not variations of the same primitive:

| | Single-user Pocket | Shared Pocket |
|---|---|---|
| Address space | BIP44 `account` index under **one** person's seed | A standalone P2SH address derived from an **n-party** redeem script |
| Reconstructible from | That one person's seed alone | The agreed `{cosigner pubkeys, threshold m}` — no single seed produces it |
| Spending authority | That person's own key, unilaterally | ≥m of n cosigners' partial signatures, combined |
| Where it lives in the UI | A tab/account inside "my wallet" | Its own entity, with its own membership, owned by no single member |

A Shared Pocket is not a BIP44 account of anybody's wallet — it has no owning HD path. Each member's contribution to it comes from their **per-pocket derived cosigner key** (§2), never the bare Oxy identity key and never a numbered Pocket in their personal wallet.

## 2. Creation & membership

**Cosigner discovery reuses WS-S, unmodified.** WS-S already resolves `oxyUserId → identity pubkey` via `resolveDid(userId)` (`@oxyhq/core`, returning a `DidDocument` whose `verificationMethod[].publicKeyHex` is the live identity pubkey). Shared Pockets use exactly this path to turn an invite list of `@username`s into a list of identity pubkeys — no new pubkey-*discovery* mechanism. What IS new is deriving the actual cosigner key from that identity pubkey (Decision 1, below).

### Decision 1 — Cosigner key: dedicated per-pocket derived key (RESOLVED)

**Approved: a dedicated per-pocket key, HKDF-derived from the identity key, domain-separated by pocket id.** Reusing the bare identity pubkey directly as the cosigner key was rejected: the SAME pubkey would appear in every Shared Pocket a user ever joins, publicly linking all of a user's shared pockets to each other on-chain (worse than WS-S's single identity↔social-receive linkage, which is one link, not O(pockets)). The dedicated derived key keeps each pocket's cosigner pubkey unlinkable from the user's others, consistent with the existing principle that the private spending tree is domain-separated from the identity key (§4.1 of the redesign spec).

**This is a hard prerequisite, not a detail to fill in during implementation.** Before any mainnet cosigner key is derived this way, the derivation scheme itself needs:
- A dedicated mini-design covering: the exact HKDF construction (hash, salt, info/domain-separation string keyed by pocket id), which key material it derives from (identity private key vs. an intermediate node), how a device re-derives the same key deterministically across reinstalls, and how this interacts with the WS-S normalized-pubkey/chain-code rules already in force.
- Its own `security-reviewer` pass — nonce hygiene and cross-protocol signing review, the same gate WS-S's identity-key reuse already requires, applied fresh to this new derivation path.

No implementation of cosigner key derivation should proceed against this spec alone; the mini-design + review above are the gate.

**Deterministic, trustless address derivation is the load-bearing requirement here, and it needs one explicit rule the L1 library does NOT provide for free — this is a top-level hard requirement, not a recommendation.** `createMultisigRedeemScript(m, pubkeys)` bakes pubkeys into the script **in the exact order given** — it does not sort or canonicalize them (`faircoin-core/src/multisig-script.ts:28-35`, doc comment: *"Pubkeys must be given in the exact order all cosigners agree on"*). If member A's device orders the list by invite sequence and member B's device orders it by acceptance timestamp, they compute two different scripts and two different addresses — a silent, catastrophic bug in the same fund-losing class the WS-S plan already flagged for chain-code normalization.

**Mandatory rule (CRITICAL correctness — every implementation MUST satisfy this):** every member's device, and the backend's own address computation for its metadata registry (Decision 2), MUST derive the redeem script from a **canonically sorted cosigner-pubkey list** — sort by pubkey hex, ascending, with no other tiebreaker — before calling `createMultisigRedeemScript`. The redeem script (and therefore the address) must be a pure function of `{sorted pubkeys, m}` so every member, and the backend, independently arrive at the byte-identical address. Getting this wrong means devices silently derive different addresses for the "same" pocket — silent fund loss, not a visible error. This is pinned as a regression vector the same way the WS-S normalized-pubkey bug was.

**Creation flow (product shape, mechanics are firm):**
1. Creator picks members by `@username` (WS-S user search, already built) and a threshold `m` — **configurable m-of-n** (Decision 3, below).
2. Each invitee's device independently resolves every cosigner's identity pubkey via `resolveDid`, derives each cosigner's per-pocket key (Decision 1), canonically sorts the resulting pubkey list, and recomputes the SAME redeem script + address the creator computed — **before** treating the invite as legitimate. A member's device is never asked to trust a backend-supplied redeem script or address at face value; it always re-derives from the pubkeys and compares.
3. Membership only becomes final once accepted parties have all independently confirmed the same derived address (their device shows it, matching what the creator's device shows) — this is the multisig-native analogue of the "shared secret confirmation" step other crypto products use to defend against a coordinator quietly substituting a pubkey.

### Decision 2 — Membership authority: backend metadata registry (RESOLVED)

**Approved: OxyPay's backend holds a metadata registry of `{cosigner set, threshold, redeem script metadata}` per pocket** — the durable answer to "which Shared Pockets is `@user` a member of," used for discovery and reinstall recovery. The registry stores metadata only: cosigner user IDs, per-pocket public keys, threshold `m`, and redeem-script/address metadata. It **NEVER** stores private key material, and it is never the source of cryptographic truth — every device treats the registry as a hint to fetch and verify, never a value to trust blindly. Every device independently re-derives and verifies the redeem script/address from the registry's stated cosigner pubkeys (§2's non-negotiable rule) before treating a pocket as legitimate; a registry entry that fails re-derivation is rejected, not trusted.

This mirrors how PaymentIntents/social-receive reservations already work backend-side and is safe precisely because the registry holds no key material — a compromised registry can mislead (denial of service, wrong invite) but cannot forge spending authority, because forged metadata fails every device's independent re-derivation check.

### Decision 3 — Threshold: configurable m-of-n (RESOLVED)

**Approved: fully configurable m-of-n at creation.** The creator sets both `n` (member count) and `m` (threshold) when forming the pocket. This carries a real UI/education burden — explaining thresholds to non-crypto-native users — that the implementation plan must budget for (e.g., sane defaults like "all must approve" for small family pockets, with configurability available but not forced on the creator).

### Decision 4 — Member key-loss resilience: no re-key in v1 (RESOLVED)

**Approved: no re-key/rotate-cosigner primitive in v1.** There is no re-key primitive in L1 today, and building one is out of scope for this spec. If a member loses their key, membership cannot be changed in place — recovery means creating a brand-new Shared Pocket with a new member set and manually migrating funds from the old address to the new one.

**This is acceptable for v1 but requires a clear, unmissable warning at pocket creation time.** The creation flow (above) MUST show every creator and every accepting member a clear warning, before the pocket is finalized, that: losing access to any one member's key/device means that member's participation in this pocket cannot be replaced, and recovering means manually migrating funds to a new pocket. This warning is a hard requirement of the creation UI, not optional copy.

### Decision 5 — Relay payload: end-to-end encrypted (RESOLVED)

**Approved: signing requests and partial signatures are end-to-end encrypted between member devices.** The OxyPay backend relay sees only opaque encrypted blobs plus routing metadata (pocket id, sender/recipient device or user id, message type) — it does **not** see the decoded recipient, amount, or fee of a proposed spend. This is a stronger privacy posture than the backend already has for merchant PaymentIntents, and it is the approved answer for Shared Pockets specifically. §5 and §6 below reflect this as the resolved behavior, not an open question.

### Decision 6 — Who may propose a spend: any member (RESOLVED)

**Approved: any member may propose a spend.** There is no "promoted member" or creator-only proposal tier. The real gate against unwanted spends is the co-sign threshold itself — a lone member proposing an illegitimate spend cannot get it past `m` signatures without genuine cosigner agreement. Relay room permissions (§5) allow any confirmed pocket member to publish a signing request to the pocket's room.

### Decision 7 — Fee attribution: from the shared pot (RESOLVED)

**Approved: L1's default stands — the transaction fee comes out of the shared pocket's own balance, like a joint account.** This resolves the mechanics with zero extra work. Per-member fee attribution ("split the check") is explicitly deferred to a future iteration and is not part of this design.

### Decision 8 — Funding model: open jar (RESOLVED)

**Approved: an open "anyone can send FairCoin to the address" jar for v1** — funding a Shared Pocket is an ordinary send with no special contribution flow (see §3). A structured, per-member ledgered contribution model (who put in how much) is explicitly deferred to a future iteration; it is a product question with no cryptographic implication either way and does not block v1.

### Decision 9 — Notifications: in-app, with expiry (RESOLVED)

**Approved: pending co-sign requests surface as an in-app notification, and every spend proposal carries an expiry.** A stale, uncollected signing request that no cosigner has acted on within its expiry window is surfaced as expired/stale in the UI rather than lingering indefinitely; the exact TTL value is an implementation-plan detail, not a design fork. (Push notification as an additional channel is not precluded by this decision but is not the approved v1 requirement — in-app notification with expiry is.)

### Decision 10 — Relay transport: existing Oxy Socket.IO infra (RESOLVED)

**Approved: reuse the existing Oxy Socket.IO infra** (`io.use(oxy.authSocket())`, room membership derived from `socket.user.id`, ownership-checked before joins) rather than standing up new dedicated infra. This is consistent with the ecosystem's "features belong in the shared SDK, no per-app new infra" principle. See §5 for the room/transport shape.

## 3. Funding

Funding a Shared Pocket is an ordinary send to its P2SH address — **open jar model (Decision 8):** any member, or anyone the address is shared with, sends FairCoin to it like any other address. There is no special "contribute" transaction type at the protocol level, and no per-member contribution ledger in v1.

Balance/UTXO visibility is symmetric and trustless: each member's device runs `registerMultisigWatchAddress` (already implemented, `multisig.ts:36-47`) locally, exactly as it would for any multisig address it is a cosigner of — this persists the address + redeem script in the member's OWN local database and registers it with their OWN SPV bloom filter. No member depends on another member, or on the backend, to see the pocket's balance; every device that knows the cosigner set can independently watch and compute it. This is the same mechanism L1 proved end-to-end on testnet (the probe used the identical `registerMultisigWatchAddress` → SPV path).

## 4. Spending (the core flow)

This is where L2's only genuinely new machinery lives: distributing a partial-signing request between multiple Oxy users' devices and collecting responses asynchronously — something L1's testnet probe deliberately did NOT exercise (it hand-passed the request between two in-process signers).

1. **Propose.** **Any member (Decision 6)** may build a spend on their device: pick recipient + amount from the pocket's own watched UTXO set, `buildMultisigSendDraft` → `exportSigningRequest` (`multisig.ts:120-141`). The exported `SerializedMultisigSigningRequest` carries the unsigned tx, input index, and redeem script — no key material, ever.
2. **Distribute.** The signing request is end-to-end encrypted (Decision 5) and sent to the other cosigners (or the (m−1) needed, if the proposer's own signature counts as the first partial) via the social/relay layer (§5). It carries an expiry (Decision 9).
3. **Decode & confirm (M2 — mandatory, not optional).** Each receiving cosigner's device decrypts the request and calls `decodeMultisigSpend(serializedRequest, inputValues, network)`. Per the L1 audit's M2 finding, `inputValues` **must** be sourced from that device's own confirmed UTXO set (from its own §3 watch registration), keyed by the request's input outpoints — never trusted from the proposer or the relay, since a malicious coordinator could otherwise understate the fee. The device then shows the decoded `MultisigSpendSummary` (recipient(s), amounts, fee) and requires explicit user confirmation before signing — exactly the not-yet-built UI the audit says is where 100% of the real-money risk concentrates.
4. **Partial-sign.** On confirmation, `signMultisigSendRequest` produces a `SignedMultisigPartial` — only `{pubkey, DER signature}` leaves the device, end-to-end encrypted (Decision 5) to the collecting device (the proposer's device, by default the natural collector since it initiated the request and receives responses back) and sent through the relay.
5. **Collect & finalize — on the proposer's device, not the backend.** Once the proposer's device holds ≥m valid decrypted partials (`verifyPartialSignature` rejects any that don't verify over the correct sighash), it calls `finalizeMultisigSend(draft, signatures)` locally to assemble the scriptSig and produce the raw tx + txid. **This step needs no private key** — `assembleMultisigScriptSig`/`serializeTransaction`/`verifyPartialSignature` are pure functions over public data — which is precisely why it is safe to perform on an ordinary member's device rather than requiring a trusted third party. The OxyPay backend never decrypts or aggregates partials itself: because Decision 5 end-to-end-encrypts partials between member devices, the backend only ever sees opaque encrypted blobs in transit. The backend's role is a pure relay up through this step; it receives the finished raw transaction only after finalize has already happened on a member's device (§6). This is a strictly narrower backend role than a design where the backend itself aggregates partials, and it still preserves the underlying security property that the earlier draft of this section relied on — finalizing from valid partials is not a capability that requires a key, only producing a NEW valid partial does, and the backend could never do that even if it did see plaintext partials.
6. **Broadcast.** The proposer's device submits the finished raw transaction to the backend for broadcast — at this point the transaction is fully signed and about to become public on the network anyway, so handing it to the backend leaks nothing that broadcasting itself wouldn't. Same broadcast path every single-user wallet already uses (testnet-proven: `SPVClient.broadcastTransaction`). Whether OxyPay's server-side broadcast goes through its own P2P/SPV connection or the Explorer node it already integrates with for other server-side chain reads is an implementation detail, not a design fork.
7. A signature is cryptographically bound to the exact sighash it was produced over (tx + input + redeem script). This means a coordinator — malicious or buggy — physically cannot reassemble collected partials into a scriptSig for any transaction other than the one every signer actually saw and confirmed in step 3. Post-collection tampering is not a residual risk to design around; it is closed by the math, and the L1 audit already reviewed this assembly path.

**Inherited L1 constraint, not a new L2 limitation:** `buildMultisigSendDraft`/`finalizeMultisigSend` support exactly ONE multisig UTXO per spend today (multi-input multisig spends are explicitly out of scope in L1). A Shared Pocket that accumulates many small incoming UTXOs will eventually need either a consolidation step or L1 gaining multi-input support before a large spend is possible in one go. Flagging this so it isn't a surprise later — it's a dependency, not a decision for this doc.

## 5. The social/relay layer (OxyPay-only)

This is the layer that does not exist in FAIRWallet/L1 at all — L1 has no concept of "another Oxy user," only cryptographic cosigners a caller already has an out-of-band channel to. L2 IS that out-of-band channel, built on Oxy's existing social/identity infrastructure rather than anything new:

- **Transport (Decision 10 — RESOLVED):** the existing Oxy Socket.IO infra (`io.use(oxy.authSocket())`, room membership derived from `socket.user.id`, ownership-checked before joins — per the ecosystem's standing socket rules) is the transport for online delivery of signing requests and partials, scoped to a room keyed by the pocket id with membership enforced server-side against the pocket's actual cosigner set (Decision 2's registry). Any confirmed pocket member may publish to the room (Decision 6). Offline/backgrounded cosigners need a durable side channel too — an in-app pending-request inbox the device drains on next open (Decision 9) — since co-signing is inherently asynchronous and a spend proposal may sit for hours waiting on a cosigner who isn't online, up to the request's expiry.
- **What the relay sees, precisely (Decision 5 — RESOLVED as end-to-end encrypted):** the pocket's cosigner set (userId↔per-pocket-pubkey linkage, which it already knows from creation/§2 and the Decision 2 metadata registry), and opaque end-to-end encrypted blobs for each signing request and each partial signature — it relays these without decrypting either. The backend does **not** see the decoded recipient, amount, or fee of a proposed spend, and does not see individual partial signatures in plaintext either (collection and finalize happen on the proposer's device, §4.5) — a strictly narrower visibility than merchant PaymentIntents get today. It does see routing metadata: which pocket, which round, which member sent/received a given encrypted blob, and timing. The one thing it eventually sees in the clear is the fully-assembled, fully-signed raw transaction handed to it for broadcast (§4.6) — by that point the transaction is about to become public on the network, so this leaks nothing beyond what broadcasting itself reveals.
- **What the relay can never do, structurally:** produce a valid partial signature (no cosigner private key ever reaches it), lower the effective threshold, or redirect a spend to a different recipient post-signing (§4.7). It is a message router and a broadcaster of already-finalized transactions — never an aggregator of partials (that role moved to the proposer's device, §4.5, once Decision 5 was resolved) and never a signer.
- **Contrast with L1:** L1 is generic and has no delivery mechanism opinion at all — the testnet probe manually handed the signing request between two in-process signers. L2's entire contribution is "how do two Oxy users' devices, that have never met, reliably exchange this request and these partials" — everything cryptographic underneath is unchanged L1.

## 6. Trust & security model

**Self-custody invariant, extended not weakened.** No single member, and — critically — **no OxyPay entity**, can move funds below the threshold. This is the same guarantee the single-user wallet already gives (§2.1 of the redesign spec), generalized from "1 of 1" to "m of n." The backend's role in §4-5 (relay encrypted requests/partials, then broadcast the finished transaction handed to it by the proposer's device) requires zero private key material at any point; it is architecturally identical to a payment coordinator relaying already-signed authorizations, not a party that could ever produce one. The backend is structurally a **keyless relay and broadcaster** — it cannot forge a signature or redirect a spend under any circumstance; the worst case it can cause is grief/denial-of-service, never theft.

**Malicious relay (compromised or malicious OxyPay backend):**
- *Cannot:* forge a signature, steal funds, alter a spend after signing (§4.7), or spend below threshold.
- *Can:* refuse to relay a signing request or a partial (denial of service — the spend simply never reaches threshold and never finalizes; **funds are not lost, only stuck**, and members can retry or fall back to an out-of-band channel to exchange the serialized request manually since it is just data). With Decision 5's end-to-end encryption resolved and approved, the backend can no longer observe decoded spend metadata (amounts, recipients) even if compromised — only routing metadata (cosigner sets, pocket ids, timing) remains visible to it.

**Malicious or compromised cosigner (holds one real key, below threshold):**
- *Cannot:* unilaterally spend, forge another member's signature, or change the agreed cosigner set/threshold after the address is derived (there is no re-key primitive in L1 today, and Decision 4 confirms v1 does not add one — key loss/compromise means manual migration to a new pocket, not in-place recovery).
- *Can:* refuse to co-sign (griefing/liveness risk, not theft) — an m-of-n scheme fundamentally needs `n − m + 1` honest, available signers per spend, so a hostile or simply unresponsive minority can block spends requiring their cooperation without ever putting funds at risk of theft.

**MiCA / legal self-custody firewall.** The invariant the whole OxyPay product rests on — the platform never crosses the signing threshold — holds for Shared Pockets exactly as it does for the single-user wallet: OxyPay/the gateway is structurally a relay + indexer, never a party that can independently produce a valid authorization to move funds. This holds regardless of the Decision 2 metadata registry (metadata only, no keys) and is strengthened, not weakened, by Decision 5's end-to-end encryption. This should be called out explicitly to the owner as the property that keeps L2 inside the same regulatory posture as L1, not a new exposure.

**What this design does NOT yet close (inherited, not new):** the L1 audit's M2 finding — "anti-blind-signing is only as strong as the not-yet-built spend UI" — applies with full force to the Shared Pocket co-sign screen, which is new UI that does not exist yet. Everything in §4.3 is a hard requirement carried over from that audit, not a nice-to-have.

## 7. Decisions — summary (all RESOLVED, owner-approved 2026-07-19)

| # | Decision | Resolution |
|---|---|---|
| 1 | Cosigner key derivation | Dedicated per-pocket derived key (HKDF from identity key, domain-separated by pocket id). **Hard prerequisite:** needs its own mini-design + `security-reviewer` gate before mainnet. |
| 2 | Membership authority | Backend metadata registry (cosigner set + threshold + redeem script metadata only, never keys); every device re-derives and verifies, never trusts blindly. |
| 3 | Threshold UX | Fully configurable m-of-n at creation. |
| 4 | Member key-loss resilience | No re-key in v1; manual fund migration to a new pocket. Mandatory clear warning at pocket creation. |
| 5 | Relay payload encryption | End-to-end encrypted signing requests and partials; backend sees only routing metadata, never decoded recipient/amount/fee. |
| 6 | Who may propose a spend | Any member; the co-sign threshold is the real gate. |
| 7 | Fee attribution | From the shared pocket's own balance (joint-account model); split-the-check is future work. |
| 8 | Funding model | Open jar — anyone can send to the address; structured contribution ledger is future work. |
| 9 | Notification UX | In-app notification for pending co-sign requests, with an expiry on each request. |
| 10 | Relay infra | Existing Oxy Socket.IO infra; no new dedicated infra. |

**Note on a contradiction resolved during finalization of this spec:** an earlier draft of §4.5 assumed the OxyPay backend itself would collect and finalize partials as a keyless aggregator. That is incompatible with Decision 5 (partials end-to-end encrypted between member devices, backend sees only opaque blobs) — the backend cannot aggregate what it cannot decrypt. This spec resolves the conflict by moving collection/finalize to the proposer's device (§4.5, §5): the proposer decrypts returned partials, finalizes locally once ≥m are valid, and hands the backend only the fully-signed raw transaction for broadcast. The backend's "needs no key to complete a spend" property is preserved as a security argument (§4.5, §6) even though in practice the backend no longer performs that step.
