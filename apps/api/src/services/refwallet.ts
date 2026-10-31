import { formatRub, type WithdrawalDTO } from '@vpn/shared';
import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { badRequest, conflict, escapeHtml, forbidden, notFound } from '../lib/errors.js';
import { alertAdmins } from './alerts.js';
import { notifyUser, openAppButton } from './notify.js';
import { getSettings } from './settings.js';

export async function setReferralMode(user: UserRow, mode: 'days' | 'balance'): Promise<void> {
  const cfg = await getSettings('referral');
  if (!cfg.choice_enabled) throw conflict('Выбор награды сейчас отключён', 'choice_disabled');
  await sql()`update users set referral_mode = ${mode} where id = ${user.id}`;
}

/** Перевод реферального счёта на основной баланс (для оплаты подписки) с бонусом из настроек. */
export async function transferRefToBalance(user: UserRow, amount?: number): Promise<{ moved: number; bonus: number; balance: number; refBalance: number }> {
  const cfg = await getSettings('withdraw');
  return sql().begin(async (tx) => {
    const [u] = await tx<UserRow[]>`select * from users where id = ${user.id} for update`;
    if (!u) throw notFound();
    if (u.status === 'banned') throw forbidden('Аккаунт заблокирован');
    const amt = amount ?? Number(u.ref_balance);
    if (!Number.isInteger(amt) || amt <= 0) throw badRequest('Нечего переводить', 'nothing_to_move');
    if (amt > Number(u.ref_balance)) throw conflict('Недостаточно средств на реферальном счёте', 'insufficient_ref_balance');
    const bonus = Math.floor((amt * cfg.transfer_bonus_percent) / 100);
    const ref = Number(u.ref_balance) - amt;
    const bal = Number(u.balance) + amt + bonus;
    await tx`update users set ref_balance = ${ref}, balance = ${bal} where id = ${u.id}`;
    await tx`insert into ref_ledger (user_id, type, amount, balance_after, note) values (${u.id}, 'transfer', ${-amt}, ${ref}, 'Перевод на основной баланс')`;
    await tx`insert into transactions (user_id, type, amount, balance_after, note) values (${u.id}, 'referral', ${amt + bonus}, ${bal}, ${'Перевод с реферального счёта' + (bonus ? ` (+${cfg.transfer_bonus_percent}% бонус)` : '')})`;
    return { moved: amt, bonus, balance: bal, refBalance: ref };
  });
}

const dto = (w: any): WithdrawalDTO => ({
  id: w.id, amount: Number(w.amount), fee: Number(w.fee), payout: Number(w.amount) - Number(w.fee), method: w.method, details: w.details,
  status: w.status, note: w.admin_note, createdAt: (w.created_at as Date).toISOString(), processedAt: w.processed_at ? (w.processed_at as Date).toISOString() : null,
});

export async function listWithdrawals(user: UserRow): Promise<WithdrawalDTO[]> {
  const rows = await sql()`select * from withdrawals where user_id = ${user.id} order by created_at desc limit 30`;
  return rows.map(dto);
}

