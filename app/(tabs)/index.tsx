/**
 * Home screen — balance, quick actions, and activity feed.
 *
 * Layout: Revolut-style parallax hero image header.
 *  - Hero image is rendered absolutely behind the scroll content and translates
 *    up at half the scroll rate. When the user pulls down past the top, the
 *    image scales up for an "overscroll zoom" effect.
 *  - Top bar (wallet name + sync status) is a fixed sibling overlaid on the
 *    image with white text + shadow for readability.
 *  - A linear gradient fades the bottom of the image into the background so the
 *    balance and activity sit on a smooth transition.
 */

import { useCallback, useMemo, useState } from "react";
import { View, Text, RefreshControl, Pressable, Image, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import * as Localization from "expo-localization";
import { useWalletStore } from "../../src/wallet/wallet-store";
import {
  BalanceDisplay,
  ActionButton,
  EmptyState,
  Badge,
} from "../../src/ui/components";
import { TransactionItem } from "../../src/ui/components/TransactionItem";
import { Divider } from "@oxyhq/bloom/divider";
import {
  startPricePolling,
  stopPricePolling,
  getCachedPrice,
  type PriceData,
} from "../../src/services/price";
import { useTheme } from "@oxyhq/bloom/theme";
import { BUY_BASE_URL } from "@fairco.in/core";
import { t } from "../../src/i18n";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HERO_HEIGHT = 380;
/**
 * Pixels of overlap between the hero image bottom and the scroll content top.
 * Sized so the image extends down behind the balance and fades out right above
 * the quick-actions row (rather than cutting off above the amount).
 */
const HERO_OVERLAP = 150;
/** Maximum scale applied when overscrolling (pulling the list down). */
const OVERSCROLL_MAX_SCALE = 1.4;
/** Pull distance (px) at which the overscroll zoom reaches its maximum. */
const OVERSCROLL_ZOOM_DISTANCE = 200;

const TOP_BAR_TEXT_SHADOW = {
  textShadowColor: "rgba(0,0,0,0.5)",
  textShadowRadius: 4,
} as const;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme();

  const balance = useWalletStore((s) => s.balance);
  const isSyncing = useWalletStore((s) => s.isSyncing);
  const syncProgress = useWalletStore((s) => s.syncProgress);
  const connectedPeers = useWalletStore((s) => s.connectedPeers);
  const chainHeight = useWalletStore((s) => s.chainHeight);
  const transactions = useWalletStore((s) => s.transactions);
  const network = useWalletStore((s) => s.network);
  const activeWalletName = useWalletStore((s) => s.activeWalletName);
  const receiveAddress = useWalletStore((s) => s.currentReceiveAddress);
  const refreshBalance = useWalletStore((s) => s.refreshBalance);
  const loading = useWalletStore((s) => s.loading);

  const handleBuy = useCallback(async () => {
    const locale = Localization.getLocales()[0];
    const language = locale?.languageCode ?? "en";
    const country = locale?.regionCode ?? "";
    const params = new URLSearchParams({
      in_app: "true",
      address: receiveAddress ?? "",
      language,
      country,
    });
    await WebBrowser.openBrowserAsync(`${BUY_BASE_URL}/?${params.toString()}`);
  }, [receiveAddress]);

  const [price, setPrice] = useState<PriceData | null>(getCachedPrice);

  useFocusEffect(
    useCallback(() => {
      startPricePolling((updated) => setPrice(updated));
      return () => stopPricePolling();
    }, []),
  );

  const handleRefresh = useCallback(() => {
    refreshBalance();
  }, [refreshBalance]);

  const recentTransactions = transactions.slice(0, 10);

  const syncState = useMemo(() => {
    if (connectedPeers === 0) {
      return { dot: "bg-red-400", label: t("wallet.sync.offline") };
    }
    if (isSyncing) {
      return {
        dot: "bg-yellow-400",
        label: t("wallet.sync.syncing", { progress: Math.round(syncProgress) }),
      };
    }
    return { dot: "bg-primary", label: t("wallet.sync.synced") };
  }, [connectedPeers, isSyncing, syncProgress]);

  // ---- Parallax: track scroll, derive translate + scale on the UI thread ----
  const scrollY = useSharedValue(0);

  const handleScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const heroAnimatedStyle = useAnimatedStyle(() => {
    // Translate the image up at half the scroll rate. When the user pulls
    // down past the top (negative scrollY), this same formula moves the
    // image down to fill the exposed area.
    const translateY = scrollY.value * -0.5;
    // Scale up only on overscroll (negative scrollY), clamped at 1 for any
    // positive scroll so the image never grows mid-scroll.
    const scale = interpolate(
      scrollY.value,
      [-OVERSCROLL_ZOOM_DISTANCE, 0],
      [OVERSCROLL_MAX_SCALE, 1],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ translateY }, { scale }],
    };
  });

  // expo-linear-gradient requires an inline tuple for the colors prop.
  const gradientColors: readonly [string, string] = ["transparent", theme.colors.background];

  return (
    <View className="flex-1 bg-background">
      {/* ---- Hero image (absolute, behind the scroll content) ---- */}
      <Animated.View
        pointerEvents="none"
        style={[styles.hero, heroAnimatedStyle]}
      >
        <Image
          source={require("../../assets/home-hero.jpg")}
          style={styles.heroImage}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          accessibilityRole="image"
        />
        <LinearGradient
          colors={gradientColors}
          locations={[0.4, 0.9]}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

      {/* ---- Scroll content ---- */}
      <Animated.ScrollView
        className="flex-1"
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: HERO_HEIGHT - HERO_OVERLAP,
          paddingBottom: 24,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* ---- Balance (sits in the gradient fade zone) ---- */}
        <View className="items-center pt-8 pb-6 px-6">
          <BalanceDisplay
            value={balance}
            priceUsd={price?.usd}
            change24h={price?.change24h}
            size="lg"
          />
        </View>

        {/* ---- Opaque content area (covers the hero behind it) ---- */}
        <View style={{ backgroundColor: theme.colors.background }}>
          {/* ---- Quick actions ---- */}
          <View className="flex-row justify-evenly px-4 pb-6">
            <ActionButton
              icon="arrow-up-bold"
              label={t("wallet.send")}
              onPress={() => router.push("/(tabs)/send")}
            />
            <ActionButton
              icon="arrow-down-bold"
              label={t("wallet.receive")}
              onPress={() => router.push("/(tabs)/receive")}
            />
            <ActionButton
              icon="credit-card-plus"
              label={t("wallet.buy")}
              onPress={handleBuy}
            />
            <ActionButton
              icon="map-marker"
              label={t("wallet.places")}
              onPress={() => router.push("/map")}
            />
            <ActionButton
              icon="account-group"
              label={t("wallet.contacts")}
              onPress={() => router.push("/contacts")}
            />
            <ActionButton
              icon="server-network"
              label={t("wallet.nodes")}
              onPress={() => router.push("/masternode")}
            />
          </View>

          {/* ---- Sync progress (only visible while syncing) ---- */}
          {isSyncing ? (
            <View className="mx-5 mb-4">
              <View className="h-0.5 bg-border rounded-full overflow-hidden">
                <View
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, syncProgress))}%` }}
                />
              </View>
              <View className="flex-row justify-between mt-1">
                <Text className="text-muted-foreground text-[10px]">
                  {connectedPeers}{" "}
                  {connectedPeers === 1
                    ? t("wallet.peer.one")
                    : t("wallet.peer.other")}
                </Text>
                {chainHeight > 0 ? (
                  <Text className="text-muted-foreground text-[10px]">
                    {t("wallet.block", { height: chainHeight.toLocaleString() })}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* ---- Activity ---- */}
          <View className="px-5">
            <Divider style={{ marginBottom: 20 }} />

            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-foreground text-lg font-semibold">
                {t("wallet.activity")}
              </Text>
              {transactions.length > 0 ? (
                <Text className="text-muted-foreground text-xs">
                  {transactions.length === 1
                    ? t("wallet.transactionCount.one", {
                        count: transactions.length,
                      })
                    : t("wallet.transactionCount.other", {
                        count: transactions.length,
                      })}
                </Text>
              ) : null}
            </View>

            {recentTransactions.length === 0 ? (
              <EmptyState
                icon="swap-vertical"
                title={t("wallet.activity.empty.title")}
                subtitle={t("wallet.activity.empty.subtitle")}
              />
            ) : (
              <View className="bg-surface rounded-2xl overflow-hidden">
                {recentTransactions.map((tx, idx) => (
                  <View key={tx.txid}>
                    <TransactionItem
                      txid={tx.txid}
                      type={tx.type}
                      value={tx.amount}
                      address={tx.address}
                      timestamp={tx.timestamp}
                      confirmations={tx.confirmations}
                    />
                    {idx < recentTransactions.length - 1 ? (
                      <View className="h-px bg-border ml-16" />
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </Animated.ScrollView>

      {/* ---- Top bar (fixed, overlaid on the hero) ---- */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top,
          zIndex: 2,
        }}
        className="px-5 pt-3 pb-3 flex-row items-center justify-between"
      >
        {/* Wallet name (tappable → wallet switcher) */}
        <Pressable
          className="flex-row items-center active:opacity-60"
          onPress={() => router.push("/wallets")}
          accessibilityRole="button"
          accessibilityLabel={t("wallet.switchAccessibility")}
        >
          <Text
            className="text-white text-base font-semibold"
            style={TOP_BAR_TEXT_SHADOW}
          >
            {activeWalletName || t("wallet.defaultName")}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color="#ffffff" />
        </Pressable>

        {/* Right: network badge + sync status (tappable → peers) */}
        <View className="flex-row items-center gap-2">
          {network === "testnet" ? (
            <Badge text={t("wallet.badge.testnet")} variant="warning" size="sm" />
          ) : null}
          <Pressable
            className="flex-row items-center active:opacity-60"
            onPress={() => router.push("/peers")}
            accessibilityRole="button"
            accessibilityLabel={t("wallet.syncAccessibility", {
              label: syncState.label,
            })}
          >
            <View className={`w-1.5 h-1.5 rounded-full ${syncState.dot} mr-1`} />
            <Text className="text-white text-[11px]" style={TOP_BAR_TEXT_SHADOW}>
              {syncState.label}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Static styles (only for values that can't be expressed as NativeWind classes)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  hero: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HERO_HEIGHT,
    zIndex: 0,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
});
