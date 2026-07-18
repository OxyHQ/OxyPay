const ID_ENTROPY_BYTES = 12;
const SECRET_ENTROPY_BYTES = 16;

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function newId(prefix: 'pi' | 'evt' | 'merch' | 'link' | 'cs'): string {
  return `${prefix}_${randomHex(ID_ENTROPY_BYTES)}`;
}

export function clientSecretFor(id: string): string {
  return `${id}_secret_${randomHex(SECRET_ENTROPY_BYTES)}`;
}
