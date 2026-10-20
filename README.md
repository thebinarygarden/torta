# torta

torta is a free, open source point-of-sale system for restaurants. It runs on a laptop the
owner already has and keeps working with no internet connection.

It is a [Binary Garden](https://binarygarden.com) product.

## How it works

- **The laptop is the server.** The owner installs the torta desktop app (macOS, Windows
  or Linux). It stores the menu, every order and the sales history in a database on that
  laptop, and it is the single source of truth.
- **Tablets and phones are the terminals.** Any device on the same wifi opens a link served
  by the laptop: `/order` to take orders, `/kitchen` to see what needs cooking. Nothing is
  installed on them. Each device is paired once with a six-digit code shown on the laptop,
  and after that it only stores a device token.
- **The owner manages everything from the laptop window**, under `/admin`: the menu, sales,
  paired devices and settings.
- **No internet is required.** When the laptop is online, scanning a new barcode into
  inventory asks [Open Food Facts](https://world.openfoodfacts.org) for the product's name
  and size; offline, the owner types them.

```
laptop (torta desktop app)                         tablets and phones (a browser)
┌───────────────────────────────────────────┐
│ Electron main process (Node)              │      http://192.168.1.85:7070/order
│  ├ PGlite database + Drizzle              │ ◄──  http://192.168.1.85:7070/kitchen
│  ├ Hono HTTP api on 0.0.0.0:7070  /api/*  │      (device token in localStorage)
│  ├ WebSocket on the same port     /ws     │
│  └ the built web app, every other path    │
│ window → http://127.0.0.1:7070/admin      │
└───────────────────────────────────────────┘
```

### One server, three ways to start it

All three call the same `createServer()` in `apps/server/src/server/create.ts`. It opens
the database, applies migrations, mounts the api, starts listening and attaches the
WebSocket. If it is given a `staticDir`, it also serves the built web app on every path
outside `/api`, falling back to `index.html` so client-side routes like `/pair` load.

| Started by        | Entry point         | Serves the web app                      | Database                   | Admin login                        |
| ----------------- | ------------------- | --------------------------------------- | -------------------------- | ---------------------------------- |
| `pnpm dev`        | `src/dev.ts`        | `apps/web/dist`, rebuilt on every save  | `apps/server/.data`        | the password, kept across restarts |
| `pnpm electron`   | `src/main/index.ts` | `apps/web/dist`, built once at launch   | Electron user data (below) | the window logs itself in          |
| The installed app | `src/main/index.ts` | the copy bundled in the app's resources | Electron user data (below) | the window logs itself in          |

Electron's user data folder is `~/Library/Application Support/torta/db` on macOS and
`%APPDATA%\torta\db` on Windows. It is where an owner's real data lives, it survives app
updates, and it is a **different database** from the headless server's `.data` folder. A
menu you build in one does not appear in the other.

`pnpm dev` is the everyday loop: the same server and the same built pages as the desktop
app, without a window, restarting in about a second when you save. Use `pnpm electron`
when you are testing something specific to Electron: the self-logged-in window, the dock
menu, the updater, packaging.

### The web app

`apps/web` is one Vite + React single-page app with four surfaces. The server serves the
same build to the Electron window and to every tablet.

| Route      | Who uses it          | Auth                                  |
| ---------- | -------------------- | ------------------------------------- |
| `/admin`   | the owner            | admin session cookie                  |
| `/order`   | staff taking orders  | device token, or the admin cookie     |
| `/kitchen` | cooks                | device token, or the admin cookie     |
| `/pair`    | a new tablet joining | none; it exchanges a code for a token |

`/` has no page of its own. It redirects to the last surface the device used, or `/order`.
A device with no token that lands on `/order` or `/kitchen` is sent to `/pair`, so opening
`/` on a fresh browser shows the pairing screen. On the laptop, go to `/admin` instead.

### Auth

There are exactly two kinds of principal (`apps/server/src/server/auth.ts`):

- **`admin`** comes from an httpOnly cookie backed by an in-memory session set. Sessions do
  not survive a restart: the Electron window creates a fresh one on every launch, and
  anyone else logs in again with the admin password. `pnpm dev` is the exception: it keeps
  sessions in `apps/server/.data/sessions.json`, so saving a server file does not log you
  out.
- **`device`** comes from `Authorization: Bearer <token>`. The server stores only the
  token's SHA-256 in the `devices` table, so tokens survive restarts and the owner can
  revoke one from the admin overview.

The WebSocket accepts the same two credentials: the cookie, or the token as `?token=` on
`/ws`.

The admin password is set during first-run setup and stored as an scrypt hash. It cannot
be read back. There is currently no reset flow: changing it requires the current password,
and the only way back in without it is to delete the database.

### Pairing a device

1. In `/admin`, the owner taps **add device**. The server creates a six-digit code that
   expires after five minutes, can be used once, and replaces any earlier unused code.
2. The overview shows the laptop's LAN address and a QR code for `/pair?code=…`. The
   address is the first private IPv4 address on a real network adapter; VPN, Docker and VM
   adapters are skipped. The owner can pick a different one if the guess is wrong.
3. The tablet opens that URL, names itself, and posts the code to `/api/pair`. It gets a
   long-lived token back, stores it in `localStorage` as `torta.token`, and opens `/order`.
4. If the owner removes the device, its next request gets a 401 and the web app sends it
   back to `/pair`.

Login is rate limited to 5 attempts per minute per IP and pairing to 10, in memory.

### Realtime

One WebSocket endpoint, `/ws`, on the same port as the api. The server broadcasts `hello`,
`order.created`, `order.updated`, `order.deleted` and `menu.updated` to every connected
socket, and each
surface ignores what it does not show. Every connect and reconnect starts with `hello`,
which tells the client to refetch, so events missed while a tablet was offline never
matter. The client reconnects with backoff, and again when the tab becomes visible or the
network comes back.

### Orders and money

- Money is integer cents and tax is basis points (8.25% is `825`).
- The server prices every order from the current menu and never trusts the client's
  numbers. Each order item snapshots its name, price and modifiers, so editing the menu
  later does not change past orders.
- An order is `sent` until the kitchen marks it `completed` or `cancelled`, and a
  finished order can be reopened to `sent`. `canTransition` in `apps/shared/src/orders.ts`
  is the only place that decides this; an illegal move gets a 409.
- Order numbers restart each business day.

### Why it is built this way

- **Electron for the laptop app.** The hard part is a server (HTTP, WebSockets, a
  database), and Electron's main process is Node, so the whole server is one language and
  one process.
- **A web app over the LAN for tablets**, not native apps. No app stores, it works on iOS
  and Android alike, and it ships inside the same download as the server.
- **Vite and React, not Next.js** (unlike binarygarden.com and the flora site). Next.js's value is its
  server, and torta's server is Hono inside Electron.
- **PGlite**: real Postgres compiled to WebAssembly, running inside the app. No separate
  database process, no port, no installer permissions.
- **Pairing codes instead of a shared password.** The same effort for staff, and nothing
  to rotate when someone leaves: the owner removes that device.

### Known limitations

- **No tray icon.** On macOS the app keeps serving after its window closes (the dock menu
  reopens it); on Windows, closing the window quits.
- **The Windows build has never been run**; only the release workflow builds it.
- **iPads and iPhones over plain HTTP** get no wake lock, so kitchen tablets need
  auto-lock turned off. A home-screen web clip has its own storage: add the page to the
  home screen first, then pair from there.
- **Tablets find the laptop by IP address.** If the laptop's address changes they must
  pair again, so give it a DHCP reservation on the router.
- **Closing the lid sleeps a Mac** despite the app's sleep blocker. Keep the lid open or
  use an external display.
- **Planned, not built**: employee PINs, receipt and kitchen printers, payments, and finding
  the laptop without an IP address (mDNS).

## Development

### Prerequisites

- **Node 24** (see `.node-version`). Vite, Vitest and Electron refuse older versions, and
  an older Node fails with errors such as `does not provide an export named 'styleText'`.
  Check with `node -v`. If you installed Node from nodejs.org in the past, its copy in
  `/usr/local/bin` may come before Homebrew's on your `PATH`.
- **pnpm 12**, pinned by `packageManager` in `package.json`. `corepack enable` installs it.
- `pnpm install` from the repository root. It downloads Electron's binary.

### Running it

One command runs everything:

```bash
pnpm dev
```

It builds the web app into `apps/web/dist`, starts the server on :7070, and prints two
addresses:

```
torta · this laptop  http://localhost:7070/admin
torta · tablets      http://192.168.1.85:7070  (admin → add device → scan)
```

The laptop and every tablet load the same built pages from the same server, the way a
restaurant runs torta. There is no separate web dev server and no second port.

- **Saving a web file** (`apps/web/src`) rebuilds the pages in about a second, and every
  open page reloads itself, tablets included. It is a full reload, so an unsent cart is
  lost.
- **Saving a server or shared file** (`apps/server/src`, `apps/shared/src`) restarts
  the server. You stay logged in, and pages reconnect and refetch on their own.
- **Ctrl-C** stops everything.

The development build includes React's development mode and sourcemaps, so errors in the
browser console are readable. `pnpm build` makes the production build.

`scripts/dev.mjs` is the whole setup: it runs Vite's build in watch mode, waits for the
first build, writes `licenses.txt`, then starts `tsx watch` on `apps/server/src/dev.ts`.

### First run

Open the printed laptop address. On a fresh data folder it asks for a restaurant name and
an admin password (at least 8 characters). Then open `/order` and `/kitchen` in other
tabs; the admin cookie lets you into both without pairing.

To start over, stop `pnpm dev` and run `pnpm dev:reset`. It replaces the database with
one holding only the seed menu from `apps/server/src/seed/menu.ts`, so setup asks for the
name and password again. It refuses to run while torta is answering on 7070–7079.

### Testing on a real tablet or phone

In `/admin`, tap **add device** and scan the QR code with the tablet. It must be on the
same wifi as the laptop. The first time, macOS may ask whether to accept incoming
connections for Node; allow it, or the tablet will time out.

To pair a second browser on the laptop itself, use a private window so it does not share
your admin cookie.

If :7070 is busy (usually because the desktop app is running), the server takes the next
free port up to 7079 and says so. A device token is stored per address, so tablets paired
on one port have to pair again on another.

### Running the desktop app

```bash
pnpm electron   # builds everything, then opens the window
```

Stop `pnpm dev` first, or the two will be on different ports with different databases.
The window opens `/admin` already logged in. On macOS, closing the window keeps the
server running; the dock menu has **open admin** and **copy lan url**. After changing
code, quit and run `pnpm electron` again.

### Checks

```bash
pnpm test           # Vitest suites in apps/server/test
pnpm lint           # ESLint across the workspace
pnpm typecheck
pnpm build          # production web build, then the Electron main bundle into apps/server/bundle
pnpm format:check   # Prettier; pnpm format fixes it
```

The tests need no services. Each one runs against an in-memory PGlite, calls the Hono app
directly with `app.request()`, and the WebSocket tests use a real client on a random port.
CI (`.github/workflows/ci.yaml`) runs all five on every pull request.

### Database changes

The schema is `apps/server/src/db/schema.ts`. After editing it:

```bash
pnpm db:generate
```

That writes a new SQL migration into `apps/server/drizzle/`. Commit it. Migrations run on
every startup, so they must be additive: an owner's laptop upgrades in place with real
data in it. `@electric-sql/pglite` is pinned to an exact version because its on-disk
format follows the embedded Postgres major version.

### Packaging and releases

```bash
pnpm dist   # installers for the current OS into apps/server/release
```

The installers package `apps/server/bundle/`, which `pnpm build` generates from scratch:
the server and Electron main process bundled into one `main.js`, a copy of PGlite (it
loads its WebAssembly from next to its own files, so it can't be bundled), and a
generated `package.json` whose only dependency is PGlite. Packaging that folder instead
of `apps/server` keeps every other package out of the installers, since `main.js` already
contains them. If that manifest listed no dependencies, electron-builder would fall back
to `apps/server`'s and ship them twice. It is build output: never edit it, and deleting it
is always safe.

For a quick unsigned macOS build that skips the installers:

```bash
cd apps/server
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --dir --arm64
./release/mac-arm64/torta.app/Contents/MacOS/torta
```

Releases come from `.github/workflows/release.yaml`. Pushing a `v<version>` tag that
matches `apps/server/package.json` builds macOS, Windows and Linux and publishes a GitHub release,
which the installed apps pick up through `electron-updater`. The workflow signs and
notarizes the macOS build only when the signing secrets are set, and always signs the
Windows build through Azure. See [docs/signing.md](docs/signing.md). macOS only installs
signed updates.

Before building, the `upgrade-check` job seeds a database with the previous release
(`src/seed`) and opens it with this release's migrations (`src/check-upgrade.ts`). If that
fails, nothing is published. It proves the migrations on sample data, not on every owner's.

On the laptop, Settings → updates shows the version and the update status, has "check
now", and turns automatic updates on or off (on by default: check at launch and every six
hours, download in the background). A downloaded update installs the next time torta
quits, or at once with "restart to update". Quitting waits for the database to close.

The first launch of a new version copies the database to `db-backup` next to `db` before
opening it, replacing the previous copy. Settings shows when, and opens the folder. To
restore it, quit torta and replace `db` with `db-backup`.

### Third-party licenses

The web build ends by running `scripts/notices.mjs` (`pnpm dev` runs it once at startup),
which writes
`apps/web/dist/licenses.txt`: the license text of every production dependency, taken
from `pnpm licenses list --prod`. Most of those licenses require their notice to ship
with the code, and because the file is part of the web build, the headless server, the
Electron window and the installers all serve it at `/licenses.txt`. Admin settings links
to it, next to the link to torta's source. electron-builder adds Electron's and
Chromium's own notices to the packaged app.

Adding a dependency needs no extra step, but check that its license is compatible with
the AGPL first (MIT, ISC, BSD and Apache-2.0 are).

### Environment variables

| Variable      | Used by    | Default | Purpose                                                           |
| ------------- | ---------- | ------- | ----------------------------------------------------------------- |
| `PORT`        | `pnpm dev` | `7070`  | First port the dev server tries                                   |
| `TORTA_SMOKE` | Electron   | unset   | Print the window's `/api/me` status and quit; for scripted checks |

## Repository layout

```
apps/server       Hono api, WebSocket, Drizzle schema and migrations, the Electron shell.
  src/server      createServer() and every route group
  src/db          schema and openDb()
  src/main        Electron: window, paths, updater
  src/dev.ts      the headless entry point
  drizzle/        generated migrations, committed
  test/           Vitest suites
apps/shared       zod schemas and types for the api and WebSocket events, and the order
                  state machine. Both apps import it as TypeScript source (@torta/shared).
apps/web          the Vite + React app: routes/{admin,order,kitchen,pair}, api/, components/
scripts/          dev.mjs (pnpm dev) and notices.mjs (licenses.txt)
docs/             design notes
```

The rules the code follows are in [CLAUDE.md](CLAUDE.md). The UI follows
[flora's design guide](https://github.com/thebinarygarden/flora/blob/main/docs/DESIGN.md) with product hue 90.

## License

torta is licensed under the GNU Affero General Public License, version 3 or any later
version (`AGPL-3.0-or-later`). You can use, change and sell it. If you distribute a
modified version, or run one that people use over a network, you must make its source
code available to them under the same license. The full text is in [LICENSE](LICENSE).

```
Copyright (C) 2026 Binary Garden

This program is free software: you can redistribute it and/or modify it under the terms
of the GNU Affero General Public License as published by the Free Software Foundation,
either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
```
