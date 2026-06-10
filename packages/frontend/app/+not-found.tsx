import { Link, Stack } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function NotFound() {
  const colors = useColors();
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>This page doesn't exist.</Text>
        <Link href="/" style={[styles.link, { color: colors.primary }]}>
          Go home
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  link: { fontSize: 16 },
});
