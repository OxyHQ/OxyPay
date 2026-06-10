import { useTheme } from '@oxyhq/bloom/theme';

/**
 * Single hook that returns the Bloom theme colours for the active mode
 * (light/dark). The Oxy ecosystem standardises on Bloom for its design
 * tokens, so `useColors()` is the only colour source consumed by Oxy Pay.
 */
export function useColors() {
  const { colors } = useTheme();
  return colors;
}
