/**
 * Transaction list item — Revolut-inspired clean design.
 * Tappable to navigate to transaction details.
 */

import { useMemo } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTheme } from "@oxyhq/bloom/theme";
import { AmountText } from "./AmountText";
import { COIN_SYMBOL } from "@fairco.in/core";
import { t } from "../../i18n";

type TransactionType = "send" | "receive" | "stake" | "masternode_reward";

interface TransactionItemProps {
  txid: string;
  type: TransactionType;
  /** Signed amount in smallest units (m⊜). The absolute value is rendered. */
  value: bigint;
  address: string;
  timestamp: number;
  confirmations: number;
}

interface TypeConfig {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  iconBg: string;
  amountColor: string;
  labelKey: string;
  prefix: string;
}

const STATIC_TYPE_CONFIG: Record<TransactionType, TypeConfig & { iconColor: string }> = {
  send: {
    icon: "arrow-up",
    iconBg: "bg-red-500/10",
    iconColor: "#f87171",
    amountColor: "text-red-400",
    labelKey: "transaction.item.sent",
    prefix: "-",
  },
  receive: {
    icon: "arrow-down",
    iconBg: "bg-primary/10",
    iconColor: "", // resolved from theme
    amountColor: "text-primary",
    labelKey: "transaction.item.received",
    prefix: "+",
  },
  stake: {
    icon: "star-outline",
    iconBg: "bg-purple-500/10",
    iconColor: "#a78bfa",
    amountColor: "text-purple-400",
    labelKey: "transaction.item.stake",
    prefix: "+",
  },
  masternode_reward: {
    icon: "server",
    iconBg: "bg-blue-500/10",
    iconColor: "#60a5fa",
    amountColor: "text-blue-400",
    labelKey: "transaction.item.masternodeReward",
    prefix: "+",
  },
};

function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return t("transaction.item.justNow");
  if (diff < 3600) {
    return t("transaction.item.minutesAgo", { count: Math.floor(diff / 60) });
  }
  if (diff < 86400) {
    return t("transaction.item.hoursAgo", { count: Math.floor(diff / 3600) });
  }
  if (diff < 604800) {
    return t("transaction.item.daysAgo", { count: Math.floor(diff / 86400) });
  }

  const date = new Date(timestamp * 1000);
  const month = date.toLocaleString("en", { month: "short" });
  const day = date.getDate();
  return `${month} ${day}`;
}

function truncateAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function TransactionItem({
  txid,
  type,
  value,
  address,
  timestamp,
  confirmations,
}: TransactionItemProps) {
  const router = useRouter();
  const theme = useTheme();
  const staticConfig = STATIC_TYPE_CONFIG[type];
  const iconColor = type === "receive" ? theme.colors.primary : staticConfig.iconColor;
  const timeAgo = useMemo(() => formatTimeAgo(timestamp), [timestamp]);
  const truncated = useMemo(() => truncateAddress(address), [address]);
  const absValue = value < 0n ? -value : value;

  const isPending = confirmations === 0;

  return (
    <Pressable
      className="flex-row items-center py-3.5 px-4 active:bg-background/50"
      onPress={() => router.push(`/transaction/${txid}`)}
    >
      {/* Icon */}
      <View
        className={`w-11 h-11 rounded-full ${staticConfig.iconBg} items-center justify-center mr-3`}
      >
        <MaterialCommunityIcons
          name={staticConfig.icon}
          size={20}
          color={iconColor}
        />
      </View>

      {/* Label + address */}
      <View className="flex-1 mr-3">
        <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
          {t(staticConfig.labelKey)}
        </Text>
        <View className="flex-row items-center mt-0.5">
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {truncated}
          </Text>
          {isPending ? (
            <View className="ml-2 bg-yellow-500/15 rounded-full px-1.5 py-0.5">
              <Text className="text-yellow-400 text-[9px] font-bold">
                {t("transaction.item.pending")}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Amount + time */}
      <View className="items-end">
        <AmountText
          value={absValue}
          prefix={staticConfig.prefix}
          symbol
          symbolSize={13}
          className={`text-sm font-semibold ${staticConfig.amountColor}`}
        />
        <Text className="text-muted-foreground text-xs mt-0.5">{timeAgo}</Text>
      </View>
    </Pressable>
  );
}
