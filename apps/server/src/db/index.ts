import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';

export type OpenDbOptions = {
  /** Directory for the database files. Omit it for an in-memory database. */
  dataDir?: string;
  migrationsFolder: string;
};

export async function openDb({ dataDir, migrationsFolder }: OpenDbOptions) {
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return db;
}

export type Db = Awaited<ReturnType<typeof openDb>>;
export { schema };
