# Instructions

## AI agents & instruction files (single source: AGENTS.md)

This ecosystem is worked on by THREE AI coding agents — **Claude Code, OpenAI Codex, and Gemini CLI** — and they ALL read the SAME per-project instruction file. There must be **no duplicate or divergent instruction files**.

- **`AGENTS.md` is the single source of truth** in every project. All real instructions live there. OpenAI Codex reads it natively.
- **`CLAUDE.md`** is a thin shim whose only meaningful line is `@AGENTS.md` (on its own line) — Claude Code does NOT read AGENTS.md natively, so the import is required. Never put real content in `CLAUDE.md`.
- **Gemini CLI** is configured globally (`~/.gemini/settings.json` → `"context": { "fileName": ["AGENTS.md", "GEMINI.md"] }`) to read `AGENTS.md` in every project, so **no per-project `GEMINI.md` is needed**. (Fallback if a Gemini build ignores the setting: a one-line `GEMINI.md` containing the import `@AGENTS.md`.)

**Rules going forward:**
- EVERY new project MUST use this pattern: put instructions in `AGENTS.md`, then add a `CLAUDE.md` containing only the `@AGENTS.md` import line. Never create standalone `CLAUDE.md` content again.
- Never let `CLAUDE.md` / `GEMINI.md` and `AGENTS.md` diverge — edit `AGENTS.md` only.
- When `/init` or any scaffolder generates a `CLAUDE.md`, immediately convert it to the `AGENTS.md` + shim pattern.

## Language
Respond in the same language the user writes in (Spanish or English).

## Package Manager
Always use `bun`, never npm or yarn. Use `bunx` instead of `npx`.
If a project still uses npm in its `package.json` scripts (e.g., `npm run build --workspaces`), migrate them to bun equivalents (`bun run build --filter '*'`). Delete `package-lock.json` if it exists and replace with `bun.lock` by running `bun install`. Commit the migration.

## Quality Standards (ALL agents must follow)
- Never claim a feature is 'complete' or summarize prematurely. After implementing, self-audit by checking all integration points between new components and existing code. List any gaps found before declaring done.
- When a first approach fails or user rejects it, do NOT try hacky workarounds. Stop and ask the user for their preferred direction. Avoid cascading through 3+ wrong approaches before finding the right one.
- Production-grade code. We serve billions of users. No hacks, no tricks, no workarounds.
- Code like a top-tier tech company (Google, Meta, Apple level): clean, scalable, maintainable, well-structured.
- Always check logs and error output after making changes. Verify things work.
- No "quick fixes" - find and fix root causes.
- No unnecessary abstractions, but no half-baked solutions either.
- Review your own output before reporting success.
- Avoid `useEffect` whenever possible. Use derived state, event handlers, useMemo, or React Query instead. useEffect is a code smell in most cases.
- No re-exports, no barrel file hacks, no compatibility shims. Clean imports directly from the source package.
- Follow industry best practices: proper error boundaries, correct TypeScript types, efficient renders, proper memoization when needed.
- NEVER use `as any`. Write proper types. If a type is complex, define an interface or type alias. `as any` is banned.
- NEVER use `@ts-ignore` or `@ts-expect-error`. Fix the actual type error.
- NEVER use `console.log` for debugging in committed code. Use proper logging or remove it.
- NEVER leave TODO/FIXME/HACK comments. Fix the issue now or don't write the comment.
- NEVER use `!` non-null assertions. Handle null/undefined properly with optional chaining or guards.
- NEVER use `any` as a function parameter or return type. Always type explicitly.
- NEVER use inline styles in React Native when NativeWind classes exist for the same purpose.
- NEVER catch errors silently (`catch {}`). Log them or handle them properly.
- NEVER use `var`. Use `const` by default, `let` only when reassignment is needed.
- NEVER hardcode URLs, API keys, or magic numbers. Use constants or environment variables.
- After installing or updating packages, ALWAYS run `bun install` to regenerate `bun.lock`. Commit the updated lockfile **in the same commit** as the `package.json`/`overrides` change — NEVER as a follow-up commit. A bump commit without its matching lockfile breaks CI immediately with `error: lockfile had changes, but lockfile is frozen`, which red-fails CI + Deploy Frontends + Deploy to AWS. This is a **HARD gate** enforced by `test-build`: it runs `bun install --frozen-lockfile` before every push; if that fails it self-heals by running `bun install`, stages the regenerated `bun.lock`, and ensures it is included before proceeding. A push with an unsynced lockfile is NEVER allowed through.

## Agent-First Workflow (MANDATORY)

You MUST delegate work to custom agents. NEVER do implementation work directly in the main thread. The main thread is a **tech lead** that coordinates, delegates, and reviews. Think of yourself as managing a full engineering team.

### How to work
1. Analyze what the user needs
2. Break the task into pieces
3. Launch the appropriate agents IN PARALLEL whenever possible
4. Coordinate results and report back to the user
5. If an agent reports errors, spawn another agent or the same one to fix it

### The Team

**Mention** (`~/Oxy/Mention`) - Social media app with fediverse:
| Agent | Role | When to use |
|-------|------|-------------|
| **mention-frontend** | Frontend engineer | UI/UX work (components, screens, feeds, profiles) |
| **mention-designer** | UI/UX specialist | Visual polish, animations, styling, NativeWind |
| **mention-backend** | Backend engineer | API, database, fediverse/ActivityPub |

