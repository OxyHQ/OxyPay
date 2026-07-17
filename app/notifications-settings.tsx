/**
 * Payment-notification settings ("Notificaciones de pago").
 *
 * Exposes the privacy dial and per-event controls for background notifications
 * (design §4.4/§4.5): a master toggle, the notification-server URL (official
 * Explorer by default, editable so a user can point at their own node), the
 * confirmation depth, and per-event switches. All changes persist through the
 * observable prefs store, which the registration lifecycle subscribes to and
 * re-registers on.
 */

import { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView, Switch } from "react-native";
import { SafeAreaView } from "../src/ui/safe-area-view";
import { useRouter, useFocusEffect } from "expo-router";
import { useTheme } from "@oxyhq/bloom/theme";
import {
  SettingsListGroup,
  SettingsListItem,
} from "@oxyhq/bloom/settings-list";
import { ScreenHeader } from "../src/ui/components";
import { t } from "../src/i18n";
import {
  getNotificationPrefs,
  setNotificationPrefs,
  DEFAULT_NOTIFICATION_SERVER_URL,
  type NotificationEvent,
  type NotificationPrefs,
} from "../src/services/notification-settings";
import { initNotifications } from "../src/services/notifications";

const CONTENT_MAX_WIDTH_CLASS = "w-full max-w-[600px] mx-auto";

/** Selectable confirmation depths, cycled on tap (BIP44 default 1). */
const CONFIRMATION_OPTIONS = [1, 2, 3, 6];

interface EventRow {
  event: NotificationEvent;
  labelKey: string;
}

const EVENT_ROWS: EventRow[] = [
  { event: "incoming_pending", labelKey: "notificationsSettings.events.incomingPending" },
  { event: "incoming_confirmed", labelKey: "notificationsSettings.events.incomingConfirmed" },
  { event: "outgoing_confirmed", labelKey: "notificationsSettings.events.outgoingConfirmed" },
];

export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const colors = theme.colors;

  const [enabled, setEnabled] = useState(false);
  const [serverUrlDraft, setServerUrlDraft] = useState(
    DEFAULT_NOTIFICATION_SERVER_URL,
  );
  const [confirmations, setConfirmations] = useState(1);
  const [events, setEvents] = useState<NotificationEvent[]>([]);

  const applyLoaded = useCallback((prefs: NotificationPrefs) => {
    setEnabled(prefs.enabled);
    setServerUrlDraft(prefs.serverUrl);
    setConfirmations(prefs.confirmations);
    setEvents(prefs.events);
  }, []);

  // Load persisted prefs when the screen gains focus.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getNotificationPrefs()
        .then((prefs) => {
          if (!cancelled) applyLoaded(prefs);
        })
        .catch(() => {
          // Defaults from useState initializers stand if the load fails.
        });
      return () => {
        cancelled = true;
      };
    }, [applyLoaded]),
  );

  const persist = useCallback(
    async (patch: Partial<NotificationPrefs>) => {
      const next = await setNotificationPrefs(patch);
      applyLoaded(next);
    },
    [applyLoaded],
  );

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleToggleEnabled = useCallback(
    (value: boolean) => {
      if (value) {
        // Prompt for OS notification permission the first time it's enabled so
        // the device push token can be acquired for registration.
        void initNotifications();
      }
      void persist({ enabled: value });
    },
    [persist],
  );

  const handleServerUrlBlur = useCallback(() => {
    const trimmed = serverUrlDraft.trim();
    void persist({ serverUrl: trimmed.length > 0 ? trimmed : DEFAULT_NOTIFICATION_SERVER_URL });
  }, [serverUrlDraft, persist]);

  const handleResetServerUrl = useCallback(() => {
    setServerUrlDraft(DEFAULT_NOTIFICATION_SERVER_URL);
    void persist({ serverUrl: DEFAULT_NOTIFICATION_SERVER_URL });
  }, [persist]);

  const handleCycleConfirmations = useCallback(() => {
    const idx = CONFIRMATION_OPTIONS.indexOf(confirmations);
    const next = CONFIRMATION_OPTIONS[(idx + 1) % CONFIRMATION_OPTIONS.length];
    void persist({ confirmations: next });
  }, [confirmations, persist]);

  const handleToggleEvent = useCallback(
    (event: NotificationEvent, on: boolean) => {
      const set = new Set(events);
      if (on) set.add(event);
      else set.delete(event);
      const ordered = EVENT_ROWS.map((row) => row.event).filter((e) =>
        set.has(e),
      );
      void persist({ events: ordered });
    },
    [events, persist],
  );

  const isDefaultServer =
    serverUrlDraft.trim().replace(/\/+$/, "") ===
    DEFAULT_NOTIFICATION_SERVER_URL;

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "bottom", "left", "right"]}
    >
      <View className={`flex-1 ${CONTENT_MAX_WIDTH_CLASS}`}>
        <ScreenHeader
          title={t("notificationsSettings.title")}
          onBack={handleBack}
        />

        <ScrollView
          className="flex-1"
          contentContainerClassName="pt-2 pb-10 gap-2"
          keyboardShouldPersistTaps="handled"
        >
          {/* Master toggle */}
          <SettingsListGroup>
            <SettingsListItem
              title={t("notificationsSettings.enable.title")}
              description={t("notificationsSettings.enable.description")}
              showChevron={false}
              rightElement={
                <Switch
                  value={enabled}
                  onValueChange={handleToggleEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={colors.text}
                />
              }
            />
          </SettingsListGroup>

          {enabled ? (
            <>
              {/* Notification server (privacy dial) */}
              <SettingsListGroup
                title={t("notificationsSettings.server.group")}
                footer={t("notificationsSettings.server.hint")}
              >
                <View className="px-4 py-3">
                  <Text className="text-muted-foreground text-xs mb-2">
                    {t("notificationsSettings.server.label")}
                  </Text>
                  <TextInput
                    className="bg-surface text-foreground text-base rounded-xl px-4 py-3"
                    value={serverUrlDraft}
                    onChangeText={setServerUrlDraft}
                    onBlur={handleServerUrlBlur}
                    onEndEditing={handleServerUrlBlur}
                    placeholder={DEFAULT_NOTIFICATION_SERVER_URL}
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="done"
                  />
                </View>
                {isDefaultServer ? null : (
                  <SettingsListItem
                    title={t("notificationsSettings.server.reset")}
                    onPress={handleResetServerUrl}
                  />
                )}
              </SettingsListGroup>

              {/* Confirmation depth */}
              <SettingsListGroup
                title={t("notificationsSettings.confirmations.group")}
              >
                <SettingsListItem
                  title={t("notificationsSettings.confirmations.title")}
                  description={t(
                    "notificationsSettings.confirmations.description",
                  )}
                  value={t("notificationsSettings.confirmations.value", {
                    count: confirmations,
                  })}
                  onPress={handleCycleConfirmations}
                  showChevron={false}
                />
              </SettingsListGroup>

              {/* Per-event switches */}
              <SettingsListGroup
                title={t("notificationsSettings.events.group")}
              >
                {EVENT_ROWS.map((row) => (
                  <SettingsListItem
                    key={row.event}
                    title={t(row.labelKey)}
                    showChevron={false}
                    rightElement={
                      <Switch
                        value={events.includes(row.event)}
                        onValueChange={(on) => handleToggleEvent(row.event, on)}
                        trackColor={{
                          false: colors.border,
                          true: colors.primaryLight,
                        }}
                        thumbColor={colors.text}
                      />
                    }
                  />
                ))}
              </SettingsListGroup>
            </>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
