/**
 * Pockets management screen.
 * Lists the wallet's Pockets, creates/renames/deletes them, and opens the
 * move sheet. Presented as a modal from the switcher's "Manage pockets" row.
 * Modeled on app/wallets.tsx.
 */

import { useCallback, useState } from "react";
import { View, Text, ScrollView, Modal, TextInput, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "../src/ui/safe-area-view";
import { useRouter, useFocusEffect } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useWalletStore } from "../src/wallet/wallet-store";
import { MAIN_POCKET_ACCOUNT, canDeletePocket } from "../src/wallet/pockets";
import {
  ListItem,
  Button,
  Badge,
  EmptyState,
  ScreenHeader,
  AmountText,
} from "../src/ui/components";
import { MovePocketSheet } from "../src/ui/sheets/MovePocketSheet";
import { useTheme } from "@oxyhq/bloom/theme";
import { Dialog, useDialogControl } from "@oxyhq/bloom/dialog";
import { t } from "../src/i18n";

/** Uppercase field label — matches the home / send screens' section headers. */
const SECTION_LABEL =
  "text-muted-foreground text-xs font-semibold uppercase tracking-wider";

export default function PocketsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const pockets = useWalletStore((s) => s.pockets);
  const activeAccount = useWalletStore((s) => s.activeAccount);
  const pocketBalances = useWalletStore((s) => s.pocketBalances);
  const isWatchOnly = useWalletStore((s) => s.isWatchOnly);
  const loading = useWalletStore((s) => s.loading);
  const loadPockets = useWalletStore((s) => s.loadPockets);
  const switchPocket = useWalletStore((s) => s.switchPocket);
  const createPocket = useWalletStore((s) => s.createPocket);
  const renamePocket = useWalletStore((s) => s.renamePocket);
  const deletePocket = useWalletStore((s) => s.deletePocket);

  const [showCreate, setShowCreate] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    account: number;
    name: string;
  } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionsTarget, setActionsTarget] = useState<{
    account: number;
    name: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    account: number;
    name: string;
  } | null>(null);
  const [message, setMessage] = useState<string>("");

  const moveControl = useDialogControl();
  const actionsControl = useDialogControl();
  const deleteControl = useDialogControl();
  const messageControl = useDialogControl();

  const openMessage = useCallback(
    (text: string) => {
      setMessage(text);
      messageControl.open();
    },
    [messageControl],
  );

  useFocusEffect(
    useCallback(() => {
      loadPockets();
    }, [loadPockets]),
  );

  const submitCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("pockets.create.error.nameRequired"));
      return;
    }
    setShowCreate(false);
    setName("");
    setError(null);
    try {
      await createPocket(trimmed);
    } catch {
      openMessage(t("pockets.create.error.failed"));
    }
  }, [name, createPocket, openMessage]);

  const submitRename = useCallback(async () => {
    if (!renameTarget) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("pockets.create.error.nameRequired"));
      return;
    }
    const target = renameTarget;
    setRenameTarget(null);
    setName("");
    setError(null);
    await renamePocket(target.account, trimmed);
  }, [renameTarget, name, renamePocket]);

  const openActions = useCallback(
    (account: number, pocketName: string) => {
      setActionsTarget({ account, name: pocketName });
      actionsControl.open();
    },
    [actionsControl],
  );

  const openRename = useCallback((account: number, currentName: string) => {
    setRenameTarget({ account, name: currentName });
    setName(currentName);
    setError(null);
  }, []);

  const requestDelete = useCallback(
    (account: number, pocketName: string) => {
      if (!canDeletePocket(pockets, account)) {
        openMessage(t("pockets.delete.cannotMain"));
        return;
      }
      setPendingDelete({ account, name: pocketName });
      deleteControl.open();
    },
    [pockets, deleteControl, openMessage],
  );

  if (isWatchOnly) {
    return (
      <SafeAreaView
        className="flex-1 bg-background"
        edges={["top", "bottom", "left", "right"]}
      >
        <ScreenHeader title={t("pockets.title")} onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            icon="lock"
            title={t("pockets.watchOnly.title")}
            subtitle={t("pockets.watchOnly.subtitle")}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView
        className="flex-1 bg-background items-center justify-center"
        edges={["top", "bottom", "left", "right"]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "bottom", "left", "right"]}
    >
      <ScreenHeader
        title={t("pockets.title")}
        subtitle={
          pockets.length === 1
            ? t("pockets.subtitle.one", { count: pockets.length })
            : t("pockets.subtitle.other", { count: pockets.length })
        }
        onBack={() => router.back()}
      />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 pb-8">
        <View className="mb-6">
          {pockets.map((pocket, idx) => {
            const isActive = pocket.account === activeAccount;
            const label =
              pocket.account === MAIN_POCKET_ACCOUNT
                ? t("pockets.mainName")
                : pocket.name;
            return (
              <ListItem
                key={pocket.account}
                icon="wallet-outline"
                iconBg={isActive ? "bg-green-500/15" : "bg-primary/10"}
                iconColor={isActive ? theme.colors.success : theme.colors.tint}
                title={label}
                isLast={idx === pockets.length - 1}
                onPress={() => {
                  if (!isActive) switchPocket(pocket.account);
                }}
                trailing={
                  <View className="flex-row items-center gap-2">
                    <AmountText
                      value={pocketBalances[pocket.account] ?? 0n}
                      className="text-muted-foreground text-sm"
                    />
                    {isActive ? (
                      <Badge text={t("pockets.active")} variant="success" />
                    ) : null}
                    {pocket.account !== MAIN_POCKET_ACCOUNT ? (
                      <Pressable
                        onPress={() => openActions(pocket.account, label)}
                        hitSlop={8}
                        className="p-1 active:opacity-60"
                        accessibilityRole="button"
                        accessibilityLabel={t("pockets.options")}
                      >
                        <MaterialCommunityIcons
                          name="dots-vertical"
                          size={18}
                          color={theme.colors.textSecondary}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                }
              />
            );
          })}
        </View>

        <View className="gap-3">
          <Button
            title={t("pockets.createCta")}
            onPress={() => {
              setName("");
              setError(null);
              setShowCreate(true);
            }}
            variant="primary"
          />
          <Button
            title={t("pockets.move.title")}
            onPress={() => moveControl.open()}
            variant="outline"
          />
        </View>
      </ScrollView>

      {/* Create / rename modal (shared TextInput modal) */}
      <Modal
        visible={showCreate || renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowCreate(false);
          setRenameTarget(null);
        }}
      >
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="bg-background border border-border rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-foreground text-lg font-bold mb-5 text-center">
              {renameTarget ? t("pockets.rename.title") : t("pockets.create.title")}
            </Text>
            <View className="gap-4">
              <View>
                <Text className={SECTION_LABEL}>
                  {t("pockets.create.nameLabel")}
                </Text>
                <TextInput
                  className="bg-surface rounded-2xl px-4 py-3.5 text-foreground text-base mt-2"
                  placeholder={t("pockets.create.namePlaceholder")}
                  placeholderTextColor={theme.colors.textSecondary}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
              {error ? (
                <View className="bg-destructive/10 rounded-2xl p-3">
                  <Text className="text-destructive text-sm text-center">
                    {error}
                  </Text>
                </View>
              ) : null}
              <View className="gap-3">
                <Button
                  title={renameTarget ? t("pockets.rename.cta") : t("pockets.create.cta")}
                  onPress={renameTarget ? submitRename : submitCreate}
                  variant="primary"
                />
                <Button
                  title={t("common.cancel")}
                  onPress={() => {
                    setShowCreate(false);
                    setRenameTarget(null);
                    setName("");
                    setError(null);
                  }}
                  variant="secondary"
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Dialog control={moveControl} placement="bottom" title={t("pockets.move.title")}>
        <MovePocketSheet onDone={() => moveControl.close()} />
      </Dialog>

      {/* Per-Pocket actions (rename / delete) — a "..." row opens this instead
          of an onLongPress on the row itself, since the shared `ListItem`
          wrapper doesn't expose a long-press prop. */}
      <Dialog
        control={actionsControl}
        placement="bottom"
        title={actionsTarget?.name ?? ""}
        actions={[
          {
            label: t("pockets.rename.action"),
            onPress: () => {
              if (actionsTarget) openRename(actionsTarget.account, actionsTarget.name);
            },
          },
          {
            label: t("common.delete"),
            color: "destructive",
            onPress: () => {
              if (actionsTarget) requestDelete(actionsTarget.account, actionsTarget.name);
            },
          },
          { label: t("common.cancel"), color: "cancel" },
        ]}
      />

      <Dialog
        control={deleteControl}
        placement="bottom"
        title={t("pockets.delete.title")}
        description={
          pendingDelete
            ? t("pockets.delete.description", { name: pendingDelete.name })
            : ""
        }
        actions={[
          {
            label: t("common.delete"),
            color: "destructive",
            onPress: async () => {
              if (!pendingDelete) return;
              const target = pendingDelete;
              setPendingDelete(null);
              try {
                await deletePocket(target.account);
              } catch (err: unknown) {
                openMessage(
                  err instanceof Error ? err.message : t("pockets.delete.notEmpty"),
                );
              }
            },
          },
          { label: t("common.cancel"), color: "cancel" },
        ]}
      />

      <Dialog
        control={messageControl}
        placement="bottom"
        title={t("common.error")}
        description={message}
        actions={[{ label: t("common.ok") }]}
      />
    </SafeAreaView>
  );
}