**OxyHQ** (`~/Oxy/OxyHQServices`) - Platform SDK:
| Agent | Role | When to use |
|-------|------|-------------|
| **oxy-core** | Core SDK engineer | @oxyhq/core - OxyServices client, mixins, crypto, types |
| **oxy-auth** | Auth specialist | Auth flows, FedCM, service tokens, sessions, 2FA |
| **oxy-api** | API backend engineer | API routes, models, services, email, billing |
| **oxy-frontend** | Frontend engineer | Oxy apps (accounts, console, inbox, auth) |
| **oxy-services** | RN SDK engineer | @oxyhq/services - Expo/RN components, screens |

**Bloom** (`~/Oxy/Bloom`) - Shared UI library:
| Agent | Role | When to use |
|-------|------|-------------|
| **bloom** | UI library engineer | Components used across ALL apps |

**Allo** (`~/Oxy/Allo`) - App:
| Agent | Role | When to use |
|-------|------|-------------|
| **allo** | Full-stack engineer | Frontend (Expo/RN) + backend |

**Alia** (`~/Oxy/Alia`) - AI platform:
| Agent | Role | When to use |
|-------|------|-------------|
| **alia** | Full-stack engineer | 13-app monorepo: AI proxy, Expo app, Canvas, SDK, integrations |

**TNP** (`~/Oxy/tnp`) - App:
| Agent | Role | When to use |
|-------|------|-------------|
| **tnp** | Full-stack engineer | Vite web + Bun API + DNS server + client SDK |

**Homiio** (`~/Oxy/Homiio`) - Real estate app:
| Agent | Role | When to use |
|-------|------|-------------|
| **homiio** | Full-stack engineer | Frontend (Expo/RN) + backend, Stripe, PostHog |

**Cross-project:**
| Agent | Role | When to use |
|-------|------|-------------|
| **mention-fixer** | Senior debugger | Bugs that cross layers in any project |
| **security-reviewer** | Security specialist | Code review for auth, tokens, OWASP issues |
| **test-build** | QA engineer | Before ANY push: tests + build, spawns git-ops if green |
| **git-ops** | DevOps | Git commit, push, merge (usually spawned by test-build) |
| **docs-keeper** | Knowledge keeper | Updates CLAUDE.md and agent files when team learns new things |

### Fix Upstream, Never Patch (CRITICAL)
When an agent finds a bug or issue that originates in a dependency package (e.g., working on Mention and the bug is in @oxyhq/core, @oxyhq/services, or Bloom), the agent MUST:
1. **Fix the issue at the source** - spawn the appropriate upstream agent (oxy-core, oxy-services, bloom, etc.)
2. **Build the upstream package** - `bun run build` in that package
3. **Test it** - run tests in the upstream package
4. **Push and publish** - use test-build → git-ops to commit and push the fix
5. **Update the dependency** in the consuming app if needed (`bun install`, version bump, etc.)
6. **NEVER patch or workaround** in the consuming app. No monkey-patching, no local overrides, no "temporary fixes". Fix the real source.

This applies to ALL apps: Mention, Allo, Homiio, TNP, accounts, inbox, console - if the bug is in a shared package, fix the shared package.

### Ecosystem Features Belong in the Shared SDK (CRITICAL)
Cross-cutting behavior — **especially SSO / session handling** (cross-domain SSO, `/__oxy/sso-callback` consume→clear-hash→once-guard→redirect-back, auth cold-boot, FedCM) and any other feature that every Oxy app needs — MUST be implemented **entirely in the shared SDK** (`@oxyhq/core`, `@oxyhq/auth`, `@oxyhq/services`) so EVERY app (Mention, Allo, Homiio, accounts, console, inbox, etc.) gets it for free.

- **NO per-app `/__oxy/sso-callback` route.** The SDK's `OxyProvider` / `OxyContext` / `WebOxyProvider` intercepts the callback path on mount and handles it universally. Apps are zero-config.
- **NO custom per-app SSO/session/auth code.** If all apps would need the same logic, it goes in the SDK — once.
- **NO hacks or workarounds.** Production-grade, clean implementation in the SDK only.
- RP frontends use the SDK providers with registered `clientId`: `WebOxyProvider` from `@oxyhq/auth` on web and `OxyProvider` from `@oxyhq/services` on Expo/RN. SDK cold boot owns callback consumption, FedCM/silent restore, stored-session restore, and SSO bounce.
- SSO helpers (`consumeSsoReturn`, `buildSsoBounceUrl`, `isCentralIdPOrigin`, `guardActive`, `getSsoCallbackBootstrapScript`, etc.) are defined ONCE in `@oxyhq/core` and consumed by auth-sdk, services, Expo root HTML, and the CF Worker. Do NOT re-introduce local copies in any consumer — they drift.
- RP app backend clients use `oxyServices.createLinkedClient({ baseURL })`. Do NOT add app-local token providers, Axios/fetch auth interceptors, manual `Authorization` plumbing, refresh-cookie retries, or local session invalidation.
- Backend APIs use `@oxyhq/core/server`: `createOxyAuthMiddleware`, `createOptionalOxyAuth`, `createOxyRateLimit`, `requireOxyAuth`, `getRequiredOxyUserId`, and `authSocket`. Do NOT define app-local `AuthRequest`, `requireAuth`, `getUserId`, `getAuthenticatedUserId`, bearer parsers, or token-decoding middleware.
- Bearer-authenticated writes do NOT fetch app-local CSRF tokens. CSRF remains for ambient cookie credentials and cookie-only writes.
- **IdP EXCEPTION — `packages/auth` (auth.oxy.so) is the IdP, NOT a Relying Party.** This rule governs RP apps. The auth app MUST NOT use `WebOxyProvider` / `runColdBoot` / the RP cold-boot+SSO-bounce chain — doing so would make the IdP bounce to itself (circular). It correctly uses a bespoke first-party session path: `useDeviceAccounts()` (`packages/auth/lib/use-device-accounts.ts`) reads shared refresh cookies via `POST api.oxy.so/auth/refresh-all` (`credentials: include`). DO NOT refactor the auth app onto `WebOxyProvider`. See OxyHQServices AGENTS.md "Auth App" section for details.

