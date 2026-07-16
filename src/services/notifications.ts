/**
 * Local notification service for incoming transactions.
 *
 * Uses `expo-notifications` to schedule a local notification when a new
 * received transaction is detected. Works in the foreground (via the
 * notification handler) and triggers instantly when scheduled from the
 * background sync task.
 *
 * A single "transactions" channel is created on Android with the bundled
 * `received` sound. iOS has no channels; the notification itself opts into
 * the default system sound.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { t } from "../i18n";
import { COIN_TICKER, formatFair } from "@fairco.in/core";

const TRANSACTIONS_CHANNEL_ID = "transactions";
const SYNC_CHANNEL_ID = "sync";
/** Fixed id so each progress update REPLACES the ongoing notification, not stacks. */
const SYNC_NOTIFICATION_ID = "fairwallet-sync-progress";

/**
 * Android notification channels, each created independently in
 * {@link initNotifications} so a missing asset in one can't take out the other.
 * - `transactions`: incoming-payment alerts, DEFAULT importance, custom sound.
 * - `sync`: ongoing sync-progress, LOW importance so it sits silently in the
 *   tray (no heads-up, no sound) while the wallet is syncing.
 */
const ANDROID_CHANNELS: ReadonlyArray<
  readonly [string, Notifications.NotificationChannelInput]
> = [
  [
    TRANSACTIONS_CHANNEL_ID,
    {
      name: "Transactions",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "received",
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
    },
  ],
  [
    SYNC_CHANNEL_ID,
    {
      name: "Sync status",
      importance: Notifications.AndroidImportance.LOW,
      sound: undefined,
      enableVibrate: false,
      showBadge: false,
    },
  ],
];

let initPromise: Promise<void> | null = null;

/**
 * Idempotent notification setup. Asks for permission, configures the Android
 * channel, and installs the foreground notification handler. Safe to call
 * multiple times — subsequent calls await the same promise.
 */
export function initNotifications(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const settings = await Notifications.getPermissionsAsync();
      if (!settings.granted) {
        await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: false,
            allowSound: true,
          },
        });
      }

      if (Platform.OS === "android") {
        // Create each channel INDEPENDENTLY. `setNotificationChannelAsync`
        // rejects when a channel references an asset missing from the current
        // native build (e.g. the `received` custom sound is in app.json but a
        // dev build predating that prebuild won't have bundled it). A shared
        // try would let the transactions channel's failure abort the sync
        // channel too — dropping the ongoing sync notification onto the
        // higher-importance fallback channel. Isolate them so one missing
        // asset never takes out its siblings.
        for (const [id, config] of ANDROID_CHANNELS) {
          try {
            await Notifications.setNotificationChannelAsync(id, config);
          } catch {
            // Referenced asset (sound) not in this native build yet; skip the
            // channel — a rebuild that bundles the asset restores it. The
            // notification still posts on the OS default channel meanwhile.
          }
        }
      }

      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          // The ongoing sync-progress notification must never banner or sound —
          // it updates continuously. Everything else (received payments) does.
          const isSync = notification.request.content.data?.type === "sync";
          return {
            shouldShowBanner: !isSync,
            shouldShowList: true,
            shouldPlaySound: !isSync,
            shouldSetBadge: false,
          };
        },
      });
    } catch {
      // Notification subsystem unavailable (web/electron without the native
      // module, user revoked permission, etc). We still resolve so callers
      // don't block — the underlying schedule calls will fail silently.
    }
  })();
  return initPromise;
}

/**
 * Schedule an immediate local notification announcing a received payment.
 *
 * `amountValue` is the raw bigint amount in smallest units (m⊜). It is
 * formatted via `formatFair` for display.
 */
export async function scheduleReceivedNotification(
  amountValue: bigint,
): Promise<void> {
  await initNotifications();
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t("notifications.received.title"),
        body: t("notifications.received.body", {
          amount: formatFair(amountValue),
          ticker: COIN_TICKER,
        }),
        // Android ignores this — the sound comes from the channel selected via
        // the trigger below. iOS plays the bundled custom sound by filename
        // (must be listed in the expo-notifications `sounds` array in app.json).
        sound: Platform.OS === "ios" ? "received.mp3" : undefined,
      },
      // Android: `{ channelId }` still fires immediately, but routes through the
      // `transactions` channel so the notification uses its custom `received`
      // sound. iOS has no channels — `null` fires immediately.
      trigger:
        Platform.OS === "android"
          ? { channelId: TRANSACTIONS_CHANNEL_ID }
          : null,
    });
  } catch {
    // Scheduling failed (no permission, web fallback, etc). Sound playback
    // via `src/services/sounds.ts` still covers the foreground case.
  }
}

/**
 * Schedule an immediate local notification announcing that one of the wallet's
 * OWN outgoing payments confirmed ("Tu envío de X FAIR se confirmó", spec §3
 * event 3). Mirrors {@link scheduleReceivedNotification} but with send copy and
 * the `sent` sound; it reuses the same `transactions` channel so a missing sound
 * asset degrades identically.
 *
 * `amountValue` is the raw bigint amount (smallest units, m⊜) that left the
 * wallet, formatted via `formatFair` for display.
 */
export async function scheduleSentConfirmedNotification(
  amountValue: bigint,
): Promise<void> {
  await initNotifications();
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t("notifications.sent.confirmed.title"),
        body: t("notifications.sent.confirmed.body", {
          amount: formatFair(amountValue),
          ticker: COIN_TICKER,
        }),
        // iOS plays the bundled custom sound by filename (must be listed in the
        // expo-notifications `sounds` array in app.json). Android ignores this —
        // the sound comes from the `transactions` channel selected below.
        sound: Platform.OS === "ios" ? "sent.mp3" : undefined,
      },
      trigger:
        Platform.OS === "android"
          ? { channelId: TRANSACTIONS_CHANNEL_ID }
          : null,
    });
  } catch {
    // Scheduling failed (no permission, web fallback, etc). Non-fatal.
  }
}

/**
 * Present (or update) the ongoing sync-progress notification. Reusing a fixed
 * identifier means each call REPLACES the previous notification rather than
 * stacking, so the tray shows a single, live "Syncing …%" entry.
 *
 * On Android it is marked `sticky` (ongoing) so the user can't swipe it away
 * while a sync is in flight; the OS removes it automatically if the app process
 * is killed. Call {@link dismissSyncNotification} when the sync completes.
 */
export async function presentSyncNotification(
  progress: number,
  blockHeight: number,
): Promise<void> {
  await initNotifications();
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: SYNC_NOTIFICATION_ID,
      content: {
        title: t("notifications.sync.title"),
        body: t("notifications.sync.body", {
          progress,
          block: blockHeight.toLocaleString(),
        }),
        data: { type: "sync" },
        sticky: true,
        autoDismiss: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
      },
      trigger: null,
    });
  } catch {
    // Notification subsystem unavailable (web/electron, no permission) — ignore.
  }
}

/** Remove the ongoing sync-progress notification (sync finished or stopped). */
export async function dismissSyncNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(SYNC_NOTIFICATION_ID);
  } catch {
    // Already gone / unavailable — nothing to do.
  }
}
