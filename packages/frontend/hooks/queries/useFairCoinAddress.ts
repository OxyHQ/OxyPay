import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { payApi } from '@/lib/payClient';

export function useFairCoinAddress() {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: ['oxypay', 'faircoin', 'deposit-address'],
    enabled: isAuthenticated,
    queryFn: () => payApi.getDepositAddress(),
    staleTime: 1000 * 60 * 60,
  });
}
