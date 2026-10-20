# Support sessions (design only, not built)

A support session gives Binary Garden support temporary remote access to a restaurant's
torta install so they can help the owner. Three constraints shape the design:

- **The owner starts it.** Support can never open a session on their own.
- **It is time-boxed.** A session ends on its own after a fixed time.
- **Nothing is inbound.** The laptop never opens a port or keeps an always-on tunnel. All
  traffic travels over a connection the laptop itself makes outward.

## Flow

1. The owner opens Settings and chooses "start support session (30 min)". This only works
   if the install is linked to a Binary Garden account (`settings.bg_user_id`), because
   that link is how the relay knows whose install is connecting.
2. The torta server opens an outbound websocket to a relay running on Cloud Run
   (`wss://support.binarygarden.com/install`). It authenticates with an access token
   obtained from the stored refresh token. The laptop window then shows a short session
   code.
3. The support person signs in to the relay with their Binary Garden account and enters
   that code. The relay pairs the two connections.
4. The relay serializes HTTP requests from the support person's browser and forwards them
   to the torta server. The server answers them in-process with `app.fetch(request)`, as a
   new `support` principal. Principals in `src/server/auth.ts` are plain values, so this
   means adding one more `kind`, not a second auth path.
5. The session ends when the time runs out, when either side presses "stop", or when either
   connection drops. At no point does the server listen for incoming connections.

## What v1 already provides

- `createServer()` exposes the Hono `app`, so requests can be answered without binding a
  port.
- Principals are plain values. `requireAdmin` can be taught to accept `support` where
  support should be allowed, and to refuse it for password changes, unlinking the account
  and importing a backup.
- Linking a Binary Garden account already stores a sealed refresh token
  (`settings.bg_refresh_token`), which step 2 needs.

## Still to decide

- Where the relay service lives: a small Cloud Run service in this repository, or part of
  trunk.
- Whether support sees the full live admin UI (forwarded `/admin`) or a read-only subset.
- How a paid plan gates this feature. The likely answer is that the relay checks the
  account's entitlement by `bg_user_id` before pairing.
