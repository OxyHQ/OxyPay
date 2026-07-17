/**
 * HomeOverview — content for the home screen's "Overview" tab: a glanceable
 * market + staking + network view. Composes (top→bottom) the FAIR price
 * sparkline, the staking/rewards summary, the network-health card, and the
 * FAIR holding row.
 *
 * The big balance and the Activity feed live elsewhere on the home screen, so
 * this view deliberately does not repeat them. Market data (price history +
 * network stats) is fetched from the Explorer while the screen is focused and
 * degrades gracefully — a failed request leaves the cards in their last-known
 * or "unavailable" state, never crashing.
 */

import { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { Card } from "./Card";
import { AmountText } from "./AmountText";
import { PriceSparkline } from "./PriceSparkline";
import { StakingCard } from "./StakingCard";
import { NetworkHealthCard } from "./NetworkHealthCard";
import { useWalletStore } from "../../wallet/wallet-store";
import {
  fetchPriceHistory,
  fetchNetworkStats,
  type PriceHistoryPoint,
  type NetworkStats,
} from "../../services/market";
import { COIN_SYMBOL, COIN_TICKER, UNITS_PER_COIN } from "@fairco.in/core";
import { FONT_PHUDU_BLACK } from "../../utils/fonts";
import { formatFiatAmount, t } from "../../i18n";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How often to refresh the Explorer market data while focused. */
const MARKET_POLL_INTERVAL = 60_000;

export function HomeOverview(): React.JSX.Element {
  const network = useWalletStore((s) => s.network);
  const balance = useWalletStore((s) => s.balance);

  const [history, setHistory] = useState<PriceHistoryPoint[] | null>(null);
  const [stats, setStats] = useState<NetworkStats | null>(null);

  // Poll the Explorer market endpoints (price history + network stats) while the
  // home screen is focused, mirroring the parent screen's price-polling
  // lifecycle. Both fetches are non-throwing (they return cached values or
  // null), so a failed request never surfaces here as an error.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const load = async () => {
        const [nextHistory, nextStats] = await Promise.all([
          fetchPriceHistory(network),
          fetchNetworkStats(network),
        ]);
        if (cancelled) return;
        if (nextHistory) setHistory(nextHistory);
        if (nextStats) setStats(nextStats);
      };
      void load();
      const timer = setInterval(() => void load(), MARKET_POLL_INTERVAL);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [network]),
  );

  const latestPriceUsd = useMemo(() => {
    if (!history || history.length === 0) return null;
    return history[history.length - 1].priceUsd;
  }, [history]);

  const changePct = useMemo(() => {
    if (!history || history.length < 2) return null;
    const last = history[history.length - 1];
    const cutoff = last.timestamp - DAY_MS;
    // Series is oldest→newest: walk forward to the last point at/before the 24h
    // cutoff. If every point is newer than the cutoff (history shorter than a
    // day), fall back to the oldest point so we still show a meaningful change.
    let reference = history[0];
    for (const point of history) {
      if (point.timestamp <= cutoff) reference = point;
      else break;
    }
    if (reference.priceUsd === 0) return null;
    return ((last.priceUsd - reference.priceUsd) / reference.priceUsd) * 100;
  }, [history]);

  const fiatBalance = useMemo(() => {
    if (latestPriceUsd == null) return null;
    return formatFiatAmount(
      (Number(balance) / Number(UNITS_PER_COIN)) * latestPriceUsd,
      "USD",
    );
  }, [balance, latestPriceUsd]);

  const unitPrice =
    latestPriceUsd != null ? formatFiatAmount(latestPriceUsd, "USD") : null;
  const changeLabel =
    changePct != null
      ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`
      : null;

  return (
    <View className="px-4 pt-4 gap-3">
      <PriceSparkline
        points={history ?? []}
        changePct={changePct}
        currentPriceUsd={latestPriceUsd}
      />

      <StakingCard />

      <NetworkHealthCard stats={stats} />

      {/* FAIR holding row: unit price / change on the left, balance + fiat on
          the right. The headline balance already sits above the tabs, so this
          row is the FAIR-asset breakdown, not a duplicate of it. */}
      <Card>
        <View className="flex-row items-center p-4">
          <View className="w-11 h-11 rounded-full bg-primary/10 items-center justify-center mr-3">
            <Text
              className="text-primary"
              style={{ fontFamily: FONT_PHUDU_BLACK, fontSize: 20 }}
            >
              {COIN_SYMBOL}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-foreground text-sm font-medium">
              {COIN_TICKER}
            </Text>
            {unitPrice ? (
              <Text className="text-muted-foreground text-xs mt-0.5">
                {unitPrice}
                {changeLabel ? `  ${changeLabel}` : ""}
              </Text>
            ) : null}
          </View>
          <View className="items-end">
            <AmountText
              value={balance}
              suffix={` ${COIN_SYMBOL}`}
              className="text-foreground text-sm font-semibold"
            />
            {fiatBalance ? (
              <Text className="text-muted-foreground text-xs mt-0.5">
                {fiatBalance}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>
    </View>
  );
}
