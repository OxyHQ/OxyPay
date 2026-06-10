import { useInfiniteQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import type { Currency } from '@oxypay/shared-types';
import { payApi } from '@/lib/payClient';

export function useTransactions(filters: { walletId?: string; currency?: Currency } = {}) {
  const { isAuthenticated } = useOxy();
  return useInfiniteQuery({
    queryKey: ['oxypay', 'transactions', filters],
    enabled: isAuthenticated,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      payApi.listTransactions({ ...filters, cursor: pageParam, limit: 25 }),
    getNextPageParam: (last) => last.nextCursor,
  });
}
