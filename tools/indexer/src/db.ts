import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new Pool({ connectionString });
  }

  return new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'authord',
    password: process.env.PGPASSWORD || 'authord',
    database: process.env.PGDATABASE || 'authord',
  });
}

export async function runMigrations(pool: Pool, migrationsDir?: string): Promise<void> {
  const resolvedDir = migrationsDir ?? path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(resolvedDir)) return;
  const entries = fs.readdirSync(resolvedDir).filter((file) => file.endsWith('.sql')).sort();
  if (entries.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const entry of entries) {
      const sqlPath = path.join(resolvedDir, entry);
      const sql = await fs.promises.readFile(sqlPath, 'utf8');
      if (!sql.trim()) continue;
      await client.query(sql);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
