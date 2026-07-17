/**
 * Send screen.
 *
 * Thin route wrapper: the entire send UI + logic lives in {@link SendSheet} so
 * the same body can be shown inside a Bloom bottom-sheet on the home screen.
 * Here it renders as a full screen — safe-area top, horizontal padding, and its
 * own scroll — and forwards the `faircoin:` deep-link params (address / amount)
 * into the sheet content so they prefill the form.
 */

import { View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { SendSheet } from "../../src/ui/sheets/SendSheet";

export default function SendScreen() {
  const insets = useSafeAreaInsets();
  // Deep link params (from a `faircoin:` URI or QR scan navigation).
  const params = useLocalSearchParams<{ address?: string; amount?: string }>();

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <SendSheet address={params.address} amount={params.amount} />
      </ScrollView>
    </View>
  );
}
