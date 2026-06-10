import { View, Text, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

/**
 * NFC Tap-to-Pay. Native-only (iOS/Android). On web we never link to this
 * route in the first place, but if a user lands here we explain the gate.
 */
export default function TapToPayScreen() {
  const colors = useColors();
  const isWeb = Platform.OS === 'web';
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
      <View style={styles.center}>
        <Text style={[styles.title, { color: colors.text }]}>Tap to Pay</Text>
        <Text style={[styles.body, { color: colors.icon }]}>
          {isWeb
            ? 'NFC tap-to-pay is available on iOS and Android only.'
            : 'NFC integration coming soon. Hold your phone next to an Oxy Pay terminal to pay.'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 14, textAlign: 'center', maxWidth: 320 },
});
