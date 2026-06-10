import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Currency } from '@oxypay/shared-types';
import { payApi } from '@/lib/payClient';
import { useOxy } from '@oxyhq/services';

const KEYS = {
  walletList: ['oxypay', 'wallets'] as const,
};

export function useWallets() {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: KEYS.walletList,
    enabled: isAuthenticated,
    queryFn: () => payApi.listWallets(),
  });
}

export function useCreateWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['oxypay', 'wallets', 'create'],
    mutationFn: (currency: Currency) => payApi.createWallet(currency),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.walletList }),
  });
}

export function useDevTopUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['oxypay', 'wallets', 'dev-top-up'],
    mutationFn: ({ currency, amount }: { currency: Currency; amount: string }) =>
      payApi.devTopUp(currency, amount),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.walletList });
      qc.invalidateQueries({ queryKey: ['oxypay', 'transactions'] });
    },
  });
}
