import {previewTrialCleanup,executeTrialCleanup} from './services/trialCleanup.js';
import { closeDb, sql } from './db/index.js';
import { migrate } from './db/migrate.js';
import { hashPassword, randomToken } from './lib/crypto.js';
import { seedDefaultPlans } from './services/plans.js';

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'migrate': {
      const done = await migrate(console.log);
      console.log(done.length ? `Применено: ${done.join(', ')}` : 'Схема БД актуальна');
      break;
    }
    case 'create-admin': {
      // create-admin <email> [password] [role]
      const [email, passArg, role = 'owner'] = args;
      if (!email) throw new Error('Использование: create-admin <email> [пароль] [роль]');
      const password = passArg || randomToken(12);
      await migrate();
      await sql()`insert into admins (email, password_hash, role) values (${email.toLowerCase()}, ${await hashPassword(password)}, ${role})
        on conflict (email) do update set password_hash = excluded.password_hash, totp_enabled = false, totp_secret = null`;
      console.log(JSON.stringify({ email: email.toLowerCase(), password, role }));
      break;
    }
    case 'cleanup-trials': {
      if (args.some(a=>a!=='--apply')) throw new Error('Использование: cleanup-trials [--apply]');
      await migrate();
      const plan=await previewTrialCleanup(null);
      console.log(JSON.stringify(plan,null,2));
      if(args.includes('--apply')) {
        const result=await executeTrialCleanup(plan.id,null);
        console.log(JSON.stringify(result,null,2));
        if(result.state==='failed'||result.results.some((r:{status:string})=>r.status==='failed'))process.exitCode=1;
      }
      else console.log('Предпросмотр. Для удаления добавьте --apply. Максимум 100 пользователей за запуск.');
      break;
    }
    case 'seed-plans': {
      await migrate();
      console.log(`Создано тарифов: ${await seedDefaultPlans()}`);
      break;
    }
    default:
      console.log('Команды: cleanup-trials [--apply] | migrate | create-admin <email> [пароль] [роль] | seed-plans');
      process.exitCode = cmd ? 1 : 0;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
