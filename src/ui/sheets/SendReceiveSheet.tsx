/**
 * Combined Send / Receive bottom-sheet body.
 *
 * A single content-only body with a Send | Receive segmented toggle at the top,
 * so the home Send / Receive pills open ONE sheet and the user can flip between
 * the two flows without closing it. Below the toggle it renders the existing
 * content-only bodies verbatim: {@link SendSheet} for `"send"`, and
 * {@link ReceiveSheet} with `heading={false}` for `"receive"` — the toggle is
 * the header, so the receive body suppresses its own "Receive" title.
 *
 * Like `SendSheet` / `ReceiveSheet` / `WalletSwitcherSheet`, this renders NO
 * full-screen wrapper and NO safe-area padding — it lives inside a Bloom
 * bottom-sheet `<Dialog placement="bottom">`. It also renders NO scroll
 * container of its own, and that is deliberate: the host `<Dialog>` must own the
 * scroll.
 *
 * SCROLL (host contract): the send form is tall and must scroll. Bloom's Dialog
 * is NOT backed by `@gorhom/bottom-sheet`, so `@gorhom/bottom-sheet`'s
 * `BottomSheetScrollView` cannot be used here — it hard-throws
 * `"'useBottomSheetInternal' cannot be used out of the BottomSheet!"` outside a
 * gorhom sheet. A plain React Native `ScrollView` does not work either: Bloom's
 * drag-to-dismiss pan is uncoordinated with a foreign scroller and intercepts
 * the drag. The scroll therefore has to come from Bloom's own internal
 * `ScrollView`, which Bloom enables whenever the host `<Dialog>` carries
 * declarative chrome. Bloom keys that on `title !== undefined` but only *renders*
 * a visible title when `title` is truthy — so the host must open this sheet with
 * `title=""` (an empty string): Bloom scrolls the body, yet shows no header text,
 * leaving this component's toggle as the sole header. Adding a scroller here as
 * well would produce a scroll-in-scroll, so this body stays scroller-free —
 * exactly like the sibling sheets.
 */

import type React from "react";
import { View, Text, Pressable } from "react-native";
import { SendSheet } from "./SendSheet";
import { ReceiveSheet } from "./ReceiveSheet";
import { t } from "../../i18n";

type Mode = "send" | "receive";

const MODES: readonly Mode[] = ["send", "receive"] as const;
const CONTENT_MAX_WIDTH = 600;

function getModeLabel(mode: Mode): string {
  return mode === "send" ? t("wallet.send") : t("wallet.receive");
}

export function SendReceiveSheet({
  mode,
  onModeChange,
  address,
  amount,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  address?: string;
  amount?: string;
}): React.JSX.Element {
  return (
    <View
      className="w-full self-center gap-5"
      style={{ maxWidth: CONTENT_MAX_WIDTH }}
    >
      {/* Send | Receive segmented toggle — the sheet's header. Two equal pills;
          the active one is filled with the primary color. */}
      <View className="flex-row bg-surface rounded-full p-1">
        {MODES.map((segment) => {
          const isActive = mode === segment;
          return (
            <Pressable
              key={segment}
              onPress={() => onModeChange(segment)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={getModeLabel(segment)}
              className={`flex-1 rounded-full py-2.5 items-center ${
                isActive ? "bg-primary" : "bg-transparent active:opacity-70"
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  isActive ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {getModeLabel(segment)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Content — the existing content-only bodies, driven by `mode`. */}
      {mode === "send" ? (
        <SendSheet address={address} amount={amount} />
      ) : (
        <ReceiveSheet heading={false} />
      )}
    </View>
  );
}
