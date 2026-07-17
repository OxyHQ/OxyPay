import { EXPLORER_BASE_URL as DEFAULT_EXPLORER_BASE_URL } from "@fairco.in/core";
import type { NetworkType } from "@fairco.in/core";

/**
 * Typed environment reader for the Oxy Pay Gateway backend.
 *
 * Every value is validated and defaulted explicitly — no `process.env.X!`,
 * no magic numbers scattered through the code. `loadConfig` is pure over its
 * `env` argument so it can be exercised in isolation; `config` is the process
 * singleton built from `process.env` at import time.
 */

const DEFAULT_PORT = 3001;
const DEFAULT_NETWORK: NetworkType = "mainnet";
// Conventional local dev target; overridden by MONGODB_URI in every real env.
const DEFAULT_MONGODB_URI = "mongodb://localhost:27017/oxypay";

export interface AppConfig {
  /** Base URL of the FairCoin block explorer (no trailing slash). */
  explorerBaseUrl: string;
  /** Network the gateway operates on (`mainnet` | `testnet`). */
  network: NetworkType;
  /** MongoDB connection string. */
  mongodbUri: string;
  /** HTTP port the API listens on. */
  port: number;
}

function readNetwork(raw: string | undefined): NetworkType {
  if (raw === undefined || raw.trim() === "") return DEFAULT_NETWORK;
  const value = raw.trim();
  if (value === "mainnet" || value === "testnet") return value;
  throw new Error(
    `OXYPAY_NETWORK must be "mainnet" or "testnet", received "${raw}"`,
  );
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`PORT must be a positive integer, received "${raw}"`);
  }
  return value;
}

function readNonEmpty(raw: string | undefined, fallback: string): string {
  if (raw === undefined) return fallback;
  const value = raw.trim();
  return value === "" ? fallback : value;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  return {
    explorerBaseUrl: readNonEmpty(
      env.EXPLORER_BASE_URL,
      DEFAULT_EXPLORER_BASE_URL,
    ),
    network: readNetwork(env.OXYPAY_NETWORK),
    mongodbUri: readNonEmpty(env.MONGODB_URI, DEFAULT_MONGODB_URI),
    port: readPort(env.PORT),
  };
}

export const config = loadConfig();
