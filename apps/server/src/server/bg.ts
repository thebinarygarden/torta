import { createHash, randomBytes } from 'node:crypto';

/**
 * How torta talks to binarygarden.com over OAuth. Everything here is optional:
 * an install that never links an account never calls any of it.
 */
export type BgConfig = {
  url: string;
  clientId: string;
  fetch: typeof fetch;
};

export const defaultBg: BgConfig = {
  url: process.env.TORTA_BG_URL ?? 'https://binarygarden.com',
  // The public client ID registered at binarygarden.com/admin/clients. Public
  // clients use PKCE instead of a secret, so it is safe to ship in the app.
  clientId: process.env.TORTA_BG_CLIENT_ID ?? 'torta',
  fetch: (...args) => fetch(...args),
};

const b64url = (b: Buffer) => b.toString('base64url');

export function pkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export const newState = () => b64url(randomBytes(16));

export function authorizeUrl(
  bg: BgConfig,
  p: { redirectUri: string; state: string; challenge: string }
) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: bg.clientId,
    redirect_uri: p.redirectUri,
    scope: 'openid profile email',
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  });
  return `${bg.url}/api/auth/oauth2/authorize?${q}`;
}

export type LinkedAccount = {
  userId: string;
  email: string | null;
};

/** Exchanges the authorization code for tokens, then fetches who signed in. */
export async function exchangeCode(
  bg: BgConfig,
  p: { code: string; redirectUri: string; verifier: string }
): Promise<LinkedAccount> {
  const tokenRes = await bg.fetch(`${bg.url}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: bg.clientId,
      code_verifier: p.verifier,
    }),
  });
  if (!tokenRes.ok)
    throw new Error(`token exchange failed (${tokenRes.status})`);
  const tokens = (await tokenRes.json()) as { access_token: string };

  const infoRes = await bg.fetch(`${bg.url}/api/auth/oauth2/userinfo`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) throw new Error(`userinfo failed (${infoRes.status})`);
  const info = (await infoRes.json()) as { sub: string; email?: string };
  return {
    userId: info.sub,
    email: info.email ?? null,
  };
}