### Rules
- For ANY code change: spawn the relevant agent(s), don't code in the main thread
- For multi-area tasks: spawn MULTIPLE agents in parallel
- For "push to git" / "sube los cambios": ALWAYS use test-build first
- For debugging: use mention-fixer or the app-specific agent
- Spawn as many agents as needed. More parallelism = faster results
- If Bloom components change, also spawn agents for affected apps to verify
- Agents must check logs and verify their work before reporting done
- When a bug is in a shared package, fix upstream FIRST, then verify downstream
- After agents complete work that reveals new info (new patterns, commands, architecture, deps), spawn **docs-keeper** to update CLAUDE.md files and agent definitions
- When the user gives feedback or corrections ("use bun not npm", "don't use as any", "avoid useEffect"), IMMEDIATELY spawn **docs-keeper** to add the rule to the global CLAUDE.md and relevant agent files so it's permanent. User corrections are the highest priority knowledge to capture.

## Ecosystem

Projects may be in `~/`, `~/oxy/`, or other locations depending on the machine. At the start of each session, if you don't know where a project is, search for it:

```bash
find ~/ -maxdepth 3 -name "package.json" -exec grep -l '"name"' {} \; 2>/dev/null | head -30
```

Known projects on this machine (all under `~/Oxy/`):
- **Mention** (`~/Oxy/Mention`) - Social media (Expo/RN frontend + Node backend + fediverse)
- **OxyHQServices** (`~/Oxy/OxyHQServices`) - Platform SDK (auth, api, core, services, inbox, accounts, console)
- **Bloom** (`~/Oxy/Bloom`) - @oxyhq/bloom Shared UI component library (RN + Web)
- **Allo** (`~/Oxy/Allo`) - Encrypted messaging app (Expo/RN frontend + Node backend)
- **Alia** (`~/Oxy/Alia`) - AI platform (13-app monorepo: Express API, Expo app, Canvas, SDK, integrations)
- **TNP** (`~/Oxy/tnp`) - Alternative DNS/namespace system (Vite + Bun API + DNS server)
- **Homiio** (`~/Oxy/Homiio`) - Real estate platform (Expo/RN + Stripe + PostHog + Oxy)
- **Syra** (`~/Oxy/Syra`) - App
- **website** (`~/Oxy/website`) - Marketing/web presence

When a project is found at a different path than expected, spawn **docs-keeper** to update all agent files and CLAUDE.md with the correct paths for this machine.

## Chromium / Astro Browser

When working on Chromium/Astro browser builds: NEVER use `rsync --delete` on source trees. Always verify build artifacts are fresh (not stale .pak caches or old binaries). After any Mojo/IPC changes, do a clean rebuild of affected targets rather than incremental builds.

## UI Theming & NativeWind

For NativeWind/theming migrations: Always use NativeWind className-based theming, NOT custom color props, wrapper components, or Reanimated-based approaches. Never replace brand colors (e.g., logo white, oxy purple) with generic theme colors. Confirm which app/package the user means before making changes.

## Bloom Web CSS-var Format Contract (incident: auth+console unstyled after 0.6→0.7 bump; fixed 0.7.7)

Vite + Tailwind v4 + shadcn web apps (auth, console) use `@theme inline { --color-X: var(--X) }`, which makes Tailwind substitute at BUILD time → generated utilities reference the raw base token directly: `.bg-background { background-color: var(--background) }`. Base `--x` tokens therefore MUST resolve to FULL CSS colors at runtime.

Bloom's `applyColorPresetVars` (web-only, `src/theme/apply-dark-class.ts`) was writing base tokens as RAW HSL triples (`--background: 277 50% 5%`, no `hsl()` wrapper), overriding the app's correct `:root` fallback → `background-color: var(--background)` = `277 50% 5%` = INVALID → transparent → unstyled. Fixed in bloom 0.7.7 via `toWebColorValue()` helper that wraps triples in `hsl()` on web write paths only.

**Native paths UNCHANGED** — NativeWind/react-native-css still consumes raw triples via bloom's `hsl(var(--x))` indirection.

**Consumer rule (web apps):** Use `var(--x)` — NEVER `hsl(var(--x))` — for bloom base tokens. Starting 0.7.7 the token value is already a full color; `hsl(hsl(...))` = invalid.

**Runtime-vs-static meta-lesson (CRITICAL):** A static check of the built CSS does NOT catch CSS-var format mismatches. The built CSS looks correct — the bug manifests AT RUNTIME after `BloomThemeProvider`'s JS overrides `document.documentElement` vars. When diagnosing "renders unstyled / transparent despite correct-looking CSS", inspect the live computed styles or DevTools' `document.documentElement` style attribute at runtime — not the dist file.

## Bloom 0.7.x / NativeWind 5 Landmine

**Symptom:** bumping `@oxyhq/bloom` from `0.6.x` → `0.7.x` on a non-NativeWind-5 consumer breaks tsc and/or the bundler with `Cannot find module 'react-native-css/native-internal'`.

