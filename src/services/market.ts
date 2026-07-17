/**
 * Market service for FairCoin wallet.
 * Fetches the FAIR price history (for the home sparkline) and live network
 * stats (block height, masternode count, circulating supply) from the Explorer
 * API. Mirrors the cached, non-throwing style of `price.ts`.
 *
 * Stale-while-revalidate: results are cached per network with a freshness TTL.
 * `getCached*` return the last value synchronously (so a screen can render it
 * instantly on mount — no flash of empty state), and `fetch*` skip the network
 * entirely while the cache is fresh, then refresh in the background. Every path
 * degrades gracefully — a failure returns the last good value (or null), never
 * throws.
 */

import { EXPLORER_BASE_URL, type NetworkType } from "@fairco.in/core";

const EXPLORER_API = EXPLORER_BASE_URL;
/** How long a cached market value is served without hitting the network. */
const CACHE_TTL_MS = 30_000;

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

interface Cached<T> {
  value: T;
  /** Epoch ms the value was fetched. */
  at: number;
}

// Cache keyed by network so switching mainnet/testnet never briefly shows the
// other network's data, and a failed refresh falls back to that network's last
// good value.
const priceHistoryCache = new Map<NetworkType, Cached<PriceHistoryPoint[]>>();
const networkStatsCache = new Map<NetworkType, Cached<NetworkStats>>();

/** The last cached price series for `network`, or null — synchronous. */
export function getCachedPriceHistory(
  network: NetworkType,
): PriceHistoryPoint[] | null {
  return priceHistoryCache.get(network)?.value ?? null;
}

/** The last cached network snapshot for `network`, or null — synchronous. */
export function getCachedNetworkStats(network: NetworkType): NetworkStats | null {
  return networkStatsCache.get(network)?.value ?? null;
}

/**
 * Fetch the FAIR price history (default 7 days), oldest→newest. Serves the cache
 * without a request while it's fresh; on any failure returns the last good
 * series (or null). The series is empty — not an error — until the Explorer's
 * sampler has accumulated points.
 */
export async function fetchPriceHistory(
  network: NetworkType,
  period = "7d",
): Promise<PriceHistoryPoint[] | null> {
  const cached = priceHistoryCache.get(network);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  try {
    const response = await fetch(
      `${EXPLORER_API}/api/price/history?period=${encodeURIComponent(period)}&network=${network}`,
    );
    if (!response.ok) return cached?.value ?? null;

    const data = (await response.json()) as {
      history?: Array<{ price_usd?: number; timestamp?: string }> | null;
    };
    if (!Array.isArray(data.history)) return cached?.value ?? null;

    const points: PriceHistoryPoint[] = [];
    for (const raw of data.history) {
      if (typeof raw.price_usd !== "number" || typeof raw.timestamp !== "string") {
        continue;
      }
      const timestamp = new Date(raw.timestamp).getTime();
      if (Number.isNaN(timestamp)) continue;
      points.push({ priceUsd: raw.price_usd, timestamp });
    }

    priceHistoryCache.set(network, { value: points, at: Date.now() });
    return points;
  } catch {
    // Network error — return the last good series for this network (or null).
    return cached?.value ?? null;
  }
}

/**
 * Fetch the live network stats. Serves the cache without a request while it's
 * fresh; on any failure returns the last good snapshot (or null).
 */
export async function fetchNetworkStats(
  network: NetworkType,
): Promise<NetworkStats | null> {
  const cached = networkStatsCache.get(network);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  try {
    const response = await fetch(`${EXPLORER_API}/api/stats?network=${network}`);
    if (!response.ok) return cached?.value ?? null;

    const data = (await response.json()) as {
      stats?: {
        blockHeight?: number;
        masternodeCount?: number;
        circulatingSupply?: number;
      } | null;
    };
    if (!data.stats) return cached?.value ?? null;

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

    networkStatsCache.set(network, { value: stats, at: Date.now() });
    return stats;
  } catch {
    // Network error — return the last good snapshot for this network (or null).
    return cached?.value ?? null;
  }
}
