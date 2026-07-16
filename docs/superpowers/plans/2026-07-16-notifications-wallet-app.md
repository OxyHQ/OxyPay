# Notifications — FAIRWallet App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let FAIRWallet receive background payment notifications by registering its watch-only xpub with a (user-chosen) Explorer, handling silent pushes on-device, and exposing privacy controls.

**Architecture:** On unlock (when enabled), the app registers `{ accountXpub, gapLimit, deviceToken, confirmations, events }` with the configured notification server. A silent FCM/APNS push wakes the app headless; it syncs that `txid` and posts a **local** notification (reusing the existing `transactions` channel + `received.mp3`). Privacy is a server-URL dial (official Explorer / self-hosted / off).

**Tech Stack:** Expo SDK 55, React Native 0.83, `expo-notifications`, Zustand, NativeWind 5 + Bloom. Depends on the Explorer backend plan's wire contract.

## Global Constraints

- Repo: `~/FairCoinWorkspace/FAIRWallet`. Tests: `bun test src`. Types: `bun run typecheck`.
- Package manager: **bun** (`--offline` if resolve hangs); commit `bun.lock` with `package.json`.
- Wire contract (from the Explorer plan, spec §4.1): `POST /api/notifications/register` `{ xpub, scriptType:"p2pkh", gapLimit, network, deviceToken, platform, confirmations, events }` → `{ subscriptionId, watchedTo }`; `DELETE` `{ subscriptionId }`.
- Default server URL: `https://explorer.fairco.in`. User-editable in Settings.
- Registration MUST work while the wallet is **PIN-locked** (uses only the watch-only xpub — never a private key).
- Push payloads never contain amounts — text is composed on-device from the synced tx.
- Repo standards: no `any`/`@ts-ignore`/`!`/silent `catch {}`; NativeWind classes over inline styles; reuse existing `notifications.ts` (do not fork it).

---

### Task 1: Expose the account xpub

**Files:**
- Modify: `src/wallet/key-manager.ts`
- Test: `src/wallet/key-manager.test.ts` (add a case; create if absent)

**Interfaces:**
- Produces: `KeyManager.accountXpub(): string` (the `m/44'/119'/0'` public extended key).

- [ ] **Step 1: Write failing test** — `KeyManager.fromMnemonic(FIXED_MNEMONIC, MAINNET).accountXpub()` returns a stable string starting with the FairCoin xpub prefix, and `KeyManager.fromXpub(thatXpub, MAINNET).getAddress(0)` equals `fromMnemonic(...).getAddress(0)` (round-trip).
- [ ] **Step 2: Run `bun test src/wallet/key-manager.test.ts`, verify fail.**
- [ ] **Step 3: Implement** — `accountXpub(): string { const x = this.accountKey.publicExtendedKey; if (!x) throw new Error("no extended public key"); return x; }`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(wallet): expose account xpub for watch-only registration"`.

---

### Task 2: Notification settings store + server client

**Files:**
- Create: `src/services/notification-settings.ts` (persisted prefs via existing `kv-store`)
- Create: `src/services/notification-server.ts` (HTTP register/unregister)
- Test: `src/services/notification-server.test.ts`

**Interfaces:**
- Produces (settings): `getNotificationPrefs(): Promise<{ enabled: boolean; serverUrl: string; confirmations: number; events: string[] }>`, `setNotificationPrefs(patch)`. Defaults: `enabled:false`, `serverUrl:"https://explorer.fairco.in"`, `confirmations:1`, `events:["incoming_pending","incoming_confirmed","outgoing_confirmed"]`.
- Produces (client): `registerForPush(input: { serverUrl; xpub; gapLimit; network; deviceToken; platform; confirmations; events }): Promise<{ subscriptionId: string }>`, `unregisterFromPush(serverUrl, subscriptionId): Promise<void>`.

- [ ] **Step 1: Write failing test** — mock `fetch`; `registerForPush(...)` POSTs to `${serverUrl}/api/notifications/register` with the exact contract body and returns the parsed `subscriptionId`; non-200 throws; `unregisterFromPush` DELETEs. Assert the body contains **no** private key field.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** both files. `serverUrl` is normalized (strip trailing `/`). Persist `subscriptionId` via `kv-store` keyed by wallet id.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(notifications): prefs store + server client"`.

---

### Task 3: Push token + registration lifecycle

**Files:**
- Create: `src/services/push-registration.ts`
- Modify: `app/_layout.tsx` (start the lifecycle alongside `startSyncNotifier()`)
- Test: `src/services/push-registration.test.ts`

**Interfaces:**
- Consumes: `accountXpub` (Task 1), prefs + client (Task 2), `getDevicePushTokenAsync` (`expo-notifications`).
- Produces: `startPushRegistration()` — subscribes to wallet-store + prefs; when `enabled && wallet present` → acquire token, `registerForPush`, store `subscriptionId`; when disabled/deleted → `unregisterFromPush`. Idempotent. Re-registers on token rotation / confirmations change / wallet switch.

