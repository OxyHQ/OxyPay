/**
 * Wallet switcher sheet content.
 *
 * Content-only body for a quick wallet switch, rendered inside a Bloom
 * bottom-sheet `<Dialog placement="bottom">` opened from the home header. It
 * renders NO full-screen wrapper, NO safe-area padding, and NO scroll container
 * of its own: the host `<Dialog>` is wired WITH a `title` (like Receive/Send),
 * so Bloom's sheet supplies its own internal `ScrollView`. Adding a second
 * scroller here would produce a scroll-in-scroll, so long lists scroll via the
 * host sheet, matching `ReceiveSheet`.
 *
 * Tapping a non-active wallet switches to it and closes the sheet; the active
 * wallet just closes. A bottom "Manage wallets" row closes the sheet and opens
 * the full `app/wallets.tsx` management screen.
 */

import type React from "react";
import { useCallback, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTheme } from "@oxyhq/bloom/theme";
import { useWalletStore } from "../../wallet/wallet-store";
import { ListItem } from "../components";
import { t } from "../../i18n";

const CONTENT_MAX_WIDTH = 500;

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function WalletSwitcherSheet({
  onDone,
}: {
  onDone: () => void;
}): React.JSX.Element {
  const wallets = useWalletStore((s) => s.wallets);
  const activeWalletId = useWalletStore((s) => s.activeWalletId);
  const switchWallet = useWalletStore((s) => s.switchWallet);
  const theme = useTheme();
  const router = useRouter();

  // Id of the wallet currently being switched to. Drives the per-row spinner and
  // gates concurrent taps so a double-press can't kick off two switches (the
  // store serialises internally, but blocking here keeps the UI honest).
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const handleSelect = useCallback(
    async (walletId: string) => {
      if (switchingId) return;
      if (walletId === activeWalletId) {
        onDone();
        return;
      }
      setSwitchingId(walletId);
      // switchWallet resolves once the new wallet is hydrated; it handles its
      // own errors internally (surfaces them via the store's `error` state and
      // never rejects), so there is nothing to catch here.
      await switchWallet(walletId);
      onDone();
    },
    [switchingId, activeWalletId, switchWallet, onDone],
  );

  const handleManage = useCallback(() => {
    onDone();
    router.push("/wallets");
  }, [onDone, router]);

  return (
    <View
      className="w-full self-center gap-4"
      style={{ maxWidth: CONTENT_MAX_WIDTH }}
    >
      {/* Wallet list — card-less surface container */}
      <View className="bg-surface rounded-2xl overflow-hidden">
        {wallets.map((wallet, idx) => {
          const isActive = wallet.id === activeWalletId;
          const isSwitching = wallet.id === switchingId;
          return (
            <ListItem
              key={wallet.id}
              icon="wallet"
              iconBg={isActive ? "bg-green-500/15" : "bg-primary/10"}
              iconColor={isActive ? theme.colors.success : theme.colors.tint}
              title={wallet.name}
              subtitle={t("wallets.createdOn", {
                date: formatDate(wallet.createdAt),
              })}
              onPress={() => handleSelect(wallet.id)}
              showChevron={false}
              isLast={idx === wallets.length - 1}
              trailing={
                isSwitching ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.primary}
                  />
                ) : isActive ? (
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

      {/* Manage / add wallets — jumps to the full management screen */}
      <View className="bg-surface rounded-2xl overflow-hidden">
        <ListItem
          icon="cog-outline"
          title={t("settings.wallets")}
          onPress={handleManage}
          isLast
        />
      </View>
    </View>
  );
}
