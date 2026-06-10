import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

/**
 * Cash Out flow (withdraw to FairCoin) — placeholder. The live FairCoin
 * withdrawal endpoint is not implemented yet (see backend
 * `faircoin.service.ts`). This screen exists so the home action button
 * routes somewhere.
 */
export default function CashOutScreen() {
  const colors = useColors();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
      <View style={styles.center}>
        <Text style={[styles.title, { color: colors.text }]}>Cash Out</Text>
        <Text style={[styles.body, { color: colors.icon }]}>
          FairCoin withdrawals will be enabled once the live FairCoin node is wired.
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
