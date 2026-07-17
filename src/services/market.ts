/**
 * Market service for FairCoin wallet.
 * Fetches the FAIR price history (for the home sparkline) and live network
 * stats (block height, masternode count, circulating supply) from the Explorer
 * API. Mirrors the cached, non-throwing style of `price.ts`: every function
 * returns the last good value (or null) on failure so callers can degrade
 * gracefully without ever crashing the UI.
 */

import { EXPLORER_BASE_URL, type NetworkType } from "@fairco.in/core";

const EXPLORER_API = EXPLORER_BASE_URL;

/** A single sampled FAIR/USD price point from `GET /api/price/history`. */
export interface PriceHistoryPoint {
  /** FAIR price in USD at this sample. */
  priceUsd: number;
  /** Sample time, epoch milliseconds. */
  timestamp: number;
}

/** Live network snapshot from `GET /api/stats`. */
export interface NetworkStats {
  /** Current block height (chain tip). */
  blockHeight: number;
  /** Number of enabled masternodes reported by the node. */
  masternodeCount: number;
  /** Circulating FAIR supply, whole coins. */
  circulatingSupply: number;
}

// Cache keyed by network so switching mainnet/testnet never briefly shows the
// other network's data, and a failed refresh falls back to that network's last
// good value.
const priceHistoryCache = new Map<NetworkType, PriceHistoryPoint[]>();
const networkStatsCache = new Map<NetworkType, NetworkStats>();

/**
 * Fetch the FAIR price history for the given period (default 7 days), oldest→
 * newest. Returns the cached series (or null) on any failure. The series is
 * empty — not an error — until the Explorer's sampler has accumulated points.
 */
export async function fetchPriceHistory(
  network: NetworkType,
  period = "7d",
): Promise<PriceHistoryPoint[] | null> {
  try {
    const response = await fetch(
      `${EXPLORER_API}/api/price/history?period=${encodeURIComponent(period)}&network=${network}`,
    );
    if (!response.ok) return priceHistoryCache.get(network) ?? null;

    const data = (await response.json()) as {
      history?: Array<{ price_usd?: number; timestamp?: string }> | null;
    };
    if (!Array.isArray(data.history)) return priceHistoryCache.get(network) ?? null;

    const points: PriceHistoryPoint[] = [];
    for (const raw of data.history) {
      if (typeof raw.price_usd !== "number" || typeof raw.timestamp !== "string") {
        continue;
      }
      const timestamp = new Date(raw.timestamp).getTime();
      if (Number.isNaN(timestamp)) continue;
      points.push({ priceUsd: raw.price_usd, timestamp });
    }

    priceHistoryCache.set(network, points);
    return points;
  } catch {
    // Network error — return the last good series for this network (or null).
    return priceHistoryCache.get(network) ?? null;
  }
}

/**
 * Fetch the live network stats for the given network. Returns the cached
 * snapshot (or null) on any failure.
 */
export async function fetchNetworkStats(
  network: NetworkType,
): Promise<NetworkStats | null> {
  try {
    const response = await fetch(`${EXPLORER_API}/api/stats?network=${network}`);
    if (!response.ok) return networkStatsCache.get(network) ?? null;

    const data = (await response.json()) as {
      stats?: {
        blockHeight?: number;
        masternodeCount?: number;
        circulatingSupply?: number;
      } | null;
    };
    if (!data.stats) return networkStatsCache.get(network) ?? null;

    const stats: NetworkStats = {
      blockHeight:
        typeof data.stats.blockHeight === "number" ? data.stats.blockHeight : 0,
      masternodeCount:
        typeof data.stats.masternodeCount === "number"
          ? data.stats.masternodeCount
          : 0,
      circulatingSupply:
        typeof data.stats.circulatingSupply === "number"
          ? data.stats.circulatingSupply
          : 0,
    };

    networkStatsCache.set(network, stats);
    return stats;
  } catch {
    // Network error — return the last good snapshot for this network (or null).
    return networkStatsCache.get(network) ?? null;
  }
}
