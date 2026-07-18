import { describe, test, expect } from "bun:test";
import {
  resolveKeylessAction,
  hasIdentityAuthMethod,
  COMMONS_CREATE_IDENTITY_URL,
  COMMONS_IMPORT_IDENTITY_URL,
} from "./keyless";

describe("hasIdentityAuthMethod", () => {
  test("true when an identity method is present", () => {
    expect(hasIdentityAuthMethod([{ type: "webauthn" }, { type: "identity" }])).toBe(true);
  });
  test("false for webauthn-only / empty (keyless account)", () => {
    expect(hasIdentityAuthMethod([{ type: "webauthn" }])).toBe(false);
    expect(hasIdentityAuthMethod([])).toBe(false);
  });
});

describe("resolveKeylessAction", () => {
  test("no server identity → create in Commons", () => {
    const action = resolveKeylessAction(false);
    expect(action.kind).toBe("create");
    expect(action.url).toBe(COMMONS_CREATE_IDENTITY_URL);
  });
  test("server has identity (exists on another device) → open Commons to import it", () => {
    const action = resolveKeylessAction(true);
    expect(action.kind).toBe("sync");
    expect(action.url).toBe(COMMONS_IMPORT_IDENTITY_URL);
  });
});
