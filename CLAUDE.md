# CLAUDE.md

torta is a free restaurant pos. One Electron app on the owner's laptop is the server: it
holds the menu and every order in an embedded Postgres (PGlite), serves the web app to
tablets over the wifi, and is the source of truth. Tablets open `/order` or `/kitchen` in a
browser and store nothing but a device token. Everything works with no internet.

Read `../flora/docs/DESIGN.md` before anything visual. torta's product hue is **90**; the
whole app sits in one `<ProductScope hue={90}>`. flora components, flora tokens, plain CSS.
No Tailwind, never a hardcoded color.

## Layout

- `apps/shared` — zod schemas and types for the api and websocket events, plus the
  order state machine. Consumed as TypeScript source by both apps.
- `apps/server` — Hono api under `/api`, `ws` on `/ws`, Drizzle schema in `src/db`,
  migrations in `drizzle/` (generated, committed, applied on startup). `src/dev.ts` runs it
  headless on `./.data`; the Electron shell lives in `src/main`, bundled by `scripts/build.mjs`
  into `bundle/` (generated, untracked) for electron-builder.
- `apps/web` — Vite + React SPA with four surfaces: `/admin`, `/order`, `/kitchen`, `/pair`.
  Built once and served by the server, so the Electron window and every tablet get the
  same files.

## Commands

Every command, port, data location and environment variable is in the Development
section of [README.md](README.md). Read it before running anything.

## Rules

- Money is integer cents. Tax is basis points. Orders snapshot item names, prices and
  modifiers; the server prices every order from the current menu and never trusts the
  client's numbers.
- Order status moves only along `canTransition` in `apps/shared/src/orders.ts`.
- Auth principals are plain values (`admin` from the session cookie, `device` from a bearer
  token). Add new kinds there; never add a second auth path.
- Every menu mutation broadcasts `menu.updated`; every order write broadcasts the order.
- Migrations are additive. Pin `@electric-sql/pglite` exactly; its on-disk format follows
  the embedded Postgres major.
- No Binary Garden dependency on any offline path. The optional account link and support
  session are additive features.
- Scope Hono guards to paths (`.use('/orders/*', requireAuth)`). A bare `use()` on a
  sub-app mounted at the root also guards every route mounted after it;
  `test/pairing.test.ts` catches this.
- The Electron main process is bundled to CommonJS: no `import.meta` outside `src/dev.ts`.
- react-hooks v7 compiler rules are on: no `Date.now()` and no ref writes during render.
  Copy callbacks into refs inside an effect instead (see `apps/web/src/api/ws.ts`).
