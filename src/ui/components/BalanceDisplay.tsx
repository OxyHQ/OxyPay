/**
 * BalanceDisplay — formatted balance with ⊜ symbol, fiat conversion, and 24h change.
 *
 * Uses Phudu font for all amounts (titles and numbers).
 * Follows Revolut's pattern: symbol + amount inline.
 */

import { useMemo } from "react";
import { View, Text } from "react-native";
import { Badge } from "./Badge";
import { AmountText } from "./AmountText";
import { formatFiatAmount, t } from "../../i18n";
import { FONT_PHUDU_LIGHT, FONT_PHUDU_BLACK } from "../../utils/fonts";
import { COIN_SYMBOL, UNITS_PER_COIN } from "@fairco.in/core";

type BalanceSize = "sm" | "md" | "lg";

interface BalanceDisplayProps {
  value: bigint;
  priceUsd?: number | null;
  change24h?: number | null;
  size?: BalanceSize;
  showFiatPrimary?: boolean;
}

function coinValueToUsd(value: bigint, priceUsd: number): number {
  const fair = Number(value) / Number(UNITS_PER_COIN);
  return fair * priceUsd;
}

function formatChange(change: number): string {
  // i18n-localised "{value}% today" label. The percentage is rendered with
  // the same fixed precision in every language; only the trailing word
  // changes — the {percent} placeholder keeps that single concept atomic.
  const sign = change >= 0 ? "+" : "";
  return t("balance.change24h", { percent: `${sign}${change.toFixed(1)}` });
}

const SIZE_PRIMARY: Record<BalanceSize, number> = {
  sm: 20,
  md: 28,
  lg: 42,
};

const SIZE_SYMBOL: Record<BalanceSize, number> = {
  sm: 18,
  md: 24,
  lg: 34,
};

const SIZE_SECONDARY: Record<BalanceSize, number> = {
  sm: 12,
  md: 14,
  lg: 16,
};

export function BalanceDisplay({
  value,
  priceUsd,
  change24h,
  size = "lg",
  showFiatPrimary = false,
}: BalanceDisplayProps) {
  const usdValue = useMemo(() => {
    if (priceUsd == null || priceUsd === 0) return null;
    return coinValueToUsd(value, priceUsd);
  }, [value, priceUsd]);

  const usdFormatted = useMemo(() => {
    if (usdValue === null) return null;
    return formatFiatAmount(usdValue, "USD");
  }, [usdValue]);

  const changeInfo = useMemo(() => {
    if (change24h == null) return null;
    return {
      text: formatChange(change24h),
      variant: (change24h > 0 ? "success" : change24h < 0 ? "error" : "neutral") as
        "success" | "error" | "neutral",
    };
  }, [change24h]);

  const primary = SIZE_PRIMARY[size];
  const symbol = SIZE_SYMBOL[size];
  const secondary = SIZE_SECONDARY[size];

  // Fiat-primary mode
  if (showFiatPrimary && usdFormatted !== null) {
    return (
      <View className="items-center">
        <Text
          className="text-foreground tracking-tight"
          style={{ fontFamily: FONT_PHUDU_BLACK, fontSize: primary }}
        >
          {usdFormatted}
        </Text>

        <AmountText
          value={value}
          prefix={`${COIN_SYMBOL} `}
          className="text-muted-foreground mt-1"
          style={{ fontFamily: FONT_PHUDU_LIGHT, fontSize: secondary }}
        />

        {changeInfo ? (
          <View className="mt-3">
            <Badge text={changeInfo.text} variant={changeInfo.variant} />
          </View>
        ) : null}
      </View>
    );
  }

  // FAIR-primary mode (default)
  return (
    <View className="items-center">
      <View className="flex-row items-baseline">
        <Text
          className="text-foreground mr-1"
          style={{ fontFamily: FONT_PHUDU_LIGHT, fontSize: symbol }}
        >
          {COIN_SYMBOL}
        </Text>
        <AmountText
          value={value}
          className="text-foreground tracking-tight"
          style={{ fontFamily: FONT_PHUDU_BLACK, fontSize: primary }}
        />
      </View>

      {usdFormatted !== null ? (
        <Text
          className="text-muted-foreground mt-1"
          style={{ fontSize: secondary }}
        >
          {"\u2248"} {usdFormatted}
        </Text>
      ) : null}

      {changeInfo ? (
        <View className="mt-3">
          <Badge text={changeInfo.text} variant={changeInfo.variant} />
        </View>
      ) : null}
    </View>
  );
}
