export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export const fmtDateTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const rub = (kop: number) => (kop / 100).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₽';
export const PROVIDER_LABEL: Record<string, string> = { yookassa: 'ЮKassa', platega: 'Platega', rollypay: 'RollyPay', balance: 'Баланс', promo: 'Промокод' };
export const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  succeeded: { label: 'Оплачен', tone: 'success' },
  pending: { label: 'Ожидает', tone: 'warning' },
  canceled: { label: 'Отменён', tone: 'danger' },
  expired: { label: 'Истёк', tone: 'neutral' },
  refunded: { label: 'Возврат', tone: 'neutral' },
};
