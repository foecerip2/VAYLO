import postgres from 'postgres';
import { config } from '../config.js';

export type Sql = postgres.Sql<any>;
export type TxSql = postgres.TransactionSql<any>;

let _sql: Sql | null = null;

export function sql(): Sql {
  if (!_sql) {
    _sql = postgres(config().DATABASE_URL, {
      max: 20,
      onnotice: () => {},
      types: {
        bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      },
    });
  }
  return _sql;
}

export async function closeDb() {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}
