/**
 * StakingCard — aggregates the wallet's PoS staking and masternode reward
 * income from its transaction history: total earned, the last-30-days figure,
 * and how many rewards have landed.
 *
 * FairCoin is proof-of-stake with masternodes, so both `stake` and
 * `masternode_reward` transactions count as reward income. With no rewards yet
 * the card shows a subtle explanatory state rather than an error.
 */

import { useMemo } from "react";
import { View, Text } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Card } from "./Card";
import { AmountText } from "./AmountText";
import { useWalletStore } from "../../wallet/wallet-store";
import { COIN_SYMBOL } from "@fairco.in/core";
import { FONT_PHUDU_BLACK } from "../../utils/fonts";
import { formatNumber, t } from "../../i18n";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
/** Purple accent used across the app for staking-reward transactions. */
const STAKING_ACCENT = "#a78bfa";

export function StakingCard() {
  const transactions = useWalletStore((s) => s.transactions);

  const rewards = useMemo(() => {
    const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS_SECONDS;
    let total = 0n;
    let last30 = 0n;
    let count = 0;
    for (const tx of transactions) {
      if (tx.type !== "stake" && tx.type !== "masternode_reward") continue;
      const abs = tx.amount < 0n ? -tx.amount : tx.amount;
      total += abs;
      count += 1;
      if (tx.timestamp >= cutoff) last30 += abs;
    }
    return { total, last30, count };
  }, [transactions]);

  return (
    <Card>
      <View className="p-4">
        <View className="flex-row items-center mb-3">
          <View className="w-9 h-9 rounded-full bg-purple-500/10 items-center justify-center mr-2.5">
            <MaterialCommunityIcons
              name="star-four-points"
              size={18}
              color={STAKING_ACCENT}
            />
          </View>
          <Text className="text-foreground text-sm font-semibold">
            {t("overview.staking.title")}
          </Text>
        </View>

        {rewards.count === 0 ? (
          <View className="py-1">
            <Text className="text-foreground text-sm font-medium">
              {t("overview.staking.empty.title")}
            </Text>
            <Text className="text-muted-foreground text-xs mt-1 leading-4">
              {t("overview.staking.empty.subtitle")}
            </Text>
          </View>
        ) : (
          <View>
            <Text className="text-muted-foreground text-xs mb-1">
              {t("overview.staking.totalEarned")}
            </Text>
            <AmountText
              value={rewards.total}
              suffix={` ${COIN_SYMBOL}`}
              className="text-foreground text-2xl"
              style={{ fontFamily: FONT_PHUDU_BLACK }}
            />

            <View className="flex-row items-center justify-between mt-3">
              <View>
                <Text className="text-muted-foreground text-xs">
                  {t("overview.staking.last30Days")}
                </Text>
                <AmountText
                  value={rewards.last30}
                  suffix={` ${COIN_SYMBOL}`}
                  className="text-foreground text-sm font-semibold mt-0.5"
                />
              </View>
              <View className="items-end">
                <Text className="text-muted-foreground text-xs">
                  {t("overview.staking.rewardsReceived")}
                </Text>
                <Text className="text-foreground text-sm font-semibold mt-0.5">
                  {formatNumber(rewards.count, 0)}
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </Card>
  );
}
