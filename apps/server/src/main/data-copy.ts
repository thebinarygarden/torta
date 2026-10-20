import { cp, readFile, rm, stat, writeFile } from 'node:fs/promises';

/**
 * When the copy was made, or null if there is none. The folder is recreated by
 * each copy and nothing writes to it after, so its time is the copy's.
 */
export const lastCopyAt = (copyDir: string) =>
  stat(copyDir).then(
    (s) => s.mtime.toISOString(),
    () => null
  );

/**
 * The first time a new version starts, copy the database aside before it is
 * opened, replacing the previous copy. Nothing has the database open yet, so
 * the copy is consistent. It is a just-in-case: migrations already run in one
 * transaction. Returns whether a copy was made.
 */
export async function copyBeforeUpgrade(opts: {
  dataDir: string;
  copyDir: string;
  versionFile: string;
  version: string;
}) {
  const last = await readFile(opts.versionFile, 'utf8').catch(() => null);
  if (last?.trim() === opts.version) return false;
  const hasData = await stat(opts.dataDir).then(
    () => true,
    () => false
  );
  if (hasData) {
    await rm(opts.copyDir, { recursive: true, force: true });
    await cp(opts.dataDir, opts.copyDir, { recursive: true });
  }
  await writeFile(opts.versionFile, opts.version);
  return hasData;
}
