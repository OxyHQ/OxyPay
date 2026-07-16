/**
 * Coin control screen.
 * Shows all UTXOs and lets users select specific ones for the next transaction.
 * Presented as a modal from settings or the send screen.
 */

import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Dialog, useDialogControl } from "@oxyhq/bloom/dialog";
import { useWalletStore, getDatabase } from "../src/wallet/wallet-store";
import {
  AmountText,
  Section,
  ListItem,
  Card,
  Button,
  EmptyState,
  ScreenHeader,
} from "../src/ui/components";
import { ScrollView } from "react-native";
import { useTheme } from "@oxyhq/bloom/theme";
import { COIN_TICKER } from "@fairco.in/core";
import { t } from "../src/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UTXOItem {
  txid: string;
  vout: number;
  address: string;
  value: bigint;
  blockHeight: number;
  confirmations: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateTxid(txid: string): string {
  if (txid.length <= 16) return txid;
  return `${txid.slice(0, 8)}...${txid.slice(-8)}`;
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function CoinControlScreen() {
  const router = useRouter();
  const chainHeight = useWalletStore((s) => s.chainHeight);
  const existingSelection = useWalletStore((s) => s.selectedUTXOs);
  const setSelectedUTXOs = useWalletStore((s) => s.setSelectedUTXOs);
  const clearSelectedUTXOs = useWalletStore((s) => s.clearSelectedUTXOs);
  const theme = useTheme();

  const [utxos, setUtxos] = useState<UTXOItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Map<string, boolean>>(() => {
    const map = new Map<string, boolean>();
    for (const utxo of existingSelection) {
      map.set(`${utxo.txid}:${utxo.vout}`, true);
    }
    return map;
  });

  const [message, setMessage] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const messageControl = useDialogControl();

  const showMessage = useCallback(
    (title: string, description: string) => {
      setMessage({ title, description });
      messageControl.open();
    },
    [messageControl],
  );

  // Load UTXOs on layout (similar to useFocusEffect without useEffect)
  const handleLayout = useCallback(() => {
    if (loaded) return;
    const db = getDatabase();
    if (!db) return;

    db.getUnspentUTXOs().then((rows) => {
      const items: UTXOItem[] = rows.map((row) => ({
        txid: row.txid,
        vout: row.vout,
        address: row.address,
        value: BigInt(row.value),
        blockHeight: row.block_height,
        confirmations:
          chainHeight > 0 && row.block_height > 0
            ? chainHeight - row.block_height + 1
            : 0,
      }));
      setUtxos(items);
      setLoaded(true);
    });
  }, [loaded, chainHeight]);

  const handleToggle = useCallback((txid: string, vout: number) => {
    const key = `${txid}:${vout}`;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, true);
      }
      return next;
    });
  }, []);

  const selectedCount = selected.size;

  const selectedTotal = useMemo(() => {
    let total = 0n;
    for (const utxo of utxos) {
      const key = `${utxo.txid}:${utxo.vout}`;
      if (selected.has(key)) {
        total += utxo.value;
      }
    }
    return total;
  }, [utxos, selected]);

  const handleApply = useCallback(() => {
    const selectedUtxos: Array<{ txid: string; vout: number }> = [];
    for (const utxo of utxos) {
      const key = `${utxo.txid}:${utxo.vout}`;
      if (selected.has(key)) {
        selectedUtxos.push({ txid: utxo.txid, vout: utxo.vout });
      }
    }
    setSelectedUTXOs(selectedUtxos);
    const count = selectedUtxos.length;
    showMessage(
      t("coinControl.applied.title"),
      count === 1
        ? t("coinControl.applied.description.one", { count })
        : t("coinControl.applied.description.other", { count }),
    );
  }, [utxos, selected, setSelectedUTXOs, showMessage]);

  const handleClear = useCallback(() => {
    setSelected(new Map());
    clearSelectedUTXOs();
  }, [clearSelectedUTXOs]);

  const handleSelectAll = useCallback(() => {
    const next = new Map<string, boolean>();
    for (const utxo of utxos) {
      next.set(`${utxo.txid}:${utxo.vout}`, true);
    }
    setSelected(next);
  }, [utxos]);

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "bottom", "left", "right"]}
      onLayout={handleLayout}
    >
      <ScreenHeader
        title={t("coinControl.title")}
        subtitle={
          utxos.length === 1
            ? t("coinControl.subtitle.one", { count: utxos.length })
            : t("coinControl.subtitle.other", { count: utxos.length })
        }
        onBack={() => router.back()}
      />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-4">
        {/* Selection actions */}
        <View className="flex-row gap-3 mb-4">
          <Pressable
            className="bg-surface border border-border rounded-lg px-3 py-1.5"
            onPress={handleSelectAll}
          >
            <Text className="text-primary text-xs">
              {t("coinControl.selectAll")}
            </Text>
          </Pressable>
          <Pressable
            className="bg-surface border border-border rounded-lg px-3 py-1.5"
            onPress={handleClear}
          >
            <Text className="text-muted-foreground text-xs">
              {t("coinControl.clear")}
            </Text>
          </Pressable>
        </View>

        {/* UTXO list */}
        <Section title={t("coinControl.unspentOutputs")} className="mb-4">
          {utxos.length === 0 ? (
            <EmptyState
              icon="database-off"
              title={t("coinControl.empty.title")}
              subtitle={t("coinControl.empty.subtitle")}
            />
          ) : (
            utxos.map((utxo, idx) => {
              const key = `${utxo.txid}:${utxo.vout}`;
              const isSelected = selected.has(key);
              return (
                <ListItem
                  key={`utxo-${idx}-${key}`}
                  title={`${truncateTxid(utxo.txid)}:${utxo.vout}`}
                  subtitle={`${utxo.address.slice(0, 12)}...`}
                  value={
                    <AmountText
                      value={utxo.value}
                      fixedDecimalScale
                      suffix={` ${COIN_TICKER}`}
                      className="text-muted-foreground text-sm"
                    />
                  }
                  isLast={idx === utxos.length - 1}
                  onPress={() => handleToggle(utxo.txid, utxo.vout)}
                  showChevron={false}
                  trailing={
                    <View
                      className={`w-5 h-5 rounded border items-center justify-center ${
                        isSelected
                          ? "bg-primary border-primary"
                          : "bg-transparent border-muted-foreground"
                      }`}
                    >
                      {isSelected ? (
                         <MaterialCommunityIcons
                          name="check"
                          size={14}
                          color={theme.colors.background}
                        />
                      ) : null}
                    </View>
                  }
                />
              );
            })
          )}
        </Section>

        {/* Selection summary */}
        {selectedCount > 0 ? (
          <Card className="p-4 mb-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">
                {selectedCount === 1
                  ? t("coinControl.selected.one", { count: selectedCount })
                  : t("coinControl.selected.other", { count: selectedCount })}
              </Text>
              <AmountText
                value={selectedTotal}
                fixedDecimalScale
                suffix={` ${COIN_TICKER}`}
                className="text-primary text-sm font-semibold"
              />
            </View>
          </Card>
        ) : null}
      </ScrollView>

      {/* Bottom action bar */}
      <View className="px-5 py-4 border-t border-border">
        <Button
          title={
            selectedCount > 0
              ? selectedCount === 1
                ? t("coinControl.useCta.one", { count: selectedCount })
                : t("coinControl.useCta.other", { count: selectedCount })
              : t("coinControl.selectCta")
          }
          onPress={handleApply}
          variant="primary"
          disabled={selectedCount === 0}
        />
      </View>

      <Dialog
        control={messageControl}
        placement="bottom"
        title={message?.title ?? ""}
        description={message?.description ?? ""}
        actions={[
          {
            label: t("common.ok"),
            onPress: () => {
              setMessage(null);
              router.back();
            },
          },
        ]}
      />
    </SafeAreaView>
  );
}
