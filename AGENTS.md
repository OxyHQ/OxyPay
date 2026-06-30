# OxyPay

Payment platform integrating the Oxy identity platform with the FairCoin payment network. Bun monorepo following the canonical `packages/` layout.

## Layout

```
packages/
  frontend/      # @oxypay/frontend — Expo SDK 56 / RN 0.85.3 / expo-router app
  backend/       # @oxypay/backend  — Bun/Express API, MongoDB, Socket.io, FairCoin RPC
  shared-types/  # @oxypay/shared-types — shared TypeScript types
bunfig.toml      # linker = "hoisted" (required for Metro + correct ECS resolution)
```

## Commands

```bash
# Development
bun run dev:frontend    # expo start --clear
bun run dev:backend     # bun --watch server.ts

# Build
bun run build:shared-types
bun run build:frontend  # expo export --platform web
bun run build:backend   # tsc
bun run build           # all packages

# Production
bun run start:frontend
bun run start:backend
```

## Key dependencies

- **Frontend:** `@oxyhq/services`, `@oxyhq/bloom`, `@oxyhq/core`, expo-router, NativeWind (via Bloom)
- **Backend:** Express + Mongoose + Socket.io + `@oxyhq/core/server` auth middleware + `@fairco.in/core` + `@fairco.in/rpc-client` (FairCoin payment RPC)
- **Auth:** backend uses `requireOxyAuth` / `getRequiredOxyUserId` from `@oxyhq/core/server`; frontend uses `OxyProvider` + `useOxy` from `@oxyhq/services`
