/**
 * Wallet manager screen.
 * Lists all wallets, allows switching, creating, importing, and deleting wallets.
 * Presented as a modal from the settings screen.
 */

import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "../src/ui/safe-area-view";
import { useRouter, useFocusEffect } from "expo-router";
import { useWalletStore } from "../src/wallet/wallet-store";
import type { WalletInfo } from "../src/storage/secure-store";
import {
  ListItem,
  Button,
  Badge,
  EmptyState,
  ScreenHeader,
} from "../src/ui/components";
import { useTheme } from "@oxyhq/bloom/theme";
import { Dialog, useDialogControl } from "@oxyhq/bloom/dialog";
import type { DialogControlProps } from "@oxyhq/bloom/dialog";
import { t } from "../src/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Uppercase field label — matches the home / send screens' section headers. */
const SECTION_LABEL =
  "text-muted-foreground text-xs font-semibold uppercase tracking-wider";

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Import wallet modal
// ---------------------------------------------------------------------------

interface ImportModalProps {
  visible: boolean;
  onCancel: () => void;
  onImport: (name: string, mnemonic: string) => void;
}

function ImportModal({ visible, onCancel, onImport }: ImportModalProps) {
  const theme = useTheme();
  const [name, setName] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCancel = useCallback(() => {
    setName("");
    setMnemonic("");
    setError(null);
    onCancel();
  }, [onCancel]);

  const handleImport = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedMnemonic = mnemonic.trim();

    if (!trimmedName) {
      setError(t("wallets.import.error.nameRequired"));
      return;
    }

    if (!trimmedMnemonic) {
      setError(t("wallets.import.error.phraseRequired"));
      return;
    }

    const words = trimmedMnemonic.split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      setError(t("wallets.import.error.wordCount"));
      return;
    }

    setError(null);
    setName("");
    setMnemonic("");
    onImport(trimmedName, trimmedMnemonic);
  }, [name, mnemonic, onImport]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View className="flex-1 bg-black/70 items-center justify-center px-8">
        <View className="bg-background border border-border rounded-2xl p-6 w-full max-w-sm">
          <Text className="text-foreground text-lg font-bold mb-5 text-center">
            {t("wallets.import.title")}
          </Text>

          <View className="gap-4">
            <View>
              <Text className={SECTION_LABEL}>
                {t("wallets.import.nameLabel")}
              </Text>
              <TextInput
                className="bg-surface rounded-2xl px-4 py-3.5 text-foreground text-base mt-2"
                placeholder={t("wallets.import.namePlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>

            <View>
              <Text className={SECTION_LABEL}>
                {t("wallets.import.phraseLabel")}
              </Text>
              <TextInput
                className="bg-surface rounded-2xl px-4 py-3.5 text-foreground text-base mt-2 min-h-[88px]"
                placeholder={t("wallets.import.phrasePlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                value={mnemonic}
                onChangeText={setMnemonic}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
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
                title={t("wallets.import.cta")}
                onPress={handleImport}
                variant="primary"
              />
              <Button
                title={t("common.cancel")}
                onPress={handleCancel}
                variant="secondary"
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Watch-only wallet modal
// ---------------------------------------------------------------------------

interface WatchOnlyModalProps {
  visible: boolean;
  onCancel: () => void;
  onImport: (name: string, xpub: string) => void;
}

function WatchOnlyModal({ visible, onCancel, onImport }: WatchOnlyModalProps) {
  const theme = useTheme();
  const [name, setName] = useState("");
  const [xpub, setXpub] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCancel = useCallback(() => {
    setName("");
    setXpub("");
    setError(null);
    onCancel();
  }, [onCancel]);

  const handleImport = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedXpub = xpub.trim();

    if (!trimmedName) {
      setError(t("wallets.watchOnly.error.nameRequired"));
      return;
    }

    if (!trimmedXpub) {
      setError(t("wallets.watchOnly.error.xpubRequired"));
      return;
    }

    // A FairCoin account-level extended public key does NOT use the Bitcoin
    // "xpub"/"tpub" prefix (its version bytes differ), so we only do a coarse
    // length sanity check here. The store validates the key authoritatively via
    // KeyManager.fromXpub and surfaces a precise error if it is malformed.
    if (trimmedXpub.length < 100) {
      setError(t("wallets.watchOnly.error.xpubFormat"));
      return;
    }

    setError(null);
    setName("");
    setXpub("");
    onImport(trimmedName, trimmedXpub);
  }, [name, xpub, onImport]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View className="flex-1 bg-black/70 items-center justify-center px-8">
        <View className="bg-background border border-border rounded-2xl p-6 w-full max-w-sm">
          <Text className="text-foreground text-lg font-bold mb-5 text-center">
            {t("wallets.watchOnly.title")}
          </Text>

          <View className="gap-4">
            <View>
              <Text className={SECTION_LABEL}>
                {t("wallets.watchOnly.nameLabel")}
              </Text>
              <TextInput
                className="bg-surface rounded-2xl px-4 py-3.5 text-foreground text-base mt-2"
                placeholder={t("wallets.watchOnly.namePlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>

            <View>
              <Text className={SECTION_LABEL}>
                {t("wallets.watchOnly.xpubLabel")}
              </Text>
              <TextInput
                className="bg-surface rounded-2xl px-4 py-3.5 text-foreground text-base mt-2 min-h-[88px]"
                placeholder={t("wallets.watchOnly.xpubPlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                value={xpub}
                onChangeText={setXpub}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
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
                title={t("wallets.watchOnly.cta")}
                onPress={handleImport}
                variant="primary"
              />
              <Button
                title={t("common.cancel")}
                onPress={handleCancel}
                variant="secondary"
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create wallet modal
// ---------------------------------------------------------------------------

interface CreateModalProps {
  visible: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
}

function CreateModal({ visible, onCancel, onCreate }: CreateModalProps) {
  const theme = useTheme();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCancel = useCallback(() => {
    setName("");
    setError(null);
    onCancel();
  }, [onCancel]);

  const handleCreate = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("wallets.create.error.nameRequired"));
      return;
    }

    setError(null);
    setName("");
    onCreate(trimmedName);
  }, [name, onCreate]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View className="flex-1 bg-black/70 items-center justify-center px-8">
        <View className="bg-background border border-border rounded-2xl p-6 w-full max-w-sm">
          <Text className="text-foreground text-lg font-bold mb-5 text-center">
            {t("wallets.create.title")}
          </Text>

          <View className="gap-4">
            <View>
              <Text className={SECTION_LABEL}>
                {t("wallets.create.nameLabel")}
              </Text>
              <TextInput
                className="bg-surface rounded-2xl px-4 py-3.5 text-foreground text-base mt-2"
                placeholder={t("wallets.create.namePlaceholder")}
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
                title={t("wallets.create.cta")}
                onPress={handleCreate}
                variant="primary"
              />
              <Button
                title={t("common.cancel")}
                onPress={handleCancel}
                variant="secondary"
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Mnemonic display modal (shown after creating a new wallet)
// ---------------------------------------------------------------------------

interface MnemonicModalProps {
  control: DialogControlProps;
  mnemonic: string;
  onDismiss: () => void;
}

function MnemonicModal({ control, mnemonic, onDismiss }: MnemonicModalProps) {
  const words = useMemo(() => mnemonic.split(" "), [mnemonic]);

  return (
    <Dialog
      control={control}
      onClose={onDismiss}
      placement="bottom"
      title={t("wallets.mnemonic.title")}
      description={t("wallets.mnemonic.description")}
      actions={[{ label: t("wallets.mnemonic.cta"), onPress: onDismiss }]}
    >
      <View className="flex-row flex-wrap justify-center gap-2 mt-2">
        {words.map((word, idx) => (
          <View
            key={`word-${idx}`}
            className="bg-background rounded-lg px-3 py-1.5"
          >
            <Text className="text-foreground text-sm">
              <Text className="text-muted-foreground">{idx + 1}. </Text>
              {word}
            </Text>
          </View>
        ))}
      </View>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function WalletsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const wallets = useWalletStore((s) => s.wallets);
  const activeWalletId = useWalletStore((s) => s.activeWalletId);
  const loading = useWalletStore((s) => s.loading);
  const loadWalletList = useWalletStore((s) => s.loadWalletList);
  const switchWallet = useWalletStore((s) => s.switchWallet);
  const createNewWallet = useWalletStore((s) => s.createNewWallet);
  const importWallet = useWalletStore((s) => s.importWallet);
  const importWatchOnly = useWalletStore((s) => s.importWatchOnly);
  const deleteWallet = useWalletStore((s) => s.deleteWallet);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showWatchOnlyModal, setShowWatchOnlyModal] = useState(false);
  const [newMnemonic, setNewMnemonic] = useState("");
  const [switching, setSwitching] = useState(false);
  const [pendingDeleteWallet, setPendingDeleteWallet] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [message, setMessage] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const mnemonicControl = useDialogControl();
  const deleteWalletControl = useDialogControl();
  const cannotDeleteControl = useDialogControl();
  const messageControl = useDialogControl();

  const showMessage = useCallback(
    (title: string, description: string) => {
      setMessage({ title, description });
      messageControl.open();
    },
    [messageControl],
  );

  // Load wallet list on focus
  useFocusEffect(
    useCallback(() => {
      loadWalletList();
    }, [loadWalletList]),
  );

  const handleSwitch = useCallback(
    async (walletId: string) => {
      setSwitching(true);
      await switchWallet(walletId);
      setSwitching(false);
      router.back();
    },
    [switchWallet, router],
  );

  const handleDelete = useCallback(
    (walletId: string, walletName: string) => {
      if (wallets.length <= 1) {
        cannotDeleteControl.open();
        return;
      }
      setPendingDeleteWallet({ id: walletId, name: walletName });
      deleteWalletControl.open();
    },
    [wallets.length, deleteWalletControl, cannotDeleteControl],
  );

  const handleCreateWallet = useCallback(
    async (name: string) => {
      setShowCreateModal(false);
      try {
        const mnemonic = await createNewWallet(name);
        setNewMnemonic(mnemonic);
        mnemonicControl.open();
      } catch {
        showMessage(t("common.error"), t("wallets.create.error.failed"));
      }
    },
    [createNewWallet, mnemonicControl, showMessage],
  );

  const handleImportWallet = useCallback(
    async (name: string, mnemonic: string) => {
      setShowImportModal(false);
      try {
        await importWallet(name, mnemonic);
        router.back();
      } catch {
        showMessage(
          t("wallets.import.failed.title"),
          t("wallets.import.failed.description"),
        );
      }
    },
    [importWallet, router, showMessage],
  );

  const handleMnemonicDismiss = useCallback(() => {
    mnemonicControl.close();
    setNewMnemonic("");
  }, [mnemonicControl]);

  const handleOpenCreate = useCallback(() => {
    setShowCreateModal(true);
  }, []);

  const handleCloseCreate = useCallback(() => {
    setShowCreateModal(false);
  }, []);

  const handleOpenImport = useCallback(() => {
    setShowImportModal(true);
  }, []);

  const handleCloseImport = useCallback(() => {
    setShowImportModal(false);
  }, []);

  const handleOpenWatchOnly = useCallback(() => {
    setShowWatchOnlyModal(true);
  }, []);

  const handleCloseWatchOnly = useCallback(() => {
    setShowWatchOnlyModal(false);
  }, []);

  const handleImportWatchOnly = useCallback(
    async (name: string, xpub: string) => {
      setShowWatchOnlyModal(false);
      try {
        await importWatchOnly(name, xpub);
        showMessage(
          t("wallets.watchOnly.imported.title"),
          t("wallets.watchOnly.imported.description"),
        );
      } catch (err: unknown) {
        // Surface the store's precise reason (e.g. invalid extended public key)
        // rather than a generic message, so the user can correct the input.
        const detail =
          err instanceof Error ? err.message : null;
        showMessage(
          t("wallets.watchOnly.failed.title"),
          detail ?? t("wallets.watchOnly.failed.description"),
        );
      }
    },
    [importWatchOnly, showMessage],
  );

  if (switching || loading) {
    return (
      <SafeAreaView
        className="flex-1 bg-background items-center justify-center"
        edges={["top", "bottom", "left", "right"]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text className="text-muted-foreground text-sm mt-4">
          {switching ? t("wallets.switching") : t("wallets.loading")}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "bottom", "left", "right"]}
    >
      <ScreenHeader
        title={t("wallets.title")}
        subtitle={
          wallets.length === 1
            ? t("wallets.subtitle.one", { count: wallets.length })
            : t("wallets.subtitle.other", { count: wallets.length })
        }
        onBack={() => router.back()}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-4 pb-8"
      >
        {/* Wallet list — card-less surface group with a subtle border and
            inter-row hairlines (matches the home / wallet-switcher pattern). */}
        {wallets.length === 0 ? (
          <View className="mb-6">
            <EmptyState
              icon="wallet"
              title={t("wallets.empty.title")}
              subtitle={t("wallets.empty.subtitle")}
            />
          </View>
        ) : (
          <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-6">
            {wallets.map((wallet, idx) => {
              const isActive = wallet.id === activeWalletId;
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
                  isLast={idx === wallets.length - 1}
                  onPress={() => {
                    if (!isActive) handleSwitch(wallet.id);
                  }}
                  trailing={
                    isActive ? (
                      <Badge text={t("wallets.active")} variant="success" />
                    ) : undefined
                  }
                />
              );
            })}
          </View>
        )}

        {/* Action buttons */}
        <View className="gap-3">
          <Button
            title={t("wallets.createCta")}
            onPress={handleOpenCreate}
            variant="primary"
          />
          <Button
            title={t("wallets.importCta")}
            onPress={handleOpenImport}
            variant="outline"
          />
          <Button
            title={t("wallets.watchOnlyCta")}
            onPress={handleOpenWatchOnly}
            variant="outline"
          />
        </View>
      </ScrollView>

      {/* Modals */}
      <CreateModal
        visible={showCreateModal}
        onCancel={handleCloseCreate}
        onCreate={handleCreateWallet}
      />
      <ImportModal
        visible={showImportModal}
        onCancel={handleCloseImport}
        onImport={handleImportWallet}
      />
      <WatchOnlyModal
        visible={showWatchOnlyModal}
        onCancel={handleCloseWatchOnly}
        onImport={handleImportWatchOnly}
      />
      <MnemonicModal
        control={mnemonicControl}
        mnemonic={newMnemonic}
        onDismiss={handleMnemonicDismiss}
      />

      <Dialog
        control={deleteWalletControl}
        placement="bottom"
        title={t("wallets.delete.title")}
        description={
          pendingDeleteWallet
            ? t("wallets.delete.description", {
                name: pendingDeleteWallet.name,
              })
            : ""
        }
        actions={[
          {
            label: t("common.delete"),
            color: "destructive",
            onPress: async () => {
              if (pendingDeleteWallet) {
                await deleteWallet(pendingDeleteWallet.id);
                setPendingDeleteWallet(null);
              }
            },
          },
          { label: t("common.cancel"), color: "cancel" },
        ]}
      />

      <Dialog
        control={cannotDeleteControl}
        placement="bottom"
        title={t("wallets.cannotDelete.title")}
        description={t("wallets.cannotDelete.description")}
        actions={[{ label: t("common.ok") }]}
      />

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