- [ ] **Step 1: Write failing test** — with prefs `enabled:true` and a mock wallet exposing `accountXpub()`, `startPushRegistration()` calls `registerForPush` once with the wallet's xpub + a mocked device token; flipping prefs to `enabled:false` calls `unregisterFromPush`. Assert registration path does **not** require unlock (uses xpub only).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Acquire token via `Notifications.getDevicePushTokenAsync()` (`platform` from `Platform.OS`). Guard: skip on web/electron (no native module). Debounce duplicate registrations (compare a hash of the payload; skip if unchanged, like `sync-notifier`'s throttle pattern).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Wire** `startPushRegistration()` in `app/_layout.tsx` (module scope, next to `startSyncNotifier()`), then `bun run typecheck`.
- [ ] **Step 6: Commit** — `git commit -m "feat(notifications): device token + registration lifecycle"`.

---

### Task 4: Silent-push handler → sync → local notification

**Files:**
- Modify: `src/services/notifications.ts` (add the received-notification path already exists; add a `handleSilentPush(txid)` helper)
- Create: `src/services/push-handler.ts` (background notification received handler)
- Modify: `app/_layout.tsx` (register the received-notification subscription)
- Test: `src/services/push-handler.test.ts`

**Interfaces:**
- Consumes: wallet-store sync-by-txid, `scheduleReceivedNotification` (existing).
- Produces: `handleIncomingPush(data: { txid: string; event: string }): Promise<void>` — sync the txid, then for a received event post the local notification with the real amount.

- [ ] **Step 1: Write failing test** — `handleIncomingPush({ txid, event:"incoming_confirmed" })` calls the wallet sync-for-txid then `scheduleReceivedNotification(amount)` with the amount derived from the synced tx. A `txid` that doesn't pay us posts nothing.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `push-handler.ts` + `handleIncomingPush`. Reuse the SPV/Explorer path the wallet already uses to fetch/scan a tx; compute the received delta to our addresses; call `scheduleReceivedNotification`. For `outgoing_confirmed` post the send-confirmed notification (new i18n string).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Register** the `Notifications.addNotificationReceivedListener` / background task that routes silent `data.txid` → `handleIncomingPush`, in `app/_layout.tsx`. Add i18n strings `notifications.sent.confirmed.*` (EN + ES).
- [ ] **Step 6: Commit** — `git commit -m "feat(notifications): silent-push handler syncs txid then alerts"`.

---

### Task 5: Settings UI — "Notificaciones de pago"

**Files:**
- Modify: `app/(tabs)/settings.tsx`
- Create: `app/notifications-settings.tsx` (modal screen) + register in `app/_layout.tsx` Stack
- Test: manual (UI) + `bun run typecheck`

**Interfaces:**
- Consumes: prefs store (Task 2).

- [ ] **Step 1: Add a settings row** "Notificaciones de pago" opening the new modal (follow the existing `ListItem`/settings-list pattern + i18n).
- [ ] **Step 2: Build the modal** — master toggle (`enabled`); **server URL** field (default shown, editable, with a "usar mi propio Explorer" hint); confirmation-depth stepper; per-event switches (incoming pending / confirmed / outgoing). Persist via `setNotificationPrefs`. Use Bloom primitives + NativeWind (no inline styles).
- [ ] **Step 3: Verify** `bun run typecheck` clean; open the modal on device, toggle persists across relaunch.
- [ ] **Step 4: Commit** — `git commit -m "feat(notifications): payment-notification settings screen"`.

---

### Task 6: Native infra — FCM + APNS config (gates device E2E)

**Files:**
- Modify: `app.json` (expo-notifications already present; add FCM + iOS entitlements)
- Create: `docs/notifications-infra.md` (provisioning runbook for the user)

**Interfaces:** none (build config).

- [ ] **Step 1:** Document in `docs/notifications-infra.md` the exact steps the **user** performs: create a Firebase project, add Android app `in.fairco.wallet`, download `google-services.json`; create an FCM v1 service account; create an APNS auth key `.p8` (Key ID, Team ID); where each env var goes on the Explorer host.
- [ ] **Step 2:** Add `google-services.json` handling to `app.json` (expo Android `googleServicesFile`) and iOS `aps-environment` entitlement + push capability. Add an iOS Notification Service Extension config for on-device enrichment (spec §4.2). Do **not** commit real `google-services.json` (gitignore it; commit a `.example`).
- [ ] **Step 3:** After the user provisions creds → `bunx expo prebuild --platform android` (bundles config), rebuild, install on the Pixel.
- [ ] **Step 4: Device E2E** — enable notifications in Settings; send FairCoin to a receive address with the app **closed**; confirm the phone wakes and shows "Recibiste X FAIR" with the `received` sound; check Explorer logs show a payload with only `{ txid, event, subscriptionId }`.
- [ ] **Step 5: Commit** — `git commit -m "chore(notifications): FCM/APNS build config + infra runbook"`.

---

## Self-Review

- **Spec coverage:** §4.5 token/lifecycle/handler/settings → Tasks 3,4,5; §4.1 registration contract → Task 2; §4.4 privacy dial → Task 5 (server URL + off); §4.2 silent → local → Task 4; watch-only-while-locked → Tasks 1,3 (xpub only). Infra §9 → Task 6. Covered.
- **Type consistency:** `accountXpub()` (Task 1) consumed in Task 3; `registerForPush`/`unregisterFromPush` (Task 2) consumed in Task 3; `handleIncomingPush` (Task 4) consumed by the listener in the same task.
- **Cross-plan dependency:** Tasks 3–4 exercise the Explorer contract; unit tests mock it, so this plan is independently testable. Device E2E (Task 6) needs the Explorer deployed + creds.
- **Deferred:** optional catalog (price/masternode/deep-confirm) — future.
