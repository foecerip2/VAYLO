import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { sql, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { clearSettingsCache, setSettings } from '../src/services/settings.js';
import { seedDefaultPlans } from '../src/services/plans.js';
import { makeInitData } from './helpers/initdata.js';
import { refundPayment } from '../src/services/payments.js';
import { monitorTick } from '../src/services/monitor.js';

const mocks = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
async function call(method: string, path: string, token: string, payload?: unknown, key?: string) {
  const r = await app.inject({ method: method as any, url: '/api/v1' + path, headers: { authorization: 'Bearer ' + token, ...(key ? {'idempotency-key': key} : {}) }, payload: payload as any });
  return {status:r.statusCode, body:r.json()};
}
async function login(id: number) { const r = await call('POST','/auth/miniapp','',{initData:makeInitData({id,first_name:'Orbit'})});return r.body.accessToken as string; }
async function setupBuyer() {
  const token = await login(1001);
  await sql()`update users set balance = 100000 where tg_id = 1001`;
  const [plan] = await sql()`select * from plans order by price limit 1`;
  return {token,plan:plan!};
}
beforeAll(async()=>{await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();app=await buildApp({logger:false});});
beforeEach(async()=>{
  await sql()`truncate users, plans, payments, settings, admins, monitor_state, monitor_events cascade`;
  clearSettingsCache();mocks.rw.state.users.clear();mocks.rw.state.calls.length=0;mocks.rw.state.fail=false;mocks.yk.state.payments.clear();mocks.yk.state.statusOverride=null;
  await seedDefaultPlans();
});
afterAll(async()=>{await app.close();await closeDb();for(const m of Object.values(mocks) as any[])m.server.close();});

describe('Orbit purchases and gifts',()=>{
  it('concurrent retries charge once and return the same payment; a changed body is rejected',async()=>{
    const {token,plan}=await setupBuyer();
    const body={planId:plan.id,method:'balance'};
    const results=await Promise.all([call('POST','/payments',token,body,'retry-orbit-123'),call('POST','/payments',token,body,'retry-orbit-123')]);
    expect(results.map(r=>r.status)).toEqual([200,200]);expect(results[0]!.body.id).toBe(results[1]!.body.id);
    const [u]=await sql()`select balance from users where tg_id=1001`;expect(u!.balance).toBe(100000-plan.price);
    const [count]=await sql()`select count(*)::int as n from payments`;expect(count!.n).toBe(1);
    expect((await call('POST','/payments',token,{...body,gift:true},'retry-orbit-123')).status).toBe(409);
  });
  it('gift is issued without granting the buyer access and can be redeemed only once',async()=>{
    const {token,plan}=await setupBuyer();const recipient=await login(1002);
    const paid=await call('POST','/payments',token,{planId:plan.id,method:'balance',gift:true},'gift-orbit-123');expect(paid.status).toBe(200);
    expect((await call('GET','/subscription',token)).body.state).toBe('none');
    const gifts=await call('GET','/gifts',token);expect(gifts.body).toHaveLength(1);const code=gifts.body[0].code;
    expect((await call('GET','/gifts',recipient)).body).toEqual([]);
    const tries=await Promise.all([call('POST','/gifts/redeem',recipient,{code}),call('POST','/gifts/redeem',recipient,{code})]);
    expect(tries.map(r=>r.status).sort()).toEqual([200,200]);
    expect((await call('GET','/subscription',recipient)).body.state).toBe('active');
    expect((await call('GET','/gifts',token)).body[0].code).toBeNull();
  });
  it('failed Remnawave redemption leaves the gift redeemable',async()=>{
    const {token,plan}=await setupBuyer();const recipient=await login(1002);
    await call('POST','/payments',token,{planId:plan.id,method:'balance',gift:true},'gift-orbit-fail');
    const code=(await call('GET','/gifts',token)).body[0].code;
    mocks.rw.state.fail=true;expect((await call('POST','/gifts/redeem',recipient,{code})).status).toBe(502);
    mocks.rw.state.fail=false;expect((await call('POST','/gifts/redeem',recipient,{code})).status).toBe(200);
  });
  it('refunded gift cannot be redeemed',async()=>{
    const {token,plan}=await setupBuyer();const recipient=await login(1002);
    const p=await call('POST','/payments',token,{planId:plan.id,method:'balance',gift:true},'gift-orbit-refund');
    const code=(await call('GET','/gifts',token)).body[0].code;await refundPayment(p.body.id);
    expect((await call('POST','/gifts/redeem',recipient,{code})).status).toBe(400);
  });
  it('provider payment issues exactly one gift after verified success',async()=>{
    const {token,plan}=await setupBuyer();await setSettings('yookassa',{enabled:true,shop_id:mocks.yk.shopId,secret_key:mocks.yk.secret});
    const p=await call('POST','/payments',token,{planId:plan.id,method:'yookassa',gift:true},'gift-orbit-provider');expect(p.status).toBe(200);
    expect((await call('GET','/gifts',token)).body).toEqual([]);
    const [row]=await sql()`select external_id from payments where id=${p.body.id}`;mocks.yk.state.statusOverride='succeeded';
    for(let i=0;i<2;i++) expect((await call('POST','/webhooks/yookassa','',{event:'payment.succeeded',object:{id:row!.external_id}})).status).toBe(200);
    expect((await call('GET','/gifts',token)).body).toHaveLength(1);
    expect((await call('GET',`/payments/${p.body.id}`,token)).body.gift).toBe(true);
  });
  it('Telegram admin login keeps nonzero session epoch',async()=>{
    const token=await login(1001);await sql()`insert into admins(email,password_hash,role,tg_id,session_epoch) values('orbit@test.dev','unused','owner',1001,7)`;
    const logged=await call('POST','/auth/admin-tg',token,{});expect(logged.status).toBe(200);
    expect((await call('GET','/admin/stats/overview',logged.body.accessToken)).status).toBe(200);
  });
  it('scheduled monitoring respects the configured interval',async()=>{
    await setSettings('monitoring',{enabled:true,alerts:false,interval_seconds:600});
    expect((await monitorTick({scheduled:true})).checked).toBeGreaterThan(0);
    expect((await monitorTick({scheduled:true})).checked).toBe(0);
    expect((await monitorTick()).checked).toBeGreaterThan(0);
  });
});