**Root cause:** Bloom 0.7.x's theme module statically imported `react-native-css/native-internal` (a NativeWind 5 engine subpath) but did NOT declare `react-native-css` as a dependency or peer. Bloom 0.7.x assumes the host is on **NativeWind 5** (which brings `react-native-css@3` transitively). Three failure modes:
- **NativeWind 4 apps (Allo, Homiio, Syra):** `tsc` TS2307 `Cannot find module 'react-native-css/native-internal'` because the `react-native` export condition serves raw `src/`, so consumer tsc follows into the native-specific file. Also breaks Metro native bundles.
- **Vite/Rolldown web apps (TNP web, website, some OxyHQServices apps):** `Rolldown failed to resolve import "react-native-css/native-internal"` — non-Metro bundlers don't do platform-extension resolution and pull the native file directly.
- **NativeWind 5 apps (Mention):** work fine because `react-native-css@3` is already present.

**Fix (shipped in bloom 0.7.6):** `src/theme/native-root-vars.ts` split into a platform set — the default `.ts` is a clean no-op (no react-native-css import; resolved by consumer tsc + web bundlers), the real impl is confined to `native-root-vars.native.ts` (Metro-only), `.web.ts` is a no-op (web writes vars to `document.documentElement` instead). Bloom's platform-export generation pattern: `scripts/generate-platform-exports.mjs`.

**Residual:** NativeWind 4 apps' **native EAS builds** would still hit `.native.ts`'s react-native-css import. Allo/Homiio/Syra are safe for web/tsc/CI but need NativeWind 5 + `react-native-css` before a native build exercises bloom's native theme path.

**Rule:** Any Bloom subpath that has platform-specific behavior MUST have a `.native.ts` + `.web.ts` pair + a clean default `.ts` (no platform-only imports). Never leave a bare `.ts` that imports a Metro-only or NW5-only module.

## Bloom `useTheme` Provider-Ordering Gotcha (Syra incident, fixed commit 6e8f264, 2026-06-15)

`useTheme()` from `@oxyhq/bloom/theme` throws `"useTheme must be used within a <BloomThemeProvider>"` if called outside the provider. Classic trap: a splash/loading screen calls `useTheme` but is rendered BEFORE the provider mounts (e.g. an `appIsReady`/`!fontsLoaded` early-return in `app/_layout.tsx`), while `BloomThemeProvider` lives INSIDE `AppProviders`.

**Fix (mirror Mention):** Hoist `BloomThemeProvider` to the TOP of `app/_layout.tsx` so it wraps BOTH the splash/loading branch AND `<AppProviders>` — every render branch. Do NOT keep `BloomThemeProvider` nested inside `AppProviders` if anything above/outside `AppProviders` consumes the theme.

**Runtime-only crash:** tsc + web export build BOTH pass clean. The throw only happens at runtime when the app cold-starts on the loading/splash branch. Always do a runtime browser check after a bloom theming migration, not just a static build.

**Migration playbook — custom `useTheme` → `@oxyhq/bloom/theme`:** Bloom's `useTheme().colors` (`ThemeColors`) is a superset of the typical app custom hook shape (same keys: `background`, `text`, `textSecondary`, `card`, `border`, `primary`, `success`/`error`/`warning`/`info`, etc.). Bloom also exports `STATUS_COLORS`. The migration is a mechanical import-source swap. Applies to NW4 apps (Allo, Homiio, Syra) — no NativeWind version dependency on the theme hook itself.

## TypeScript & Package Publishing

This is a TypeScript-primary monorepo. Default to TypeScript for all new code. Never use `as any` — use proper types. When publishing npm packages, always verify the package has propagated before installing downstream.

## Bun 1.3 Gotchas

- **Linker `isolated` (default) does NOT hoist:** breaks Dockerfiles that copy only the root `node_modules` (ERR_MODULE_NOT_FOUND in ECS) and confuses Metro/expo-doctor with false duplicate warnings. Fix: add `bunfig.toml` with `linker = "hoisted"` at the monorepo root AND copy it into Dockerfiles before `bun install`. Applied in Syra and Alia (2026-06-11).
- **`bun install --frozen-lockfile` false positives in complex monorepos:** bug present through 1.3.14 (affects Alia). CI equivalent guard: `bun install` then `git diff --exit-code bun.lock`. Pin `bun-version: 1.3.14` in workflows.
- **Pin bun version EVERYWHERE a lockfile is consumed (CRITICAL):** CI workflows AND Dockerfiles must use the SAME bun version that generated `bun.lock`. Mismatch → `error: lockfile had changes, but lockfile is frozen`. Fix: `setup-bun bun-version: 1.3.14` in all GitHub Actions AND `FROM oven/bun:1.3.14-alpine` in all Dockerfiles. Incident: Mention CI + Dockerfile had `1.3.11` but lockfile was generated with `1.3.14` → frozen-lockfile failures on every prod deploy.
- **`.dockerignore` pattern**: use `**/node_modules` and `**/dist` — BuildKit does NOT match nested directories with bare `node_modules` (leaks host node_modules into build context).
- **Isolated linker install path**: with default `linker = "isolated"`, deps live at `<root>/node_modules/.bun/<pkg>@<version>+<hash>/node_modules/<pkg>` — NOT at `<root>/node_modules/<pkg>`. Dockerfiles and one-shot ECS scripts that resolve modules by path must either use the full `.bun/...` path or set `linker = "hoisted"` in `bunfig.toml`.
- **Custom `lookup` passed to `https.request` MUST return `[{address,family}]` when called with `{all:true}`:** Bun's HTTP client calls `lookup(host, {all:true}, cb)` and then sorts the result (`results.sort(...)`). If the custom resolver returns a single `(err, address, family)` instead of an array, Bun throws `results.sort is not a function` and the request fails with a 502. Mocked-DNS unit tests (which stub the non-`all` signature) do NOT catch this. Verify against a real `https.request` on Bun. (Incident: 502'd ALL federated media via `/media/proxy`; fixed in `packages/backend/src/utils/safeUpstreamFetch.ts`.)

