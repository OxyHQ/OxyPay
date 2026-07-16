/**
 * Receive screen.
 * Revolut-inspired layout: big centered QR in a framed card, copyable
 * address, quick actions, and a fixed share button at the bottom.
 */

import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import QRCode from "react-native-qrcode-svg";
import { Dialog, useDialogControl } from "@oxyhq/bloom/dialog";
import { useWalletStore } from "../../src/wallet/wallet-store";
import { Card, Button, ListItem } from "../../src/ui/components";
import { t } from "../../src/i18n";
import { useTheme } from "@oxyhq/bloom/theme";
import { FONT_PHUDU_BLACK } from "../../src/utils/fonts";

const CONTENT_MAX_WIDTH = 500;
const QR_SIZE = 220;

function truncateAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

export default function ReceiveScreen() {
  const insets = useSafeAreaInsets();
  const receiveAddress = useWalletStore((s) => s.currentReceiveAddress);
  const addresses = useWalletStore((s) => s.addresses);
  const getNewAddress = useWalletStore((s) => s.getNewAddress);
  const theme = useTheme();

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [showAllAddresses, setShowAllAddresses] = useState(false);
  const displayAddress = selectedAddress ?? receiveAddress;

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

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(displayAddress);
    showMessage(
      t("receive.addressCopied.title"),
      t("receive.addressCopied.description"),
    );
  }, [displayAddress, showMessage]);

  const handleNewAddress = useCallback(() => {
    const addr = getNewAddress();
    setSelectedAddress(addr);
  }, [getNewAddress]);

  const handleShare = useCallback(async () => {
    const uri = `faircoin:${displayAddress}`;
    const payload = t("receive.shareMessage", { uri });

    // On platforms without a native share sheet (web, electron) fall back to
    // copying the payment request to the clipboard.
    if (!(await Sharing.isAvailableAsync())) {
      await Clipboard.setStringAsync(payload);
      showMessage(
        t("receive.addressCopied.title"),
        t("receive.addressCopied.description"),
      );
      return;
    }

    // expo-sharing requires a file URI, so write the payment request to a
    // temporary text file in the cache directory and share that.
    const file = new File(Paths.cache, "fairwallet-payment-request.txt");
    if (file.exists) file.delete();
    file.create();
    file.write(payload);
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/plain",
      dialogTitle: t("receive.paymentRequestTitle"),
      UTI: "public.plain-text",
    });
  }, [displayAddress, showMessage]);

  const handleSelectAddress = useCallback((address: string) => {
    setSelectedAddress(address);
    setShowAllAddresses(false);
  }, []);

  const handleCopyAddress = useCallback(
    async (address: string) => {
      await Clipboard.setStringAsync(address);
      showMessage(
        t("receive.addressCopied.title"),
        t("receive.addressCopied.description"),
      );
    },
    [showMessage],
  );

  const handleToggleAllAddresses = useCallback(() => {
    setShowAllAddresses((prev) => !prev);
  }, []);

  const addressListItems = useMemo(
    () =>
      addresses.map((address, idx) => ({
        address,
        index: idx,
        isActive: address === displayAddress,
        isLast: idx === addresses.length - 1,
        label: truncateAddress(address),
      })),
    [addresses, displayAddress],
  );

  if (!receiveAddress) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-1 items-center justify-center px-6">
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text className="text-muted-foreground text-sm mt-4">
            {t("receive.generating")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-40 gap-5"
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
        }}
      >
        <View
          className="w-full self-center gap-5"
          style={{ maxWidth: CONTENT_MAX_WIDTH }}
        >
          {/* Title */}
          <View className="items-center pt-2">
            <Text
              className="text-foreground"
              style={{ fontFamily: FONT_PHUDU_BLACK, fontSize: 28 }}
            >
              {t("receive.title")}
            </Text>
            <Text className="text-muted-foreground text-sm mt-1 text-center">
              {t("receive.subtitle")}
            </Text>
          </View>

          {/* Big centered QR */}
          <Card className="p-6 items-center border border-border/60">
            <View
              className="bg-background rounded-2xl p-4 items-center justify-center"
              style={{
                width: QR_SIZE + 32,
                height: QR_SIZE + 32,
              }}
            >
              <QRCode
                value={`faircoin:${displayAddress}`}
                size={QR_SIZE}
                color={theme.colors.primary}
                backgroundColor="transparent"
              />
            </View>
          </Card>

          {/* Address display with copy */}
          <Card className="p-4">
            <Text className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider mb-2">
              {t("receive.yourAddress")}
            </Text>
            <View className="flex-row items-center">
              <Pressable
                onPress={handleCopy}
                className="flex-1 active:opacity-70"
              >
                <Text
                  className="text-foreground text-sm font-mono"
                  selectable
                >
                  {displayAddress}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleCopy}
                className="ml-3 w-9 h-9 rounded-full bg-primary/10 items-center justify-center active:opacity-70"
                accessibilityLabel={t("receive.copy")}
              >
                <MaterialCommunityIcons
                  name="content-copy"
                  size={16}
                  color={theme.colors.primary}
                />
              </Pressable>
            </View>
          </Card>

          {/* Quick actions */}
          <View className="flex-row gap-2">
            <Pressable
              onPress={handleNewAddress}
              className="flex-1 flex-row items-center justify-center bg-surface rounded-full py-3 active:opacity-70"
            >
              <MaterialCommunityIcons
                name="plus-circle-outline"
                size={16}
                color={theme.colors.primary}
              />
              <Text className="text-foreground text-sm font-semibold ml-2">
                {t("receive.new_address")}
              </Text>
            </Pressable>
            {addresses.length > 1 ? (
              <Pressable
                onPress={handleToggleAllAddresses}
                className="flex-1 flex-row items-center justify-center bg-surface rounded-full py-3 active:opacity-70"
              >
                <MaterialCommunityIcons
                  name={showAllAddresses ? "chevron-up" : "format-list-bulleted"}
                  size={16}
                  color={theme.colors.primary}
                />
                <Text className="text-foreground text-sm font-semibold ml-2">
                  {showAllAddresses
                    ? t("receive.hideList")
                    : t("receive.allAddresses", { count: addresses.length })}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* All addresses (collapsible) */}
          {showAllAddresses && addresses.length > 0 ? (
            <Card>
              {addressListItems.map((item) => (
                <ListItem
                  key={`${item.index}-${item.address}`}
                  title={item.label}
                  subtitle={`#${item.index + 1}`}
                  icon={item.isActive ? "radiobox-marked" : "radiobox-blank"}
                  iconColor={
                    item.isActive
                      ? theme.colors.primary
                      : theme.colors.textSecondary
                  }
                  iconBg={item.isActive ? "bg-primary/10" : "bg-background"}
                  onPress={() => handleSelectAddress(item.address)}
                  trailing={
                    <Pressable
                      className="p-1.5"
                      onPress={() => handleCopyAddress(item.address)}
                    >
                      <MaterialCommunityIcons
                        name="content-copy"
                        size={16}
                        color={theme.colors.primary}
                      />
                    </Pressable>
                  }
                  showChevron={false}
                  isLast={item.isLast}
                />
              ))}
            </Card>
          ) : null}
        </View>
      </ScrollView>

      {/* Fixed bottom share button */}
      <View
        className="absolute left-0 right-0 bottom-0 bg-background border-t border-border"
        style={{ paddingBottom: insets.bottom + 12, paddingTop: 12 }}
      >
        <View
          className="w-full self-center px-4"
          style={{ maxWidth: CONTENT_MAX_WIDTH }}
        >
          <Button
            title={t("receive.share")}
            onPress={handleShare}
            variant="primary"
            size="lg"
          />
        </View>
      </View>

      <Dialog
        control={messageControl}
        placement="bottom"
        title={message?.title ?? ""}
        description={message?.description ?? ""}
        actions={[{ label: t("common.ok"), onPress: () => setMessage(null) }]}
      />
    </View>
  );
}