export async function requestWithdrawal(user: UserRow, input: { amount: number; method: string; details: string }): Promise<WithdrawalDTO> {
  const cfg = await getSettings('withdraw');
  if (!cfg.enabled) throw conflict('Вывод средств сейчас недоступен', 'withdraw_disabled');
  const details = input.details.trim();
  if (details.length < 5) throw badRequest('Укажите реквизиты для выплаты (номер карты, телефон для СБП или кошелёк)', 'bad_details');
  if (input.amount < cfg.min) throw badRequest(`Минимальная сумма вывода — ${formatRub(cfg.min)}`, 'below_min');
  const w = await sql().begin(async (tx) => {
    const [u] = await tx<UserRow[]>`select * from users where id = ${user.id} for update`;
    if (!u) throw notFound();
    if (u.status === 'banned') throw forbidden('Аккаунт заблокирован');
    if (input.amount > Number(u.ref_balance)) throw conflict('Недостаточно средств на реферальном счёте', 'insufficient_ref_balance');
    const [open] = await tx`select count(*)::int as n from withdrawals where user_id = ${u.id} and status = 'pending'`;
    if ((open!.n as number) >= 3) throw conflict('У вас уже есть заявки в обработке — дождитесь выплаты', 'too_many_pending');
    const fee = Math.floor((input.amount * cfg.fee_percent) / 100);
    const left = Number(u.ref_balance) - input.amount;
    await tx`update users set ref_balance = ${left} where id = ${u.id}`;
    await tx`insert into ref_ledger (user_id, type, amount, balance_after, note) values (${u.id}, 'withdraw', ${-input.amount}, ${left}, 'Заявка на вывод')`;
    const [row] = await tx`insert into withdrawals (user_id, amount, fee, method, details) values (${u.id}, ${input.amount}, ${fee}, ${input.method.trim().slice(0, 60)}, ${details.slice(0, 300)}) returning *`;
    return row!;
  });
  const who = `${user.username ? '@' + escapeHtml(user.username) : escapeHtml(user.first_name ?? 'без имени')}${user.tg_id ? ` (tg ${user.tg_id})` : ''}`;
  void alertAdmins(`💸 <b>Заявка на вывод</b>\n${who}\nСумма: <b>${formatRub(Number(w.amount))}</b>${Number(w.fee) ? ` (комиссия ${formatRub(Number(w.fee))}, к выплате ${formatRub(Number(w.amount) - Number(w.fee))})` : ''}\nСпособ: ${escapeHtml(String(w.method))}\nРеквизиты: <code>${escapeHtml(String(w.details))}</code>\nОбработайте в админке → Выводы или в боте: Админ-меню → 💸 Выводы.`);
  return dto(w);
}

// ---------- админ ----------
export async function adminWithdrawals(status?: string) {
  const rows = await sql()`
    select w.*, u.username, u.first_name, u.tg_id from withdrawals w join users u on u.id = w.user_id
    where ${status ? sql()`w.status = ${status}` : sql()`true`} order by (w.status = 'pending') desc, w.created_at desc limit 100`;
  return rows.map((w) => ({ ...dto(w), userId: w.user_id as string, username: w.username as string | null, name: (w.first_name as string | null) ?? null, tgId: w.tg_id as number | null, processedBy: w.processed_by as string | null }));
}

export async function processWithdrawal(id: string, action: 'paid' | 'rejected', adminLabel: string, note?: string): Promise<void> {
  const done = await sql().begin(async (tx) => {
    const [w] = await tx`select * from withdrawals where id = ${id} for update`;
    if (!w) throw notFound('Заявка не найдена');
    if (w.status !== 'pending') throw conflict('Заявка уже обработана', 'already_processed');
    if (action === 'rejected') {
      const [u] = await tx`update users set ref_balance = ref_balance + ${w.amount} where id = ${w.user_id} returning ref_balance`;
      await tx`insert into ref_ledger (user_id, type, amount, balance_after, note) values (${w.user_id}, 'withdraw_refund', ${w.amount}, ${u!.ref_balance}, 'Заявка на вывод отклонена')`;
    }
    await tx`update withdrawals set status = ${action}, admin_note = ${note?.slice(0, 300) ?? null}, processed_by = ${adminLabel}, processed_at = now() where id = ${id}`;
    return w;
  });
  const amt = Number(done.amount) - Number(done.fee);
  await notifyUser(
    done.user_id,
    action === 'paid'
      ? `✅ <b>Выплата отправлена</b>\nСумма: <b>${formatRub(amt)}</b>. Спасибо, что приглашаете друзей!`
      : `↩️ <b>Заявка на вывод отклонена</b>\n${note ? escapeHtml(note) + '\n' : ''}Сумма ${formatRub(Number(done.amount))} возвращена на ваш реферальный счёт.`,
    [openAppButton('👥 Рефералы')],
  ).catch(() => {});
}