## expo-router Navigation Rules

- **ONE authority for group-boundary swaps (CRITICAL):** The root `<Stack>` layout is the SOLE authority for `(auth)` ↔ `(tabs)` swaps. NEVER have a child screen inside `(auth)` or `(tabs)` also navigate across that boundary using the same signal (e.g. `isAuthenticated`). If both the root `redirect` prop AND a child screen fire on the same condition, on cold load the child redirect can commit first, landing expo-router on a filtered-out route → blank/stuck screen (non-deterministic). Pattern: child auth screens render a neutral backdrop when the user is authenticated/onboarded; the root layout does the actual redirect. See `packages/accounts/hooks/authEntryTarget.ts`.
- **Jest does NOT catch render races, navigation races, or flex/layout bugs.** A wrong fix can pass 222 jest tests. Verify those bugs in a REAL browser. A backgrounded browser tab pauses `requestAnimationFrame` → expo-router transitions don't paint → false "blank" readings. Read React state from the fiber (paint-independent) to verify session restore; verify render only in a foregrounded tab.
- **Static CSS analysis does NOT catch CSS-var format mismatches** (see "Bloom Web CSS-var Format Contract" above). Dist CSS can look correct while the app renders transparent/unstyled at runtime. Always inspect `document.documentElement` inline styles in DevTools when diagnosing styling regressions after a bloom version bump.

## Expo SDK 56

- **React Native version**: 0.85.3 — NOT 0.86. `StyleSheet.absoluteFillObject` removed → use `absoluteFill`.
- **Navigation**: `@react-navigation/*` no longer coexists with expo-router — remove those deps and migrate imports.
- **iOS**: minimum deploymentTarget 16.4.
- **Peer requirement**: `@oxyhq/services` ≥6.10.x requires peer `expo >=56`.
- **API core 1.11.23**: `uploadFile` renamed to `uploadRawFile`; `searchProfiles()` now returns `{ data, pagination }`.
- **`expo-crypto` API**: the function is `randomUUID()`, NOT `getRandomUUID()`. Before declaring `.d.ts` shims for dynamic imports, validate against a real consumer's `node_modules/expo-crypto/build/Crypto.d.ts`.
- **Historical Expo SDK 56 migration baseline (2026-06-11)**: `expo ~56.0.11` + `@oxyhq/services 6.10.7` + `@oxyhq/bloom ^0.6.11/0.6.12`. Current Oxy package targets are listed in "Oxy SDK Published Versions" below.
- **@oxyhq/bloom 0.6.12**: added web fork of `./loading` without reanimated. Animated subpaths MUST have a `.web` variant + browser condition. Pattern lives in `scripts/generate-platform-exports.mjs` in Bloom.
- **@alia.onl/sdk 3.1.1**: published from `~/Oxy/Alia/apps/alia-chat` (source-only SDK).

## Oxy SDK Published Versions

Current published majors (npm):
- `@oxyhq/core` **3.4.13** — current target. Includes `@oxyhq/core/server` (`createOxyAuthMiddleware`, `createOptionalOxyAuth`, `createOxyRateLimit`, `requireOxyAuth`, `getRequiredOxyUserId`) and linked backend clients. 3.4.7: `OxyServices.createLinkedClient({ baseURL })`; 3.4.5: `getSsoCallbackBootstrapScript()`; 3.4.1: identity-scoped HttpService GET response cache. **GOTCHA: 3.3.0 and 3.4.0 are BROKEN for external consumers** because of an unpublished/workspace contracts dependency. Pin core to **>=3.4.13**.
- `@oxyhq/auth` **4.1.1** — `WebOxyProvider` intercepts `/__oxy/sso-callback` before child apps render; 4.1.0 added optional `clientId`; 3.4.0 consumed core SSO helpers; 3.2.0 consumed `runColdBoot` + auto-detect.
- `@oxyhq/services` **10.2.10** — current target. `OxyProvider` owns RP cold boot, `clientId`, callback interception, private API readiness, invalidated-token sign-out, and `useAuth()` / `useOxy()` guards (`hasAccessToken`, `canUsePrivateApi`, `isPrivateApiPending`). 10.2.x includes Trust screen names; consumers must not call removed `Karma*` routes. 10.0.0 removed `appName`; use `clientId`.
- `@oxyhq/bloom` **0.8.5** — current target. Retains the 0.7.x web CSS-var fix and NativeWind 5 platform split; web consumers use `var(--x)`, not `hsl(var(--x))`, for Bloom base tokens.

**All active RP consumers (2026-06-19):** target `@oxyhq/core >=3.4.13`, `@oxyhq/auth 4.1.1` where used, `@oxyhq/services >=10.2.10` where used, and `@oxyhq/bloom 0.8.5` where used. Expo web apps that can receive `/__oxy/sso-callback` inject `getSsoCallbackBootstrapScript()` in `app/+html.tsx`; app backend clients use `oxyServices.createLinkedClient({ baseURL })`.

