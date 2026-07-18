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
