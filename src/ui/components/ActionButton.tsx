/**
 * ActionButton — a bordered "pill" quick action (icon above a label) used in the
 * home actions row. Sits in a `flex-row` with `flex-1` siblings so a row of them
 * divides the width evenly.
 */

import { View, Text, Pressable } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTheme } from "@oxyhq/bloom/theme";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

interface ActionButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
}

export function ActionButton({ icon, label, onPress }: ActionButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-start bg-surface rounded-2xl px-3.5 py-4 active:opacity-70"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons
        name={icon}
        size={22}
        color={theme.colors.primary}
      />
      <Text className="text-primary text-xs mt-1.5 font-medium">{label}</Text>
    </Pressable>
  );
}
