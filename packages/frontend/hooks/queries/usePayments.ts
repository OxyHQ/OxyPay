import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Currency } from '@oxypay/shared-types';
import { payApi } from '@/lib/payClient';

export function useTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['oxypay', 'payments', 'transfer'],
    mutationFn: ({
      toUserId,
      amount,
      note,
    }: {
      toUserId: string;
      amount: { amount: string; currency: Currency };
      note?: string;
    }) => payApi.transfer(toUserId, amount, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oxypay', 'wallets'] });
      qc.invalidateQueries({ queryKey: ['oxypay', 'transactions'] });
    },
  });
}
