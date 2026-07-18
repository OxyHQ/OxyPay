/**
 * PocketCard — one row in the Pockets home list: an emoji chip tinted with
 * the Pocket's own color, its name (+ a "Main" badge for the implicit main
 * Pocket), an optional goal progress bar, and the balance right-aligned.
 * Matches the approved Revolut-style Pockets design (mockup: colored emoji
 * chip + goal bar per card).
 */

import { View, Text, Pressable } from "react-native";
import { UNITS_PER_COIN } from "@fairco.in/core";
import { AmountText } from "./AmountText";
import { Badge } from "./Badge";
import { MAIN_POCKET_ACCOUNT, type PocketInfo } from "../../wallet/pockets";
import { t } from "../../i18n";

/** ~16% alpha, matching the mockup's `color-mix(... 16%, var(--card))` chip tint. */
const CHIP_TINT_ALPHA = "29";

function formatGoalAmount(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

interface PocketCardProps {
  pocket: PocketInfo;
  balance: bigint;
  onPress: () => void;
}

export function PocketCard({ pocket, balance, onPress }: PocketCardProps) {
  const isMain = pocket.account === MAIN_POCKET_ACCOUNT;
  const label = isMain ? t("pockets.mainName") : pocket.name;
  const balanceFair = Number(balance) / Number(UNITS_PER_COIN);
  const goalPercent =
    pocket.goal && pocket.goal > 0
      ? Math.min(100, Math.round((balanceFair / pocket.goal) * 100))
      : null;

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-surface rounded-2xl px-4 py-3.5 mb-3 active:opacity-80"
    >
      <View
        className="w-12 h-12 rounded-2xl items-center justify-center mr-3.5"
        style={{ backgroundColor: `${pocket.color}${CHIP_TINT_ALPHA}` }}
      >
        <Text style={{ fontSize: 22 }}>{pocket.emoji}</Text>
      </View>

      <View className="flex-1 min-w-0 mr-3">
        <View className="flex-row items-center gap-2">
          <Text
            className="text-foreground text-[15.5px] font-semibold"
            numberOfLines={1}
          >
            {label}
          </Text>
          {isMain ? <Badge text={t("pockets.mainBadge")} size="sm" /> : null}
        </View>
        {isMain && goalPercent === null ? (
          <Text className="text-muted-foreground text-xs mt-0.5" numberOfLines={1}>
            {t("pockets.mainSubtitle")}
          </Text>
        ) : null}

        {goalPercent !== null ? (
          <View className="mt-2.5">
            <View className="h-1.5 rounded-full bg-background overflow-hidden">
              <View
                className="h-full rounded-full"
                style={{
                  width: `${goalPercent}%`,
                  backgroundColor: pocket.color,
                }}
              />
            </View>
            <View className="flex-row justify-between mt-1.5">
              <Text className="text-muted-foreground text-[11px]">
                {t("pockets.goal.progress", {
                  current: formatGoalAmount(balanceFair),
                  target: formatGoalAmount(pocket.goal ?? 0),
                })}
              </Text>
              <Text className="text-muted-foreground text-[11px] font-semibold">
                {goalPercent}%
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <View className="items-end">
        <AmountText value={balance} className="text-foreground text-base font-bold" />
        <Text className="text-muted-foreground text-[11px] font-semibold mt-0.5">
          FAIR
        </Text>
      </View>
    </Pressable>
  );
}
