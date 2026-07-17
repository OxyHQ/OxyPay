# Background notifications — infrastructure provisioning runbook

This is the **operator/user** checklist to bring FAIRWallet's background payment
notifications from "code complete" to "delivering pushes on a real device". The
app + Explorer code is done; what remains is credential provisioning, which
Anthropic's agents cannot do for you (it needs your Firebase/Apple accounts and a
physical device).

Design reference: `docs/superpowers/specs/2026-07-16-background-notifications-design.md`
(§9 lists what must be provisioned; §4 the architecture).

> **Security:** none of these credentials are committed. `google-services.json`
> is gitignored (a `.example` is committed as a template). The FCM service
> account and APNS `.p8` live **only** in the Explorer host's environment (per
> `AGENTS.md` secrets rule) — never in this repo, a dotfile, or a chat.

---

## 1. Firebase / FCM (Android + the server sender)

FairCoin's Android package id is **`in.fairco.wallet`** (see `app.json`).

1. Create a Firebase project (or reuse one) at <https://console.firebase.google.com>.
2. **Add an Android app** with package name `in.fairco.wallet`.
3. Download the generated **`google-services.json`** and place it at the repo
   root (`FAIRWallet/google-services.json`). `app.json` already points Android's
   `googleServicesFile` at it. It is gitignored — do **not** commit it.
4. Create an **FCM HTTP v1 service account** for the *server* to send pushes:
   Firebase console → Project settings → **Service accounts** → *Generate new
   private key*. This downloads a service-account **JSON**.
5. Put that service-account JSON on the **Explorer host** as the env var below.

## 2. APNS (iOS)

FairCoin's iOS bundle id is **`in.fairco.wallet`**.

1. In the Apple Developer portal → Certificates, Identifiers & Profiles → **Keys**,
   create an **APNs Auth Key** (`.p8`). Download it **once** (Apple shows it only
   once) and record its **Key ID**.
2. Record your **Team ID** (top-right of the developer portal).
3. Ensure the App ID `in.fairco.wallet` has the **Push Notifications** capability
   enabled.
4. Put the `.p8` contents + Key ID + Team ID on the **Explorer host** as the env
   vars below. The app's `aps-environment` entitlement is set in `app.json`
   (`production`); use `APNS_ENV=production` unless testing a dev build.

## 3. Explorer host environment variables

Set these on the Explorer server (never in the repo). Names match the Explorer
plan / spec §4.3:

| Variable | Value |
|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | The FCM v1 service-account JSON (inline, or a path the Explorer reads) |
| `APNS_KEY_P8` | Contents of the APNS `.p8` auth key |
| `APNS_KEY_ID` | The APNS key's Key ID |
| `APNS_TEAM_ID` | Your Apple Team ID |
| `APNS_BUNDLE_ID` | `in.fairco.wallet` |
| `APNS_ENV` | `production` (or `sandbox` for a dev build) |

The Explorer's notification dispatch is inert until these are set, so deploying
the code early is safe (spec §8: "Phase 1 is inert until Phase 3 provisions
credentials").

## 4. iOS Notification Service Extension (NSE)

Because iOS throttles pure-silent pushes, the robust iOS path is a low-priority
**alert push with generic text** ("Nueva actividad") plus a **Notification
Service Extension** that fetches the `txid` and rewrites the body on-device
before display, so the amount is never in the APNS payload (spec §4.2).

The NSE is a **separate native target**; it cannot be expressed purely in
`app.json` and requires a config plugin (or a manual native target added after
`expo prebuild`). This is intentionally **out of scope** for the app-code phase
and is provisioned together with the native build in §5. On Android the silent
**FCM data message** wakes the JS background handler directly, so no extension is
needed there.

## 5. Build & device E2E (do this AFTER §1–§4)

> These steps need your credentials + a physical device, so they are the handoff
> from the code work — run them yourself.

1. `bunx expo prebuild --platform android` (bundles `google-services.json` and
   the notification config). Repeat for iOS when building on macOS.
2. Rebuild and install the dev/prod build on the device (e.g. the Pixel).
3. In the app: **Settings → Payment notifications → Enable**, and grant the OS
   notification permission when prompted.
4. Send FairCoin to one of the wallet's receive addresses **with the app
   closed**. Confirm the phone wakes and shows "Recibiste X FAIR" with the
   `received` sound.
5. Verify privacy: the Explorer server logs for that push must show a payload of
   only `{ txid, event, subscriptionId }` — **no amount, address, or balance**.

## 6. Privacy dial (for users)

Notification server is user-selectable in **Settings → Payment notifications →
Notification server** (design §4.4):

- **Default** — the official Explorer (`https://explorer.fairco.in`): it learns
  your watch-only account xpub.
- **High** — your own Explorer + FairCoin node; set its URL in that field. The
  server is yours, so it learns nothing you don't already own.
- **Maximum** — leave notifications **off**: no registration at all; alerts fire
  only while the app is open.
