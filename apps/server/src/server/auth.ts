import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { schema } from '../db';

const scrypt = promisify(scryptCb);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [, salt, hex] = stored.split('$');
  if (!salt || !hex) return false;
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export type Principal =
  { kind: 'admin' } | { kind: 'device'; deviceId: string; name: string };

export const ADMIN_COOKIE = 'torta_admin';

/**
 * Admin sessions are kept in memory on purpose. A restart logs out anyone who
 * signed in as admin over the LAN, while the Electron window simply creates a
 * fresh session at launch. Device tokens are stored in the database instead.
 *
 * `file` is for the headless dev server only: it keeps sessions across the
 * restart that happens on every save.
 */
export class Sessions {
  private ids = new Set<string>();
  constructor(private file?: string) {
    if (file && existsSync(file)) {
      this.ids = new Set(JSON.parse(readFileSync(file, 'utf8')) as string[]);
    }
  }
  create(): string {
    const id = newToken();
    this.ids.add(id);
    this.save();
    return id;
  }
  has(id: string | undefined): boolean {
    return id !== undefined && this.ids.has(id);
  }
  delete(id: string | undefined): void {
    if (id && this.ids.delete(id)) this.save();
  }
  private save() {
    if (this.file) writeFileSync(this.file, JSON.stringify([...this.ids]));
  }
}

export function parseCookie(
  header: string | undefined,
  name: string
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export type Credentials = {
  cookie?: string;
  authorization?: string;
  /**
   * A device token passed as a query parameter. Browsers can't set headers on a
   * websocket upgrade, so this is how `/ws` authenticates devices.
   */
  token?: string;
};

export function createAuthenticator(db: Db, sessions: Sessions) {
  return async function authenticate(
    creds: Credentials
  ): Promise<Principal | null> {
    if (sessions.has(parseCookie(creds.cookie, ADMIN_COOKIE))) {
      return { kind: 'admin' };
    }
    const bearer = creds.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = bearer ?? creds.token;
    if (!token) return null;
    const [device] = await db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.tokenHash, sha256(token)))
      .limit(1);
    if (!device || device.revokedAt) return null;
    await db
      .update(schema.devices)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.devices.id, device.id));
    return { kind: 'device', deviceId: device.id, name: device.name };
  };
}
