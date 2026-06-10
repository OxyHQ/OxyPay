import type React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOxy, OxySignInButton } from '@oxyhq/services';
import { useColors } from '@/hooks/useColors';

interface SignInGateProps {
  children: React.ReactNode;
}

/**
 * Wrap any tree that requires an authenticated Oxy session. Renders a
 * centered call-to-action with the canonical Oxy sign-in button when the user
 * is signed out.
 */
export function SignInGate({ children }: SignInGateProps) {
  const { user, isLoading } = useOxy();
  const colors = useColors();
  const { t } = useTranslation();

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.text }]}>{t('errors.unauthorized')}</Text>
        <OxySignInButton text={t('errors.signIn')} />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
  },
});
