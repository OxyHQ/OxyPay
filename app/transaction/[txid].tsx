/**
 * Transaction detail screen.
 * Shows full details for a single transaction with editable notes.
 */

import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  useWalletStore,
  getDatabase,
  type WalletTransaction,
} from "../../src/wallet/wallet-store";
import {
  AmountText,
  Section,
  ListItem,
  Card,
  Button,
  Badge,
  EmptyState,
  ScreenHeader,
} from "../../src/ui/components";
import type { ContactRow } from "../../src/storage/database";
import { useTheme } from "@oxyhq/bloom/theme";
import { Dialog, useDialogControl } from "@oxyhq/bloom/dialog";
import { formatUnits, COIN_TICKER, explorerTxUrl } from "@fairco.in/core";
import { t } from "../../src/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function truncateAddress(address: string): string {
  if (address.length <= 20) return address;
  return `${address.slice(0, 10)}...${address.slice(-10)}`;
}

type TransactionType = "send" | "receive" | "stake" | "masternode_reward";

interface TypeBadgeConfig {
  label: string;
  variant: "success" | "warning" | "error" | "info";
}

function getTypeBadge(type: TransactionType): TypeBadgeConfig {
  switch (type) {
    case "send":
      return { label: t("transaction.type.sent"), variant: "error" };
    case "receive":
      return { label: t("transaction.type.received"), variant: "success" };
    case "stake":
      return { label: t("transaction.type.stake"), variant: "warning" };
    case "masternode_reward":
      return {
        label: t("transaction.type.masternodeReward"),
        variant: "success",
      };
  }
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function TransactionDetailScreen() {
  const router = useRouter();
  const { txid } = useLocalSearchParams<{ txid: string }>();
  const transactions = useWalletStore((s) => s.transactions);
  const chainHeight = useWalletStore((s) => s.chainHeight);
  const theme = useTheme();

  const [note, setNote] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [contact, setContact] = useState<ContactRow | null>(null);
  const [contactChecked, setContactChecked] = useState(false);

  const messageControl = useDialogControl();
  const [message, setMessage] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const showMessage = useCallback(
    (title: string, description: string) => {
      setMessage({ title, description });
      messageControl.open();
    },
    [messageControl],
  );

  const transaction = useMemo<WalletTransaction | undefined>(
    () => transactions.find((tx) => tx.txid === txid),
    [transactions, txid],
  );

  // Load note and contact info on layout
  const handleLayout = useCallback(() => {
    if (!txid) return;

    const db = getDatabase();
    if (db && !noteLoaded) {
      db.getTxNote(txid).then((savedNote) => {
        if (savedNote) {
          setNote(savedNote);
        }
        setNoteLoaded(true);
      });
    }

    if (db && transaction && !contactChecked) {
      db.getContactByAddress(transaction.address).then((c) => {
        setContact(c);
        setContactChecked(true);
      });
    }
  }, [txid, noteLoaded, transaction, contactChecked]);

  const handleSaveNote = useCallback(() => {
    if (!txid) return;
    const db = getDatabase();
    if (db) {
      db.setTxNote(txid, note.trim());
      showMessage(
        t("transaction.savedNote.title"),
        t("transaction.savedNote.description"),
      );
    }
  }, [txid, note, showMessage]);

  const handleViewExplorer = useCallback(() => {
    if (!txid) return;
    Linking.openURL(explorerTxUrl(txid));
  }, [txid]);

  const handleCopyTxid = useCallback(() => {
    if (!txid) return;
    Clipboard.setStringAsync(txid);
    showMessage(
      t("transaction.txidCopied.title"),
      t("transaction.txidCopied.description"),
    );
  }, [txid, showMessage]);

  const handleCopyAddress = useCallback(() => {
    if (!transaction) return;
    Clipboard.setStringAsync(transaction.address);
    showMessage(
      t("transaction.addressCopied.title"),
      t("transaction.addressCopied.description"),
    );
  }, [transaction, showMessage]);

  const handleAddToContacts = useCallback(() => {
    router.push("/contacts");
  }, [router]);

  if (!transaction) {
    return (
      <SafeAreaView
        className="flex-1 bg-background"
        edges={["top", "bottom", "left", "right"]}
      >
        <View className="flex-1 items-center justify-center px-8">
          <EmptyState
            icon="file-find"
            title={t("transaction.notFound.title")}
            subtitle={t("transaction.notFound.subtitle")}
          />
          <View className="mt-4">
            <Button
              title={t("transaction.goBack")}
              onPress={() => router.back()}
              variant="secondary"
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const badgeConfig = getTypeBadge(transaction.type);
  const isPositive = transaction.amount >= 0n;
  const amountSign = isPositive ? "+" : "-";
  const absAmount = transaction.amount < 0n ? -transaction.amount : transaction.amount;
  const amountExact = formatUnits(absAmount);
  const amountColor = isPositive ? "text-primary" : "text-red-400";
  const isConfirmed = transaction.confirmations >= 6;

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "bottom", "left", "right"]}
      onLayout={handleLayout}
    >
      <ScreenHeader title={t("transaction.title")} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-4 pb-8"
      >
        {/* Type badge */}
        <View className="items-center mb-4">
          <Badge
            text={badgeConfig.label}
            variant={badgeConfig.variant}
            size="md"
          />
        </View>

        {/* Amount */}
        <View className="items-center mb-6">
          <AmountText
            value={absAmount}
            prefix={amountSign}
            className={`text-3xl font-bold ${amountColor}`}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
          />
          <Text className="text-muted-foreground text-base mt-1">{COIN_TICKER}</Text>
        </View>

        {/* Details */}
        <Section title={t("transaction.details")} className="mb-6">
          <ListItem
            icon="check-circle"
            iconBg={isConfirmed ? "bg-green-500/15" : "bg-yellow-500/15"}
            iconColor={isConfirmed ? theme.colors.success : theme.colors.warning}
            title={t("transaction.status")}
            value={t("transaction.statusValue", {
              status: isConfirmed
                ? t("transaction.status.confirmed")
                : t("transaction.status.pending"),
              count: transaction.confirmations,
            })}
            isLast={false}
          />
          <ListItem
            icon="scale-balance"
            title={t("transaction.amount")}
            value={`${amountSign}${amountExact} ${COIN_TICKER}`}
            isLast={false}
          />
          <ListItem
            icon="identifier"
            title={t("transaction.txid")}
            subtitle={txid ?? ""}
            onPress={handleCopyTxid}
            isLast={false}
          />
          <ListItem
            icon="clock-outline"
            title={t("transaction.date")}
            value={formatTimestamp(transaction.timestamp)}
            isLast={false}
          />
          {transaction.type === "send" ? (
            <ListItem
              icon="currency-usd"
              title={t("transaction.fee")}
              value={t("transaction.feeIncluded")}
              isLast={false}
            />
          ) : null}
          <ListItem
            icon="map-marker"
            title={t("transaction.address")}
            subtitle={
              contact
                ? `${contact.name} (${truncateAddress(transaction.address)})`
                : truncateAddress(transaction.address)
            }
            onPress={handleCopyAddress}
            isLast
          />
        </Section>

        {/* Transaction note */}
        <Section title={t("transaction.note")} className="mb-6">
          <Card className="p-3">
            <TextInput
              className="text-foreground text-sm"
              placeholder={t("transaction.notePlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
            />
          </Card>
          <View className="mt-3">
            <Button
              title={t("transaction.saveNote")}
              onPress={handleSaveNote}
              variant="secondary"
              size="sm"
            />
          </View>
        </Section>

        {/* Actions */}
        <View className="gap-3">
          <Button
            title={t("transaction.viewExplorer")}
            onPress={handleViewExplorer}
            variant="secondary"
            icon={
              <MaterialCommunityIcons
                name="open-in-new"
                size={18}
                color={theme.colors.text}
              />
            }
          />
          <Button
            title={t("transaction.copyTxid")}
            onPress={handleCopyTxid}
            variant="ghost"
            size="sm"
            icon={
              <MaterialCommunityIcons
                name="content-copy"
                size={16}
                color={theme.colors.primary}
              />
            }
          />
          {!contact && contactChecked ? (
            <Button
              title={t("transaction.addToContacts")}
              onPress={handleAddToContacts}
              variant="outline"
              icon={
                <MaterialCommunityIcons
                  name="account-plus"
                  size={18}
                  color={theme.colors.primary}
                />
              }
            />
          ) : null}
        </View>
      </ScrollView>

      <Dialog
        control={messageControl}
        placement="bottom"
        title={message?.title ?? ""}
        description={message?.description ?? ""}
        actions={[{ label: t("common.ok"), onPress: () => setMessage(null) }]}
      />
    </SafeAreaView>
  );
}
