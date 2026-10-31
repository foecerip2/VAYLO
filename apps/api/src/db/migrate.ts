import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './index.js';

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'migrations'), join(here, '../../migrations'), join(here, '../migrations')];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Папка migrations не найдена');
  return found;
}

/** Применяет *.sql по порядку. Безопасно вызывать при каждом старте (advisory lock + таблица учёта). */
export async function migrate(log: (m: string) => void = () => {}): Promise<string[]> {
  const db = sql();
  const applied: string[] = [];
  await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274)`;
    await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await tx`select name from schema_migrations`).map((r) => r.name as string));
    const dir = migrationsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      log(`миграция ${f}`);
      await tx.unsafe(readFileSync(join(dir, f), 'utf8'));
      await tx`insert into schema_migrations (name) values (${f})`;
      applied.push(f);
    }
  });
  return applied;
}
