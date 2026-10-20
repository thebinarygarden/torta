// Writes apps/web/dist/licenses.txt: the license text of every production
// dependency, which their licenses require us to ship alongside the code.
// Runs after `vite build`, so the headless server, Electron and the installers
// all serve it from the web build. Electron's own notices are added by
// electron-builder.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'apps/web/dist/licenses.txt');

// Through the shell, because on Windows pnpm is a .cmd shim that Node can only
// start from a shell.
const byLicense = JSON.parse(
  execSync('pnpm licenses list --prod --json', { cwd: root, encoding: 'utf8' })
);
const packages = Object.values(byLicense)
  .flat()
  .sort((a, b) => a.name.localeCompare(b.name));

const noticeFile = /^(licen[cs]e|copying|notice)/i;
const rule = '='.repeat(80);

const sections = packages.map((pkg) => {
  const dir = pkg.paths[0];
  const texts = readdirSync(dir)
    .filter((f) => noticeFile.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').trim());
  const header = `${pkg.name} ${pkg.versions.join(', ')} · ${pkg.license}`;
  const link = pkg.homepage ? `${pkg.homepage}\n` : '';
  const body = texts.length
    ? texts.join('\n\n')
    : `This package ships no license file. It declares the ${pkg.license} license.`;
  return `${rule}\n${header}\n${link}${rule}\n\n${body}\n`;
});

writeFileSync(
  out,
  `torta is free software under the GNU Affero General Public License, version 3 or
later. Its source is at https://github.com/thebinarygarden/torta.

It includes the following third-party packages, under their own licenses.

${sections.join('\n')}`
);
console.log(`notices: ${packages.length} packages → ${out}`);
