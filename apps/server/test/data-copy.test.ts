import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { copyBeforeUpgrade, lastCopyAt } from '../src/main/data-copy';

async function folders() {
  const root = await mkdtemp(join(tmpdir(), 'torta-copy-'));
  return {
    dataDir: join(root, 'db'),
    copyDir: join(root, 'db-backup'),
    versionFile: join(root, 'last-version'),
  };
}

test('a new install has nothing to copy', async () => {
  const f = await folders();
  expect(await copyBeforeUpgrade({ ...f, version: '1.0.0' })).toBe(false);
  expect(existsSync(f.copyDir)).toBe(false);
  expect(await lastCopyAt(f.copyDir)).toBeNull();
  expect(await readFile(f.versionFile, 'utf8')).toBe('1.0.0');
});

test('the first launch with this feature copies the data', async () => {
  const f = await folders();
  await mkdir(f.dataDir);
  await writeFile(join(f.dataDir, 'data'), 'v1');
  expect(await copyBeforeUpgrade({ ...f, version: '1.0.0' })).toBe(true);
  expect(await readFile(join(f.copyDir, 'data'), 'utf8')).toBe('v1');
  const at = Date.parse((await lastCopyAt(f.copyDir))!);
  expect(Math.abs(Date.now() - at)).toBeLessThan(60_000);
});

test('the same version makes no copy; a new one replaces it completely', async () => {
  const f = await folders();
  await mkdir(f.dataDir);
  await writeFile(join(f.dataDir, 'data'), 'v1');
  await copyBeforeUpgrade({ ...f, version: '1.0.0' });
  await writeFile(join(f.copyDir, 'stale'), 'old');

  await writeFile(join(f.dataDir, 'data'), 'v1 later');
  expect(await copyBeforeUpgrade({ ...f, version: '1.0.0' })).toBe(false);
  expect(await readFile(join(f.copyDir, 'data'), 'utf8')).toBe('v1');

  expect(await copyBeforeUpgrade({ ...f, version: '1.1.0' })).toBe(true);
  expect(await readFile(join(f.copyDir, 'data'), 'utf8')).toBe('v1 later');
  expect(existsSync(join(f.copyDir, 'stale'))).toBe(false);
  expect(await readFile(f.versionFile, 'utf8')).toBe('1.1.0');
});
