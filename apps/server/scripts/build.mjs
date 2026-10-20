// Generates bundle/, the root folder of the packaged desktop app: electron-builder
// packages exactly this folder (directories.app in electron-builder.yml). It
// holds the Electron main process bundled into main.js, a copy of PGlite, and a
// generated package.json. Everything else (Hono, Drizzle, ws, electron-updater)
// is inlined into main.js. PGlite stays a real package because it loads its
// WebAssembly relative to its own file. The folder is build output: never
// edited, never tracked, rebuilt from scratch every time.
import { build } from 'esbuild';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'bundle');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The packaged app's manifest. `name` must stay "torta": Electron derives the
// user data folder from it, and that is where every owner's database lives.
const server = readJson(join(root, 'package.json'));
const workspace = readJson(join(root, '../../package.json'));
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'torta',
      productName: 'torta',
      version: server.version,
      description: workspace.description,
      author: workspace.author,
      license: workspace.license,
      main: 'main.js',
      private: true,
      // The only package main.js loads at runtime. Listing it keeps
      // electron-builder from falling back to apps/server's dependencies,
      // which are already bundled into main.js.
      dependencies: {
        '@electric-sql/pglite': server.dependencies['@electric-sql/pglite'],
      },
    },
    null,
    2
  ) + '\n'
);

// PGlite's exports map hides its package.json from require.resolve, so follow
// the pnpm symlink to find the package directory instead.
const pgliteDir = realpathSync(
  join(root, 'node_modules', '@electric-sql', 'pglite')
);
const target = join(out, 'node_modules', '@electric-sql', 'pglite');
mkdirSync(target, { recursive: true });
cpSync(join(pgliteDir, 'package.json'), join(target, 'package.json'));
cpSync(join(pgliteDir, 'dist'), join(target, 'dist'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/main/index.ts')],
  outfile: join(out, 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  external: [
    'electron',
    '@electric-sql/pglite',
    'bufferutil',
    'utf-8-validate',
  ],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});
