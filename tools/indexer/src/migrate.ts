import { createPool, runMigrations } from './db';

async function main() {
  const pool = createPool();
  await runMigrations(pool);
  await pool.end();
  console.log('Migrations complete.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
