import { test, expect } from "bun:test";
import { loadConfig } from "../config";

test("serviceJwtSecret reads OXY_ACCESS_TOKEN_SECRET", () => {
  expect(loadConfig({ OXY_ACCESS_TOKEN_SECRET: "shh" }).serviceJwtSecret).toBe("shh");
});

test("serviceJwtSecret is undefined when unset (never silently defaults)", () => {
  expect(loadConfig({}).serviceJwtSecret).toBeUndefined();
});

test("serviceJwtSecret trims to undefined on an empty string", () => {
  expect(loadConfig({ OXY_ACCESS_TOKEN_SECRET: "   " }).serviceJwtSecret).toBeUndefined();
});

test("oxyApiUrl reads OXY_API_URL", () => {
  expect(loadConfig({ OXY_API_URL: "https://oxy-api.internal" }).oxyApiUrl).toBe(
    "https://oxy-api.internal",
  );
});

test("oxyApiUrl defaults to https://api.oxy.so when unset — the SAME default the shared oxyClient singleton uses", () => {
  expect(loadConfig({}).oxyApiUrl).toBe("https://api.oxy.so");
});
