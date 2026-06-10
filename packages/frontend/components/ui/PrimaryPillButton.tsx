import { Pressable, Text, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface PrimaryPillButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

/**
 * Cash App-style fat pill button. Two come side by side under the balance
 * ("Add Cash" / "Cash Out").
 */
export function PrimaryPillButton({
  label,
  onPress,
  variant = 'primary',
  style,
  disabled,
}: PrimaryPillButtonProps) {
  const colors = useColors();
  const isPrimary = variant === 'primary';
  const bg = isPrimary ? colors.primary : colors.primarySubtle;
  const fg = isPrimary ? colors.primaryForeground : colors.primarySubtleForeground;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    minWidth: 140,
  },
  label: { fontSize: 16, fontWeight: '600' },
});
