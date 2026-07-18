/**
 * Move-between-Pockets sheet body. Picks a destination Pocket + amount and
 * calls `wallet-store.moveBetweenPockets` (an on-chain self-transfer out of
 * the active Pocket). Content-only body for a Bloom `<Dialog placement="bottom">`,
 * mirroring `SendSheet`'s amount/fee conventions.
 *
 * The destination list is deliberately sourced from the Pockets registry
 * (`pockets`, filtered to exclude the active account) — `moveBetweenPockets`
 * itself does not validate `toAccount`, so this list IS the gate against
 * moving to an unknown account.
 */

import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { parseFairToUnits } from "@fairco.in/core";
import { useTheme } from "@oxyhq/bloom/theme";
import { useWalletStore, FEE_RATES } from "../../wallet/wallet-store";
import { MAIN_POCKET_ACCOUNT } from "../../wallet/pockets";
import { AmountInput, Button, EmptyState, ListItem } from "../components";
import { t } from "../../i18n";

const SECTION_LABEL =
  "text-muted-foreground text-xs font-semibold uppercase tracking-wider";

export function MovePocketSheet({
  onDone,
}: {
  onDone: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const pockets = useWalletStore((s) => s.pockets);
  const activeAccount = useWalletStore((s) => s.activeAccount);
  const moveBetweenPockets = useWalletStore((s) => s.moveBetweenPockets);

  const destinations = useMemo(
    () => pockets.filter((p) => p.account !== activeAccount),
    [pockets, activeAccount],
  );
  const [toAccount, setToAccount] = useState<number | null>(
    destinations[0]?.account ?? null,
  );
  // `amount` is the user-facing FAIR decimal string (same contract as
  // SendSheet) — `parseFairToUnits` converts it to the bigint sats amount.
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountSats = useMemo<bigint | null>(
    () => parseFairToUnits(amount),
    [amount],
  );
  const canMove = toAccount !== null && amountSats !== null && amountSats > 0n;

  const handleMove = useCallback(async () => {
    if (toAccount === null || amountSats === null || amountSats <= 0n) return;
    setBusy(true);
    setError(null);
    try {
      // Same medium fee-rate the send flow defaults to (FEE_RATES is the
      // single source of truth for fee-per-byte; moveBetweenPockets reuses
      // the ordinary send path under the hood).
      await moveBetweenPockets(toAccount, amountSats, FEE_RATES.medium);
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("pockets.move.failed"));
    } finally {
      setBusy(false);
    }
  }, [toAccount, amountSats, moveBetweenPockets, onDone]);

  // No other Pockets to move to yet — this must run AFTER every hook above so
  // that Pockets appearing later (state update while the sheet is open) does
  // not change the hook count between renders (Rules of Hooks).
  if (destinations.length === 0) {
    return (
      <View className="w-full self-center" style={{ maxWidth: 500 }}>
        <EmptyState
          icon="wallet-outline"
          title={t("pockets.move.noDestinations.title")}
          subtitle={t("pockets.move.noDestinations.subtitle")}
        />
      </View>
    );
  }

  return (
    <View className="w-full self-center gap-4" style={{ maxWidth: 500 }}>
      <View>
        <Text className={SECTION_LABEL}>{t("pockets.move.to")}</Text>
        <View className="bg-surface rounded-2xl overflow-hidden mt-2">
          {destinations.map((pocket, idx) => {
            const selected = pocket.account === toAccount;
            const label =
              pocket.account === MAIN_POCKET_ACCOUNT
                ? t("pockets.mainName")
                : pocket.name;
            return (
              <ListItem
                key={pocket.account}
                icon="wallet-outline"
                iconColor={selected ? theme.colors.success : theme.colors.tint}
                title={label}
                onPress={() => setToAccount(pocket.account)}
                showChevron={false}
                isLast={idx === destinations.length - 1}
                trailing={
                  selected ? (
                    <MaterialCommunityIcons
                      name="check-circle"
                      size={22}
                      color={theme.colors.success}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </View>
      </View>

      <View>
        <Text className={SECTION_LABEL}>{t("pockets.move.amountLabel")}</Text>
        <AmountInput
          className="bg-surface rounded-2xl px-4 py-3.5 text-foreground text-base mt-2"
          placeholder={t("send.amountPlaceholder")}
          placeholderTextColor={theme.colors.textSecondary}
          value={amount}
          onValueChange={setAmount}
        />
      </View>

      {error ? (
        <View className="bg-destructive/10 rounded-2xl p-3">
          <Text className="text-destructive text-sm text-center">{error}</Text>
        </View>
      ) : null}

      <Button
        title={t("pockets.move.cta")}
        onPress={handleMove}
        variant="primary"
        disabled={busy || !canMove}
        loading={busy}
      />
    </View>
  );
}
