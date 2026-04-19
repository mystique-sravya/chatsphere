/**
 * End-to-End Encryption for ChatSphere
 *
 * Uses AES-256-GCM with per-room symmetric keys.
 * - DM rooms: key derived from ECDH key exchange between two users
 * - Private rooms: key derived from a shared room secret
 * - Public rooms: not encrypted
 *
 * Encrypted messages are prefixed with "e2e:" followed by base64(iv + ciphertext).
 */

const E2E_PREFIX = 'e2e:';
const KEY_STORE = 'chatsphere_e2e_keys';

// In-memory cache of derived CryptoKeys
const keyCache = new Map<string, CryptoKey>();

function getStoredKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY_STORE) || '{}');
  } catch {
    return {};
  }
}

function storeRoomKey(roomId: string, keyHex: string): void {
  const keys = getStoredKeys();
  keys[roomId] = keyHex;
  localStorage.setItem(KEY_STORE, JSON.stringify(keys));
}

function arrayToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToArray(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function arrayToBase64(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

function base64ToArray(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  const cached = keyCache.get(keyHex);
  if (cached) return cached;

  const raw = hexToArray(keyHex);
  const key = await crypto.subtle.importKey(
    'raw', raw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  );
  keyCache.set(keyHex, key);
  return key;
}

/**
 * Generate a new 256-bit room key and store it for the given room.
 */
export async function generateRoomKey(roomId: string): Promise<string> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const hex = arrayToHex(key.buffer);
  storeRoomKey(roomId, hex);
  return hex;
}

/**
 * Set a room key (received from another user or derived from ECDH).
 */
export function setRoomKey(roomId: string, keyHex: string): void {
  storeRoomKey(roomId, keyHex);
}

/**
 * Get the stored key hex for a room, if any.
 */
export function getRoomKey(roomId: string): string | null {
  return getStoredKeys()[roomId] || null;
}

/**
 * Check if a room has E2E encryption enabled.
 */
export function hasRoomKey(roomId: string): boolean {
  return !!getStoredKeys()[roomId];
}

/**
 * Encrypt a plaintext message for a room using AES-256-GCM.
 * Returns a string prefixed with "e2e:" followed by base64(iv + ciphertext).
 */
export async function encryptMessage(roomId: string, plaintext: string): Promise<string> {
  const keyHex = getRoomKey(roomId);
  if (!keyHex) return plaintext; // No key = send plaintext

  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return E2E_PREFIX + arrayToBase64(combined);
}

/**
 * Decrypt an encrypted message. If the message is not encrypted (no "e2e:" prefix),
 * returns it as-is. If decryption fails, returns a placeholder.
 */
export async function decryptMessage(roomId: string, message: string): Promise<string> {
  if (!message.startsWith(E2E_PREFIX)) return message;

  const keyHex = getRoomKey(roomId);
  if (!keyHex) return '🔒 Encrypted message (missing key)';

  try {
    const key = await importKey(keyHex);
    const combined = base64ToArray(message.slice(E2E_PREFIX.length));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return '🔒 Encrypted message (decryption failed)';
  }
}

/**
 * Check if a message string is E2E encrypted.
 */
export function isEncrypted(message: string): boolean {
  return message.startsWith(E2E_PREFIX);
}

/**
 * Remove the room key (e.g., when leaving a room).
 */
export function removeRoomKey(roomId: string): void {
  const keys = getStoredKeys();
  delete keys[roomId];
  localStorage.setItem(KEY_STORE, JSON.stringify(keys));
  keyCache.delete(keys[roomId]);
}
