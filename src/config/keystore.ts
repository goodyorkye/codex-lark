import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import type { AppPaths } from './app-paths';
import { paths } from './paths';
import { writeFileAtomic } from '../platform/atomic-write';

/**
 * Local AES-256-GCM keystore for App Secrets and similar.
 *
 * Layout on disk:
 *   ~/.lark-channel/secrets.enc      — JSON map { id → encrypted envelope }
 *   ~/.lark-channel/.keystore.salt   — 32 random bytes, generated once
 *
 * Both files are chmod 0600. The encryption key is derived (PBKDF2-SHA256,
 * 100k iters) from `hostname + userInfo().username + salt`. This is
 * **defense-in-depth against accidental disclosure** (backups, git commits,
 * log dumps) — *not* against a same-user process actively decrypting. That
 * threat needs a real OS keychain, which is out of scope for this bridge
 * given lark-cli already terminates secrets in its own keychain on bind.
 */

const KEY_LEN = 32;
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16; // GCM auth tag
const PBKDF2_ITER = 100_000;
const FILE_VERSION = 1;
const derivedKeyCache = new Map<string, Buffer>();

interface Envelope {
  /** base64 of 12-byte IV */
  iv: string;
  /** base64 of ciphertext */
  data: string;
  /** base64 of 16-byte GCM auth tag */
  tag: string;
}

interface StoreFile {
  version: number;
  entries: Record<string, Envelope>;
}

export type KeystorePaths = Pick<AppPaths, 'secretsFile' | 'keystoreSaltFile'>;

/** Read + return the full keystore. Missing file or unreadable → empty store. */
async function readStore(storePaths: KeystorePaths = paths): Promise<StoreFile> {
  try {
    const text = await readFile(storePaths.secretsFile, 'utf8');
    const parsed = JSON.parse(text) as Partial<StoreFile>;
    if (parsed?.version !== FILE_VERSION || !parsed.entries) return emptyStore();
    return { version: parsed.version, entries: { ...parsed.entries } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore();
    throw err;
  }
}

function emptyStore(): StoreFile {
  return { version: FILE_VERSION, entries: {} };
}

async function writeStore(store: StoreFile, storePaths: KeystorePaths = paths): Promise<void> {
  await writeFileAtomic(storePaths.secretsFile, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
}

/**
 * Load the salt, or generate one if absent. The salt is **not a secret** —
 * an attacker that can read this file can also read the keystore. Its job
 * is to ensure two users on the same machine don't derive the same key.
 */
async function loadOrCreateSalt(storePaths: KeystorePaths = paths): Promise<Buffer> {
  try {
    const buf = await readFile(storePaths.keystoreSaltFile);
    if (buf.length === KEY_LEN) return buf;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const salt = randomBytes(KEY_LEN);
  await writeFileAtomic(storePaths.keystoreSaltFile, salt, { mode: 0o600 });
  return salt;
}

async function deriveKey(storePaths: KeystorePaths = paths): Promise<Buffer> {
  const cacheKey = `${storePaths.keystoreSaltFile}`;
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) return cached;
  const salt = await loadOrCreateSalt(storePaths);
  const seed = `${hostname()}|${userInfo().username}`;
  const key = pbkdf2Sync(seed, salt, PBKDF2_ITER, KEY_LEN, 'sha256');
  derivedKeyCache.set(cacheKey, key);
  return key;
}

function encrypt(key: Buffer, plaintext: string): Envelope {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    data: enc.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decrypt(key: Buffer, env: Envelope): string {
  const iv = Buffer.from(env.iv, 'base64');
  const data = Buffer.from(env.data, 'base64');
  const tag = Buffer.from(env.tag, 'base64');
  if (iv.length !== IV_LEN) throw new Error('invalid IV length');
  if (tag.length !== TAG_LEN) throw new Error('invalid auth tag length');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

/** Look up an entry by id (e.g. "app-cli_xxx"). Returns plaintext or
 * `undefined` when not present. Errors (decryption failure, invalid file)
 * propagate. */
export async function getSecret(
  id: string,
  storePaths: KeystorePaths = paths,
): Promise<string | undefined> {
  const store = await readStore(storePaths);
  const env = store.entries[id];
  if (!env) return undefined;
  const key = await deriveKey(storePaths);
  return decrypt(key, env);
}

/** Store / overwrite the secret for `id`. */
export async function setSecret(
  id: string,
  plaintext: string,
  storePaths: KeystorePaths = paths,
): Promise<void> {
  const key = await deriveKey(storePaths);
  const env = encrypt(key, plaintext);
  const store = await readStore(storePaths);
  store.entries[id] = env;
  await writeStore(store, storePaths);
}

/** Remove an entry. Returns true if something was removed. */
export async function removeSecret(
  id: string,
  storePaths: KeystorePaths = paths,
): Promise<boolean> {
  const store = await readStore(storePaths);
  if (!(id in store.entries)) return false;
  delete store.entries[id];
  await writeStore(store, storePaths);
  return true;
}

/** List ids (no secrets in the output, by design). */
export async function listSecretIds(storePaths: KeystorePaths = paths): Promise<string[]> {
  const store = await readStore(storePaths);
  return Object.keys(store.entries);
}

export function clearKeystoreDerivedKeyCache(): void {
  derivedKeyCache.clear();
}

export function keystoreDerivedKeyCacheSize(): number {
  return derivedKeyCache.size;
}
