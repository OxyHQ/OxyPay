/**
 * NetworkHealthCard — a glanceable view of FairCoin network health from the
 * Explorer: current block height, enabled masternode count, and circulating
 * supply. When the stats fetch fails the card shows a subtle "unavailable"
 * state rather than an error.
 */

import { View, Text } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTheme } from "@oxyhq/bloom/theme";
import { Card } from "./Card";
import { COIN_SYMBOL } from "@fairco.in/core";
import { formatNumber, t } from "../../i18n";
import type { NetworkStats } from "../../services/market";

interface NetworkHealthCardProps {
  /** Latest network snapshot, or null when unavailable. */
  stats: NetworkStats | null;
}

export function NetworkHealthCard({ stats }: NetworkHealthCardProps) {
  const theme = useTheme();

  const items = stats
    ? [
        {
          key: "height",
          label: t("overview.network.blockHeight"),
          value: formatNumber(stats.blockHeight, 0),
        },
        {
          key: "masternodes",
          label: t("overview.network.masternodes"),
          value: formatNumber(stats.masternodeCount, 0),
        },
        {
          key: "supply",
          label: t("overview.network.circulatingSupply"),
          value: `${formatNumber(stats.circulatingSupply, 0)} ${COIN_SYMBOL}`,
        },
      ]
    : [];

  return (
    <Card>
      <View className="p-4">
        <View className="flex-row items-center mb-3">
          <View className="w-9 h-9 rounded-full bg-primary/10 items-center justify-center mr-2.5">
            <MaterialCommunityIcons
              name="access-point-network"
              size={18}
              color={theme.colors.primary}
            />
          </View>
          <Text className="text-foreground text-sm font-semibold">
            {t("overview.network.title")}
          </Text>
        </View>

        {stats ? (
          <View className="flex-row">
            {items.map((item) => (
              <View key={item.key} className="flex-1 pr-2">
                <Text
                  className="text-foreground text-base font-semibold"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {item.value}
                </Text>
                <Text className="text-muted-foreground text-xs mt-0.5">
                  {item.label}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className="text-muted-foreground text-sm">
            {t("overview.network.unavailable")}
          </Text>
        )}
      </View>
    </Card>
  );
}
