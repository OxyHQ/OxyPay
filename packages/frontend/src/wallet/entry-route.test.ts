import { describe, test, expect } from "bun:test";
import { decideEntryRoute } from "./entry-route";

describe("decideEntryRoute", () => {
  test("waits while auth is unresolved", () => {
    expect(decideEntryRoute({ isAuthResolved: false, isAuthenticated: false, identityInit: null, hasPinConfigured: null }).kind).toBe("loading");
  });

  test("signed out → sign in with Oxy", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: false, identityInit: null, hasPinConfigured: null }).kind).toBe("signin");
  });

  test("signed in, identity init pending → loading", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: null, hasPinConfigured: null }).kind).toBe("loading");
  });

  test("signed in on web → wallet unsupported", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "web-unsupported", hasPinConfigured: null }).kind).toBe("web-unsupported");
  });

  test("signed in, keyless account → create Oxy ID", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "no-identity", hasPinConfigured: null }).kind).toBe("create-identity");
  });

  test("wallet ready, PIN state unknown → loading", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "initialized", hasPinConfigured: null }).kind).toBe("loading");
  });

  test("wallet ready, no PIN yet → needs PIN setup", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "initialized", hasPinConfigured: false }).kind).toBe("needs-pin");
  });

  test("wallet ready, PIN set → ready", () => {
    expect(decideEntryRoute({ isAuthResolved: true, isAuthenticated: true, identityInit: "initialized", hasPinConfigured: true }).kind).toBe("ready");
  });
});