**CRITICAL — SSO helpers live ONLY in `@oxyhq/core` (2026-06-19):** `consumeSsoReturn`, `buildSsoBounceUrl`, `isCentralIdPOrigin`, `guardActive`, `ssoNavigate`, `ssoStateKey`/`ssoGuardKey`/`ssoDestKey`/`ssoNoSessionKey`, `ssoCallbackBootstrapKey`, `getSsoCallbackBootstrapScript`, `SSO_CALLBACK_PATH`, `SSO_GUARD_TTL_MS`, `registrableApex`, `MULTIPART_TLDS`, and `CENTRAL_IDP_APEX` are defined ONCE in `@oxyhq/core` and imported by auth-sdk, services, Expo root HTML, and the CF Worker. Do NOT re-introduce local copies in any consumer.

**Breaking in `@oxyhq/services@10.0.0`:**
- `appName` prop REMOVED from `OxyProvider` — use `clientId` instead. Cross-app device sign-in requires `clientId`.
- Current consumers should pair it with `@oxyhq/core >=3.4.13`.

**Breaking in `@oxyhq/services@8.0.0`:**
- `@tanstack/*` moved from `dependencies` → `peerDependencies`. RN/Expo apps MUST declare: `@tanstack/react-query ^5.100.0`, `@tanstack/react-query-persist-client ^5.100.0`, `@tanstack/query-async-storage-persister ^5.100.0`. Web apps additionally add the optional `@tanstack/query-sync-storage-persister ^5.100.0`.
- `RouteName` union: `'AccountSettings'` and `'AccountCenter'` removed → unified into `'ManageAccount'`. The screen `ManageAccountScreen` replaces `AccountOverview + AccountSettings`.

## Node / Redis Gotchas

- **`rate-limit-redis` requires a unique `prefix` per limiter** when sharing a single Redis client. Without it, multiple limiter instances increment the same Redis key for the same request → `ERR_ERL_DOUBLE_COUNT` and the effective budget is halved. Convention: `'rl:<scope>:'`.

## Mention — Feed Web Gotcha

- The global feed uses `expo-sqlite` which requires SharedArrayBuffer (COOP/COEP headers). `mention.earth` does NOT send those headers → SQLite unavailable on web.
- Fallback: in-memory feed via `utils/feedMemoryMode.ts` + `useFeedState` when `isDbAvailable()` returns false.
- If the web feed appears empty, check the `isDbAvailable()` gate first.

## Oxy AWS Infrastructure

**Account:** `237343248947`, region `us-west-2` (eu-west-1 fully decommissioned — verified empty 2026-06-15: 0 EC2, 0 VPCs (default VPC deleted too), 0 EBS, 0 ALB, 0 ElastiCache, 0 ECR, 0 ACM, 0 SES identities, 0 /oxy SSM params, 0 active ECS clusters). CLI profile `oxy` = IAM user `oxy-admin` (NEVER root). IaC repo: `~/Oxy/oxy-infra` (live stack: `terraform-uswest2/`, state key `uswest2/terraform.tfstate` in bucket `oxy-tf-state-237343248947`, applied MANUALLY — no CI; old `terraform/` eu stack destroyed — empty state, defunct). **TF state bucket stays in eu-west-1** (S3 is globally reachable; holds state only — intentional).

**Stack (migrated to us-west-2):**
- **Compute:** ECS Fargate cluster `oxy-cluster` — all 6 backends run as Fargate tasks (linux/arm64, `assign_public_ip=true`, no NAT gateway)
- **Load balancer:** ALB `oxy-alb-648111691.us-west-2.elb.amazonaws.com` + ACM multi-SAN cert (DNS-validated via Cloudflare API)
- **Images:** ECR `237343248947.dkr.ecr.us-west-2.amazonaws.com/oxy/<app>` — built linux/arm64 by CI
- **Cache:** ElastiCache Valkey `oxy-valkey.g1y6uz.ng.0001.usw2.cache.amazonaws.com`
- **Database:** Self-hosted MongoDB 8 on EC2 `i-0430821d9ca72329e` (private `10.20.1.160`, EIP `16.146.183.67`, `/data` EBS). Daily backups → `s3://oxy-mongo-backups-usw2-237343248947/daily/` (14-day retention). Creds in SSM `/oxy/mongo/admin_{user,password}`. Access via SSM (no SSH).
- **Email:** AWS SES us-west-2. Domain `oxy.so` verified (DKIM + MAIL FROM `mail-aws.oxy.so` → `feedback-smtp.us-west-2.amazonses.com`). Outbound SMTP relay: `email-smtp.us-west-2.amazonaws.com:587`, IAM user `oxy-ses-smtp` (creds in SSM `/oxy/oxy-api/SMTP_RELAY_USER|PASS`, GitHub secrets = source of truth). **SES is in SANDBOX account-wide (all regions, 200/day, verified recipients only) — INTENTIONAL for this new AWS account; production-access request case 178146382500059 is DENIED. Stay on sandbox. Do NOT try to appeal or "fix" this.** Sending to `@oxy.so` works; external recipients blocked until prod access is later requested. **No email-specific S3 bucket** — `EMAIL_S3_*` env + `oxy-email-*` IAM ARNs were dead config (removed 2026-06-15 from `terraform-uswest2/app-services.tf` + `iam-s3-usw2.tf`). Email attachments use `AssetService → AWS_S3_BUCKET` (media bucket). Inbound mail: **Cloudflare Email Routing → webhook** (`EMAIL_INBOUND_WEBHOOK_SECRET`), NOT SES→S3.
- **LiveKit:** us-west-2 EC2 `i-0a3638c19f8540f33` (public `54.203.128.93`), behind the us ALB. `livekit.oxy.so` → us ALB. (No longer on DO.)
- **Media / CDN:** Per-app S3 buckets `oxy-<app>-media-usw2-237343248947`. `cloud.oxy.so` served by CloudFront distribution `EJGHFASAD3H1W` (`d2regs4fmu2k1p.cloudfront.net`) over `oxy-oxy-api-media-usw2-237343248947/public/*`. DO Spaces buckets fully migrated: mention-bucket → `oxy-mention-media-usw2`, oxy-bucket → `oxy-oxy-api-media-usw2`, bucket-alia → `oxy-alia-media-usw2`, oxyos → `oxy-oxyos-media-usw2`, oxy-development-bucket → `oxy-development-media-usw2`.

