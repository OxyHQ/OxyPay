import { test, expect } from 'bun:test';
import { newId, clientSecretFor } from '../ids';

test('newId("pi") matches the pi_ prefixed hex format', () => {
  expect(newId('pi')).toMatch(/^pi_[0-9a-f]{24}$/);
});

test('newId("evt") matches the evt_ prefixed hex format', () => {
  expect(newId('evt')).toMatch(/^evt_[0-9a-f]{24}$/);
});

test('two successive newId("pi") values differ', () => {
  expect(newId('pi')).not.toBe(newId('pi'));
});

test('newId("merch") matches the merch_ prefixed hex format', () => {
  expect(newId('merch')).toMatch(/^merch_[0-9a-f]{24}$/);
});

test('newId("link") matches the link_ prefixed hex format', () => {
  expect(newId('link')).toMatch(/^link_[0-9a-f]{24}$/);
});

test('newId("cs") matches the cs_ prefixed hex format', () => {
  expect(newId('cs')).toMatch(/^cs_[0-9a-f]{24}$/);
});

test('clientSecretFor prefixes the id and appends a 32-hex secret', () => {
  const secret = clientSecretFor('pi_x');
  expect(secret.startsWith('pi_x_secret_')).toBe(true);
  expect(secret).toMatch(/_secret_[0-9a-f]{32}$/);
});
