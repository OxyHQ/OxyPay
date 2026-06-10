/**
 * Send screen.
 * Allows user to send FAIR to an address with fee selection.
 * Revolut-inspired layout: hero amount on top, recipient card, fee pills,
 * fixed send button at the bottom.
 */

import { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import {
  useWalletStore,
  getDatabase,
  type FeeLevel,
} from "../../src/wallet/wallet-store";
import { useContactsStore } from "../../src/wallet/contacts-store";
import {
  AmountInput,
  AmountText,
  Card,
  Button,
  ContactAvatar,
  ListItem,
  Divider,
  EmptyState,
} from "../../src/ui/components";
import { QRScanner } from "../../src/ui/components/QRScanner";
import { ContactPicker } from "../../src/ui/components/ContactPicker";
import { getCachedPrice } from "../../src/services/price";
import type { RecentRecipientRow, ContactRow } from "../../src/storage/database";
import { useTheme } from "@oxyhq/bloom/theme";
import * as Prompt from "@oxyhq/bloom/prompt";
import { hapticSuccess, hapticError } from "../../src/utils/haptics";
import { playSent } from "../../src/services/sounds";
import { FONT_PHUDU_BLACK, FONT_PHUDU_LIGHT } from "../../src/utils/fonts";
import {
  formatFair,
  parseFairToUnits,
  validateAddress,
  getNetwork,
  COIN_SYMBOL,
  COIN_TICKER,
  UNITS_PER_COIN,
  explorerTxUrl,
} from "@fairco.in/core";
import { t } from "../../src/i18n";

const FEE_LEVELS: FeeLevel[] = ["low", "medium", "high"];

function getFeeLabel(level: FeeLevel): string {
  switch (level) {
    case "low":
      return t("send.fee.low");
    case "medium":
      return t("send.fee.medium");
    case "high":
      return t("send.fee.high");
  }
}

const CONTENT_MAX_WIDTH = 600;
const AMOUNT_FONT_SIZE_MAX = 44;
const AMOUNT_FONT_SIZE_MIN = 22;
const AMOUNT_SYMBOL_RATIO = 34 / 44;
// Length at which the amount font starts shrinking from its max size.
const AMOUNT_SHRINK_THRESHOLD = 9;
// Length at which the amount font reaches its minimum size.
const AMOUNT_SHRINK_FLOOR = 18;

/**
 * Compute a responsive font size for the hero amount based on how
 * many characters the user has typed. This is the cross-platform
 * alternative to `adjustsFontSizeToFit`, which React Native's
 * TextInput typings do not officially expose.
 */
function getAmountFontSize(length: number): number {
  if (length <= AMOUNT_SHRINK_THRESHOLD) return AMOUNT_FONT_SIZE_MAX;
  if (length >= AMOUNT_SHRINK_FLOOR) return AMOUNT_FONT_SIZE_MIN;
  const range = AMOUNT_SHRINK_FLOOR - AMOUNT_SHRINK_THRESHOLD;
  const progress = (length - AMOUNT_SHRINK_THRESHOLD) / range;
  const span = AMOUNT_FONT_SIZE_MAX - AMOUNT_FONT_SIZE_MIN;
  return Math.round(AMOUNT_FONT_SIZE_MAX - span * progress);
}

function truncateAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export default function SendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const confirmedBalance = useWalletStore((s) => s.confirmedBalance);
  const sendTransaction = useWalletStore((s) => s.sendTransaction);
  const estimateFee = useWalletStore((s) => s.estimateFee);
  const estimateSend = useWalletStore((s) => s.estimateSend);
  const loading = useWalletStore((s) => s.loading);
  const isWatchOnly = useWalletStore((s) => s.isWatchOnly);
  const selectedUTXOs = useWalletStore((s) => s.selectedUTXOs);
  const network = useWalletStore((s) => s.network);
  const contacts = useContactsStore((s) => s.contacts);
  const loadContacts = useContactsStore((s) => s.loadContacts);
  const getContactByAddress = useContactsStore((s) => s.getContactByAddress);
  const theme = useTheme();

  // Read deep link params (from faircoin: URI or QR scan navigation)
  const params = useLocalSearchParams<{ address?: string; amount?: string }>();

  const [toAddress, setToAddress] = useState(params.address ?? "");
  // `amount` is the user-facing decimal string with optional dot (no
  // thousands separators). e.g. "1.5". `<AmountInput>` adds the
  // separators visually while typing and `parseFairToUnits` converts to
  // the bigint smallest-unit count when needed.
  const [amount, setAmount] = useState(params.amount ?? "");
  const [feeLevel, setFeeLevel] = useState<FeeLevel>("medium");
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [recentRecipients, setRecentRecipients] = useState<
    RecentRecipientRow[]
  >([]);
  const [pendingSaveAddress, setPendingSaveAddress] = useState<string | null>(
    null,
  );
  const [sentTxid, setSentTxid] = useState<string | null>(null);
  const confirmControl = Prompt.usePromptControl();
  const saveContactControl = Prompt.usePromptControl();
  const sentControl = Prompt.usePromptControl();

  const explorerUrl = sentTxid ? explorerTxUrl(sentTxid) : "";

  const handleCopyExplorerLink = useCallback(async () => {
    if (!explorerUrl) return;
    await Clipboard.setStringAsync(explorerUrl);
  }, [explorerUrl]);

  const handleShareExplorerLink = useCallback(async () => {
    if (!explorerUrl) return;
    if (!(await Sharing.isAvailableAsync())) {
      await Clipboard.setStringAsync(explorerUrl);
      return;
    }
    // Sharing.shareAsync requires a file URI on native, so write the link to
    // a temporary text file in the cache directory and share that.
    const file = new File(Paths.cache, "fairwallet-tx-link.txt");
    if (file.exists) file.delete();
    file.create();
    file.write(explorerUrl);
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/plain",
      dialogTitle: t("send.sent.share"),
      UTI: "public.plain-text",
    });
  }, [explorerUrl]);

  const handleSentDismiss = useCallback(() => {
    setSentTxid(null);
  }, []);

  // Numeric fee rate (base units per byte) for the selected level. Must match
  // the rate sendTransaction is called with so the displayed fee is the real one.
  const feeRate = useMemo(
    () => (feeLevel === "high" ? 10 : feeLevel === "medium" ? 5 : 1),
    [feeLevel],
  );

  const amountSats = useMemo<bigint | null>(
    () => parseFairToUnits(amount),
    [amount],
  );

  // Real, pre-broadcast estimate computed from the actual coins that would be
  // selected (largest-first, or the coin-control set). `selectedUTXOs` is in the
  // dependency list so the estimate updates when coin control changes.
  const sendEstimate = useMemo(
    () => estimateSend(amountSats ?? 0n, feeRate),
    [estimateSend, amountSats, feeRate, selectedUTXOs],
  );

  // Fee actually charged for this send (recipient + change over the selected
  // inputs). Falls back to the flat per-level estimate only when no concrete
  // selection exists yet (e.g. amount not entered), purely for display.
  const fee = sendEstimate.fee ?? estimateFee(feeLevel);

  const totalSats = useMemo<bigint>(() => {
    if (amountSats === null || amountSats === 0n) return 0n;
    return sendEstimate.total ?? amountSats + fee;
  }, [amountSats, sendEstimate.total, fee]);

  // Full base58check + network-version validation (review finding M3). A
  // prefix/length check let malformed or wrong-network addresses pass and the
  // Send button enable; an invalid address would burn funds. We still show the
  // gentler "too short" hint for clearly-partial input.
  const addressValid = useMemo(
    () => validateAddress(toAddress, getNetwork(network)),
    [toAddress, network],
  );

  const validationError = useMemo(() => {
    if (toAddress.length > 0 && toAddress.length < 25) {
      return t("send.error.addressTooShort");
    }
    if (toAddress.length >= 25 && !addressValid) {
      return t("send.error.invalidAddress");
    }
    if (amount.length > 0 && (amountSats === null || amountSats <= 0n)) {
      return t("send.error.invalidAmount");
    }
    // Gate against the REAL fee over confirmed/selected coins, not a flat
    // estimate against the (possibly unconfirmed-inflated) total balance.
    if (
      amountSats !== null &&
      amountSats > 0n &&
      sendEstimate.insufficientFunds
    ) {
      return t("send.error.insufficientBalance");
    }
    return null;
  }, [toAddress, addressValid, amount, amountSats, sendEstimate.insufficientFunds]);

  const canSend =
    addressValid &&
    amountSats !== null &&
    amountSats > 0n &&
    validationError === null;

  const usdEquivalent = useMemo(() => {
    const price = getCachedPrice();
    if (price && amountSats !== null && amountSats > 0n) {
      const fair = Number(amountSats) / Number(UNITS_PER_COIN);
      return (fair * price.usd).toFixed(2);
    }
    return null;
  }, [amountSats]);

  const matchedContact = useMemo<ContactRow | null>(() => {
    if (toAddress.length < 25) return null;
    const found = contacts.find((c) => c.address === toAddress);
    return found ?? null;
  }, [contacts, toAddress]);

  const recentRecipientLookup = useMemo(() => {
    const map = new Map<string, ContactRow>();
    for (const c of contacts) {
      map.set(c.address, c);
    }
    return map;
  }, [contacts]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        setToAddress(text.trim());
      }
    } catch {
      setError(t("send.error.clipboard"));
    }
  }, []);

  const handleQRScan = useCallback((address: string) => {
    setToAddress(address);
  }, []);

  const handleOpenScanner = useCallback(() => {
    setShowQRScanner(true);
  }, []);

  const handleCloseScanner = useCallback(() => {
    setShowQRScanner(false);
  }, []);

  const handleOpenContactPicker = useCallback(() => {
    setShowContactPicker(true);
  }, []);

  const handleCloseContactPicker = useCallback(() => {
    setShowContactPicker(false);
  }, []);

  const handleContactSelect = useCallback((address: string) => {
    setToAddress(address);
  }, []);

  const handleClearRecipient = useCallback(() => {
    setToAddress("");
  }, []);

  const loadInitialData = useCallback(() => {
    const db = getDatabase();
    if (db) {
      db.getRecentRecipients(5).then(setRecentRecipients);
      loadContacts(db);
    }
  }, [loadContacts]);

  const refreshRecentRecipients = useCallback(() => {
    const db = getDatabase();
    if (db) {
      db.getRecentRecipients(5).then(setRecentRecipients);
    }
  }, []);

  const handleRecentRecipientPress = useCallback((address: string) => {
    setToAddress(address);
  }, []);

  const handleMax = useCallback(() => {
    // Max is the largest amount actually sendable: confirmed (or coin-control)
    // coins minus the fee to spend them, never the unconfirmed-inflated balance.
    const maxSats = sendEstimate.maxSendable;
    setAmount(maxSats > 0n ? formatFair(maxSats) : "");
  }, [sendEstimate.maxSendable]);

  const handleSendPress = useCallback(() => {
    setError(null);
    setSuccess(null);
    confirmControl.open();
  }, [confirmControl]);

  const handleConfirmSend = useCallback(async () => {
    setError(null);
    try {
      if (amountSats === null || amountSats <= 0n) {
        setError(t("send.error.invalidAmount"));
        return;
      }
      const sentAddress = toAddress;
      const txid = await sendTransaction(sentAddress, amountSats, feeRate);
      hapticSuccess();
      playSent();
      setSuccess(null);
      setToAddress("");
      setAmount("");
      setSentTxid(txid);
      sentControl.open();

      // Record recent recipient
      const db = getDatabase();
      if (db) {
        db.addRecentRecipient(sentAddress);
        refreshRecentRecipients();

        // Prompt to save as contact if not already saved
        const existingContact = await getContactByAddress(db, sentAddress);
        if (!existingContact) {
          setPendingSaveAddress(sentAddress);
          saveContactControl.open();
        }
      }
    } catch (e: unknown) {
      hapticError();
      const msg =
        e instanceof Error ? e.message : t("send.error.failedSend");
      setError(msg);
    }
  }, [
    toAddress,
    amountSats,
    feeRate,
    sendTransaction,
    getContactByAddress,
    refreshRecentRecipients,
    saveContactControl,
    sentControl,
  ]);

  const hasAmount = amount.length > 0;

  const amountLengthForSizing = amount.length > 0 ? amount.length : 1;
  const amountFontSize = getAmountFontSize(amountLengthForSizing);
  const amountSymbolFontSize = Math.round(amountFontSize * AMOUNT_SYMBOL_RATIO);

  // Watch-only wallets cannot send transactions. This branch must run AFTER
  // every hook above so that toggling watch-only at runtime (wallet switch)
  // does not change the hook count between renders (Rules of Hooks).
  if (isWatchOnly) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <EmptyState
          icon="lock"
          title={t("send.watchOnly.title")}
          subtitle={t("send.watchOnly.subtitle")}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background" onLayout={loadInitialData}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-40 gap-5"
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          className="w-full self-center gap-5"
          style={{ maxWidth: CONTENT_MAX_WIDTH }}
        >
          {/* Hero amount */}
          <View className="items-center pt-4 pb-2">
            <View className="flex-row items-baseline justify-center w-full px-4">
              <Text
                className="text-primary mr-1"
                style={{
                  fontFamily: FONT_PHUDU_LIGHT,
                  fontSize: amountSymbolFontSize,
                  includeFontPadding: false,
                }}
                numberOfLines={1}
              >
                {COIN_SYMBOL}
              </Text>
              <AmountInput
                className="text-foreground flex-shrink"
                style={{
                  fontFamily: FONT_PHUDU_BLACK,
                  fontSize: amountFontSize,
                  paddingVertical: 0,
                  includeFontPadding: false,
                }}
                placeholder={t("send.amountPlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                value={amount}
                onValueChange={setAmount}
                maxLength={20}
                numberOfLines={1}
              />
            </View>
            <Pressable
              onPress={handleMax}
              className="bg-primary/10 rounded-full px-3 py-1.5 mt-2"
              accessibilityLabel={t("send.maxAccessibility")}
            >
              <Text className="text-primary text-xs font-semibold">
                {t("send.max")}
              </Text>
            </Pressable>
            <Text className="text-muted-foreground text-sm mt-2">
              {t("send.usdApprox", { amount: usdEquivalent ?? "0.00" })}
            </Text>
            <Text className="text-muted-foreground text-xs mt-1">
              {t("send.available", { amount: formatFair(confirmedBalance) })}
            </Text>
          </View>

          {/* Recipient card */}
          <Card className="p-4">
            <Text className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider mb-2">
              {t("send.sendTo")}
            </Text>
            {matchedContact ? (
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1">
                  <View className="mr-3">
                    <ContactAvatar name={matchedContact.name} size={40} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-foreground text-base font-semibold">
                      {matchedContact.name}
                    </Text>
                    <Text className="text-muted-foreground text-xs mt-0.5">
                      {truncateAddress(matchedContact.address)}
                    </Text>
                  </View>
                </View>
                <Pressable
                  className="p-2 rounded-full active:opacity-60"
                  onPress={handleClearRecipient}
                  accessibilityLabel={t("send.clearRecipient")}
                >
                  <MaterialCommunityIcons
                    name="close-circle"
                    size={20}
                    color={theme.colors.textSecondary}
                  />
                </Pressable>
              </View>
            ) : (
              <TextInput
                className="text-foreground text-base"
                style={{ paddingVertical: 4 }}
                placeholder={t("send.addressPlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                value={toAddress}
                onChangeText={setToAddress}
                autoCapitalize="none"
                autoCorrect={false}
                multiline={false}
              />
            )}

            <View className="flex-row gap-2 mt-3">
              <Pressable
                className="flex-row items-center bg-primary/10 rounded-full px-3 py-2 active:opacity-70"
                onPress={handlePaste}
              >
                <MaterialCommunityIcons
                  name="content-paste"
                  size={14}
                  color={theme.colors.primary}
                />
                <Text className="text-primary text-xs ml-1.5 font-semibold">
                  {t("send.paste")}
                </Text>
              </Pressable>
              <Pressable
                className="flex-row items-center bg-primary/10 rounded-full px-3 py-2 active:opacity-70"
                onPress={handleOpenScanner}
              >
                <MaterialCommunityIcons
                  name="qrcode-scan"
                  size={14}
                  color={theme.colors.primary}
                />
                <Text className="text-primary text-xs ml-1.5 font-semibold">
                  {t("send.scanQR")}
                </Text>
              </Pressable>
              <Pressable
                className="flex-row items-center bg-primary/10 rounded-full px-3 py-2 active:opacity-70"
                onPress={handleOpenContactPicker}
              >
                <MaterialCommunityIcons
                  name="account-box"
                  size={14}
                  color={theme.colors.primary}
                />
                <Text className="text-primary text-xs ml-1.5 font-semibold">
                  {t("send.contacts")}
                </Text>
              </Pressable>
            </View>
          </Card>

          {validationError && toAddress.length > 0 ? (
            <Text className="text-destructive text-xs -mt-3 px-1">
              {validationError}
            </Text>
          ) : null}

          {/* Recent recipients */}
          {recentRecipients.length > 0 ? (
            <View>
              <Text className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider mb-2 px-1">
                {t("send.recent")}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-2 pr-4"
              >
                {recentRecipients.map((r) => {
                  const contact = recentRecipientLookup.get(r.address);
                  const isSelected = toAddress === r.address;
                  return (
                    <Pressable
                      key={r.address}
                      onPress={() => handleRecentRecipientPress(r.address)}
                      className={`flex-row items-center rounded-full px-3 py-2 ${
                        isSelected
                          ? "bg-primary/20 border border-primary"
                          : "bg-surface border border-transparent"
                      }`}
                    >
                      <View className="mr-2">
                        <ContactAvatar
                          name={contact?.name ?? r.address}
                          size={28}
                        />
                      </View>
                      <Text className="text-foreground text-xs font-medium">
                        {contact?.name ?? truncateAddress(r.address)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {/* Fee selector */}
          <View>
            <Text className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider mb-2 px-1">
              {t("send.networkFee")}
            </Text>
            <View className="flex-row gap-2">
              {FEE_LEVELS.map((level) => {
                const isSelected = feeLevel === level;
                return (
                  <Pressable
                    key={level}
                    className={`flex-1 rounded-full py-3 items-center border ${
                      isSelected
                        ? "bg-primary/10 border-primary"
                        : "bg-surface border-transparent"
                    }`}
                    onPress={() => setFeeLevel(level)}
                  >
                    <Text
                      className={`text-sm font-semibold ${
                        isSelected ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {getFeeLabel(level)}
                    </Text>
                    <Text className="text-muted-foreground text-[10px] mt-0.5">
                      {t("send.feeUnit", { units: estimateFee(level).toString() })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Error / Success messages */}
          {error ? (
            <Card className="border border-destructive/50 p-4">
              <Text className="text-destructive text-sm text-center">
                {error}
              </Text>
            </Card>
          ) : null}
          {success ? (
            <Card className="border border-primary/50 p-4">
              <Text className="text-primary text-sm text-center">
                {success}
              </Text>
            </Card>
          ) : null}
        </View>
      </ScrollView>

      {/* Fixed bottom bar: total + send button */}
      <View
        className="absolute left-0 right-0 bottom-0 bg-background border-t border-border"
        style={{ paddingBottom: insets.bottom + 12, paddingTop: 12 }}
      >
        <View
          className="w-full self-center px-4 gap-2"
          style={{ maxWidth: CONTENT_MAX_WIDTH }}
        >
          {hasAmount ? (
            <View className="flex-row justify-between items-center px-1">
              <Text className="text-muted-foreground text-xs">
                {t("send.total")}
              </Text>
              <AmountText
                value={totalSats}
                suffix={` ${COIN_TICKER}`}
                className="text-foreground text-sm font-semibold"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              />
            </View>
          ) : null}
          <Button
            title={t("send.sendCta")}
            onPress={handleSendPress}
            variant="primary"
            size="lg"
            disabled={!canSend}
            loading={loading}
          />
        </View>
      </View>

      {/* Confirmation prompt */}
      <Prompt.Outer control={confirmControl}>
        <Prompt.Content>
          <Prompt.TitleText>{t("send.confirm.title")}</Prompt.TitleText>
          <View className="mt-2">
            <ListItem
              title={t("send.confirm.to")}
              subtitle={matchedContact ? matchedContact.name : toAddress}
              showChevron={false}
            />
            <ListItem
              title={t("send.confirm.amount")}
              value={
                <AmountText
                  value={amountSats ?? 0n}
                  fixedDecimalScale
                  suffix={` ${COIN_TICKER}`}
                  className="text-muted-foreground text-sm"
                />
              }
              showChevron={false}
            />
            <ListItem
              title={t("send.confirm.fee")}
              value={
                <AmountText
                  value={fee}
                  fixedDecimalScale
                  suffix={` ${COIN_TICKER}`}
                  className="text-muted-foreground text-sm"
                />
              }
              showChevron={false}
            />
            <Divider className="mx-4" />
            <ListItem
              title={t("send.confirm.total")}
              value={
                <AmountText
                  value={totalSats}
                  fixedDecimalScale
                  suffix={` ${COIN_TICKER}`}
                  className="text-muted-foreground text-sm"
                />
              }
              showChevron={false}
              isLast
            />
          </View>
        </Prompt.Content>
        <Prompt.Actions>
          <Prompt.Action
            cta={t("send.confirm.cta")}
            onPress={handleConfirmSend}
            color="primary"
          />
          <Prompt.Action
            cta={t("common.cancel")}
            onPress={() => confirmControl.close()}
            color="secondary"
          />
        </Prompt.Actions>
      </Prompt.Outer>

      {/* Transaction sent prompt */}
      <Prompt.Outer control={sentControl} onClose={handleSentDismiss}>
        <Prompt.Content>
          <Prompt.TitleText>{t("send.sent.title")}</Prompt.TitleText>
          <Prompt.DescriptionText selectable>
            {explorerUrl}
          </Prompt.DescriptionText>
        </Prompt.Content>
        <Prompt.Actions>
          <Prompt.Action
            cta={t("send.sent.copy")}
            onPress={handleCopyExplorerLink}
            color="primary"
            shouldCloseOnPress={false}
          />
          <Prompt.Action
            cta={t("send.sent.share")}
            onPress={handleShareExplorerLink}
            color="primary_subtle"
            shouldCloseOnPress={false}
          />
          <Prompt.Action
            cta={t("common.done")}
            onPress={handleSentDismiss}
            color="secondary"
          />
        </Prompt.Actions>
      </Prompt.Outer>

      {/* Save contact prompt */}
      <Prompt.Basic
        control={saveContactControl}
        title={t("send.saveContact.title")}
        description={
          pendingSaveAddress
            ? t("send.saveContact.description", {
                address:
                  pendingSaveAddress.length > 16
                    ? `${pendingSaveAddress.slice(0, 8)}...${pendingSaveAddress.slice(-8)}`
                    : pendingSaveAddress,
              })
            : ""
        }
        confirmButtonCta={t("send.saveContact.cta")}
        cancelButtonCta={t("common.no")}
        onConfirm={() => {
          router.push("/contacts");
          setPendingSaveAddress(null);
        }}
      />

      {/* QR Scanner */}
      <QRScanner
        visible={showQRScanner}
        onScan={handleQRScan}
        onClose={handleCloseScanner}
      />

      {/* Contact Picker */}
      <ContactPicker
        visible={showContactPicker}
        onSelect={handleContactSelect}
        onClose={handleCloseContactPicker}
      />
    </View>
  );
}