**6 migrated backends (all CF DNS-only → ALB → Fargate):**
| Service | Port | Domain |
|---------|------|--------|
| oxy-api | 8080 | api.oxy.so, api.website.oxy.so, website-api.oxy.so |
| mention | 3000 | api.mention.earth |
| alia | 3001 | api.alia.onl |
| homiio | 4000 | api.homiio.com |
| syra | 3000 | api.syra.oxy.so |
| allo | 8080 | api.allo.oxy.so |

**Frontends (Cloudflare Pages, stay there):** accounts, auth, console, inbox, os, syra, allo — deployed via `deploy-cloudflare.yml`.

**CI/CD:** Per-repo `.github/workflows/deploy-aws.yml` — builds `linux/arm64` → pushes to ECR → `ecs update-service --force-new-deployment`. AWS access via OIDC role `oxy-github-deploy` — NO AWS keys stored in GitHub.

**Secrets:** GitHub Actions repo secrets = source of truth. Deploy workflow syncs them to SSM `/oxy/<app>/*` and `/oxy/_shared/*` (shared: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `REDIS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). ECS injects from SSM at task launch. Plaintext reference inventory: USB vault `/media/nate/Nate_s USB/Oxy/credentials/`. NEVER commit secret values to git.

**Secret placeholder rule (CRITICAL):** NEVER set a GitHub Actions secret to a placeholder value (`-`, empty string, `TODO`, etc.). If a sync workflow runs, the placeholder overwrites the real SSM value and crashes production. Incident: `REDIS_URL=-` caused `oxy-api` crash-loop (`getaddrinfo ENOTFOUND -`). If you don't have the real value yet, simply do not create the secret. In any workflow that syncs secrets to SSM/Vault, guard with: `if [ -z "$v" ] || [ "$v" = "-" ]; then continue; fi`.

**One-shot admin tasks against VPC resources (Valkey/Redis, RDS, etc.):** launch an ECS Fargate task in the same SG + subnets as the production task with a `command` override (e.g. `node -e '...'` or a small script). Do NOT open new security group ingress for local/dev access.

**`terraform-uswest2` Mongo password — RESOLVED (2026-06-15, commit 2eb5250):** `aws_ssm_parameter.mongo_admin_password` (`/oxy/mongo/admin_password`) now carries `lifecycle { ignore_changes = [value] }`. The Mongo admin password is owned OUTSIDE Terraform (seeded at instance creation via `var.mongo_admin_password`/`random_password`, then rotated via the runbook — rotate the Mongo user + this SSM param together). A full `terraform apply` now reports **"No changes"** — the stack is cleanly apply-able with NO `-target=` needed. (Background: previously a plain apply wanted to rewrite SSM back to the random/seed value WITHOUT changing the actual Mongo user → would have broken auth for all backends; that footgun is gone.)

**Excluded from AWS (stay on DO):** Codea, athina, faircoin, OpenSearch `genai-shark`. DO `db-oxy` cluster still live (shared with faircoin/tnp) — do NOT decommission without handling those.

**TNP — migrating DO → AWS (in progress, 2026-06-15):** DO droplet `tnp-api` (ID 562981860) intentionally OFF. `app-tnp.tf` authored in `oxy-infra/terraform-uswest2/` (API→ALB, dns-server→NLB UDP+TCP/53+EIP, relay→ALB) — plan shows 26 add/0 destroy, NOT yet applied (blocked on `/oxy/tnp-api/MONGODB_URI` secret; DO db-oxy cluster, user `tnp-api-user`, db `tnp-production`).

**GOTCHA — auth.oxy.so FedCM:** `packages/auth/server/index.ts` MUST deploy as a CF Pages `_worker.js`. Static-only deploy leaves `/fedcm/*` returning SPA HTML (405 on POST). This is produced by `bun run build` — NOT a static-only deploy.

**Cross-domain SSO — durable "Option A" architecture (2026-06-13):** Cold-boot restore order on web (`runColdBoot` in core, used by both `WebOxyProvider` and `OxyContext`): 1. redirect-callback → 2. FedCM silent (Chrome) → 3. first-party `/auth/silent` iframe at `auth.<rp-apex>` (Safari/Firefox, reads per-apex `fedcm_session` cookie) → 4. cookie restore (same-site only) → 5. stored-session bearer → 6. `/sso` top-level bounce (terminal fallback). Native runs step 5 only. Step 3 runs BEFORE step 6 so reloads never flash.

**`/sso` flow (cross-apex RPs):** `auth.oxy.so GET /sso?prompt=none&client_id=<rp-origin>&return_to=<rp>/__oxy/sso-callback&state=<s>` reads the central `fedcm_session` cookie → for a cross-apex RP does a SECOND top-level hop to `auth.<rp-apex>/sso/establish?et=<signed establish-token>` (HS256, FEDCM_TOKEN_SECRET, short TTL, bound to purpose+host+aud). `/sso/establish` is first-party to the RP apex → verifies et → re-validates session + approved client → PLANTS host-only `fedcm_session` cookie on `auth.<rp-apex>` (survives Safari ITP/Firefox TCP) → mints opaque single-use code → bounces to `<rp>/__oxy/sso-callback#oxy_sso=ok&code=<code>&state=<s>`. RP redeems code at `api.oxy.so POST /sso/exchange` (origin-bound, atomic GETDEL burn in Valkey). Subsequent reloads restore via `/auth/silent` iframe at `auth.<rp-apex>` — no bounce.

**New API SSO endpoints:** `POST /sso/code` (X-Oxy-Internal gated, 404 if `SSO_INTERNAL_SECRET` unset); `POST /sso/exchange` (CORS, origin-bound, atomic GETDEL). `oxy-api` task-def injects `SSO_INTERNAL_SECRET`, `DEVICE_ID_SALT`, `REDIS_URL` — all three REQUIRED (missing = SSO fails closed / crash-loop).

**CRITICAL FIX — assertion issuer must always be central (commits 41a8feba + db91b6dd, 2026-06-13):** `mintSessionForClient` in `packages/auth/server/index.ts` MUST always build the ID-token assertion with `iss = https://auth.oxy.so` (the central IdP), never with the per-apex host. Background: `resolveConfig()` derives `fedcmIssuer` from `c.req.url` per-request; on `auth.mention.earth` this becomes `https://auth.mention.earth`, which the API's `POST /fedcm/exchange` rejects as `FedCM: Invalid issuer expected "https://auth.oxy.so"` → `mintSessionForClient` returns null → `/sso/establish` returned `#oxy_sso=error` AND `/auth/silent` posted a null session → cross-domain sessions never survived a reload. Fix: `const CENTRAL_FEDCM_ISSUER = \`https://auth.${CENTRAL_IDP_APEX}\`` used unconditionally in `mintSessionForClient`. **The per-apex issuer is still correct in `/.well-known/web-identity` and `/fedcm.json`** (drives browser-native FedCM UI) — ONLY the API-bound assertion is forced central.

New IdP endpoints live on all 4 auth hosts. No api.<apex> cookie bridge — cross-domain restore comes from `auth.<apex>`, not `api.<apex>`.

**NEVER set `FEDCM_ISSUER` env var on the `oxy-auth` CF Pages project** — it pins every host to the same issuer and silently breaks multi-domain FAPI (all custom-domain hosts report the same `provider_urls`).

**GOTCHA — `navigator.credentials.get()` (FedCM silent) can hang ignoring AbortController:** In the web cold-boot chain (`runColdBoot` in `@oxyhq/core`, consumed by both `WebOxyProvider` and `OxyContext`), the `fedcm-silent` step awaits `navigator.credentials.get({mediation:'silent'})`. Unlike `fetch`, this browser-internal primitive does NOT reliably reject when its abort signal fires — in some Chrome states it sits pending forever, so the step's promise never settles and the entire serial cold-boot chain hangs indefinitely (no `/sso` bounce, app stuck on loading/undetermined state). This was latent but got exposed when `stored-session` was reordered ahead of `fedcm-silent` in core 2.4.0 (removing the accidental safety net that used to mask it). Fix shipped in core 2.4.1 / services 8.6.1: race a short settle-timer against `credentials.get` so the silent path ALWAYS settles (to null) after its timeout, PLUS an overall cold-boot deadline (`COLD_BOOT_OVERALL_DEADLINE = 20000` in `OxyContext`) so the chain always reaches the terminal `/sso` bounce even if a step misbehaves. **Lesson:** any cold-boot step awaiting a non-`fetch` browser primitive (FedCM, credential APIs) MUST have its own hard settle guarantee — an AbortController is not sufficient; and the overall chain needs a deadline.

**Remaining (needs Nate):** Third-party keys (Stripe/Telegram/OpenAI/Firebase/Klipy/OAuth providers) not yet in SSM; `CLOUDFLARE_API_TOKEN` in OxyHQ AND Alia repos expired (error auth 10000 on Deploy Frontends) — rotate in GitHub secrets for both repos; `@oxyhq/services` declares `@oxyhq/core` and `@react-native-community/netinfo` as `dependencies` instead of `peerDependencies` — mitigated with `overrides` in Mention; `netinfo` nested 11.5.2 vs 12 at root in Homiio — fix upstream in oxy-services pending; Mention has 3 pre-existing tsc errors in `livekit-client` (exports map missing `react-native` condition); TNP AWS apply blocked on MONGODB_URI secret (see TNP migration note above); `@oxyhq/core@3.2.1` pending republish (consumeSsoReturn hard-redirect fix); **`@oxyhq/core` reputation working tree MUST be published as 4.0.0** (not 3.3.0 — karma removal is breaking); **Oxy Trust migration (`scripts/migrate-karma-to-reputation.ts`) MUST be run as a one-shot ECS task post-deploy — all users read 0 reputation balance until it runs**.

**Runbooks + specs:** `~/Oxy/oxy-infra/docs/runbooks/` (incl. 10-mongo-restore.md), `~/Oxy/oxy-infra/docs/superpowers/`.
