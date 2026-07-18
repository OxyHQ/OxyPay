import { test, expect } from 'bun:test';
import type {
  SocialNextAddressResponse,
  EnrichmentResult,
  EnrichRequest,
  EnrichResponse,
} from '../social';

test('SocialNextAddressResponse shape compiles and round-trips through JSON', () => {
  const value: SocialNextAddressResponse = { address: 'TAbC123', index: 3 };
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
});

test('EnrichmentResult supports all three kinds', () => {
  const merchant: EnrichmentResult = {
    kind: 'merchant',
    displayName: 'Mercaria',
    avatarFileId: 'file_1',
    description: 'Marketplace',
  };
  const user: EnrichmentResult = {
    kind: 'user',
    displayName: 'Alice',
    username: 'alice',
    avatarFileId: 'file_2',
  };
  const unknown: EnrichmentResult = { kind: 'unknown' };
  expect(merchant.kind).toBe('merchant');
  expect(user.kind).toBe('user');
  expect(unknown.kind).toBe('unknown');
});

test('EnrichRequest / EnrichResponse round-trip', () => {
  const req: EnrichRequest = { addresses: ['TAbC123', 'TDeF456'] };
  const res: EnrichResponse = {
    data: {
      TAbC123: { kind: 'unknown' },
      TDeF456: { kind: 'merchant', displayName: 'Shop' },
    },
  };
  expect(Object.keys(res.data)).toEqual(req.addresses);
});
