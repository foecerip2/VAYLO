import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { installProcessGuards } from './lib/guards.js';
import { seedDefaultPlans } from './services/plans.js';

async function main() {
  installProcessGuards('api');
  const cfg = config();
  const applied = await migrate((m) => console.log('[db]', m));
  if (applied.length) console.log(`[db] применено миграций: ${applied.length}`);
  const seeded = await seedDefaultPlans();
  if (seeded) console.log(`[db] созданы стартовые тарифы: ${seeded}`);

  const app = await buildApp();
  await app.listen({ port: cfg.PORT, host: cfg.HOST });

  const stop = async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop().catch((e) => console.error(e)));
  process.on('SIGINT', () => void stop().catch((e) => console.error(e)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
