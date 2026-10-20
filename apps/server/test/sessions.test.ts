import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { Sessions } from '../src/server/auth';

const dir = await mkdtemp(join(tmpdir(), 'torta-sessions-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

test('a sessions file keeps sessions across instances', () => {
  const file = join(dir, 'sessions.json');
  const first = new Sessions(file);
  const kept = first.create();
  const dropped = first.create();
  first.delete(dropped);

  const second = new Sessions(file);
  expect(second.has(kept)).toBe(true);
  expect(second.has(dropped)).toBe(false);
});

test('without a file, sessions live in memory only', () => {
  const id = new Sessions().create();
  expect(new Sessions().has(id)).toBe(false);
});
