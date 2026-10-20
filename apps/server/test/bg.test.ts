import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { client, makeApp, setup } from './helpers';

const calls: { url: string; body?: string }[] = [];
const fakeBg: typeof fetch = async (input, init) => {
  const url = String(input);
  calls.push({ url, body: init?.body ? String(init.body) : undefined });
  if (url.endsWith('/oauth2/token')) {
    const form = new URLSearchParams(String(init?.body));
    if (form.get('code') !== 'good-code')
      return new Response('nope', { status: 400 });
    return Response.json({ access_token: 'at-1', refresh_token: 'rt-1' });
  }
  if (url.endsWith('/oauth2/userinfo')) {
    return Response.json({ sub: 'user-42', email: 'owner@example.com' });
  }
  return new Response('not found', { status: 404 });
};

const ctx = await makeApp(fakeBg);
afterAll(() => ctx.close());

let admin: ReturnType<typeof client>;
beforeAll(async () => {
  const { cookie } = await setup(ctx.app);
  admin = client(ctx.app, cookie);
});

const callback = (q: Record<string, string>) =>
  ctx.app.request(`/api/bg/callback?${new URLSearchParams(q)}`);

describe('binary garden link', () => {
  test('starts unlinked', async () => {
    expect((await admin.get('/admin/bg')).body).toMatchObject({
      linked: false,
    });
  });

  test('start returns a pkce authorize url on the loopback redirect', async () => {
    const { body } = await admin.post('/admin/bg/link/start');
    const url = new URL(body.url);
    expect(url.origin + url.pathname).toBe(
      'https://bg.test/api/auth/oauth2/authorize'
    );
    expect(url.searchParams.get('client_id')).toBe('torta-test');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:7070/api/bg/callback'
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('offline_access');
  });

  test('a callback with an unknown state is refused', async () => {
    const res = await callback({ code: 'good-code', state: 'made-up' });
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  test('the callback exchanges the code with the verifier and stores the account', async () => {
    const { body } = await admin.post('/admin/bg/link/start');
    const state = new URL(body.url).searchParams.get('state')!;
    const res = await callback({ code: 'good-code', state });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('owner@example.com');

    const token = calls.find((c) => c.url.endsWith('/oauth2/token'))!;
    const form = new URLSearchParams(token.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code_verifier')).toBeTruthy();
    expect(form.get('redirect_uri')).toBe(
      'http://127.0.0.1:7070/api/bg/callback'
    );

    const status = (await admin.get('/admin/bg')).body;
    expect(status).toMatchObject({
      linked: true,
      userId: 'user-42',
      email: 'owner@example.com',
    });
    expect(status.linkedAt).toBeTruthy();

    // The state is single use, so replaying the callback fails.
    expect((await callback({ code: 'good-code', state })).status).toBe(400);
  });

  test('a failed exchange leaves the link untouched and reports it', async () => {
    await admin.delete('/admin/bg/link');
    const { body } = await admin.post('/admin/bg/link/start');
    const state = new URL(body.url).searchParams.get('state')!;
    const res = await callback({ code: 'bad-code', state });
    expect(res.status).toBe(502);
    expect((await admin.get('/admin/bg')).body.linked).toBe(false);
  });

  test('unlink clears everything and needs admin', async () => {
    expect(
      (await ctx.app.request('/api/admin/bg', { method: 'DELETE' })).status
    ).toBe(401);
    expect((await admin.delete('/admin/bg/link')).body.linked).toBe(false);
  });
});
