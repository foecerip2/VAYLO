import { Link } from 'react-router-dom';
import { RadioTower } from 'lucide-react';
import { bytesToHuman, type SubscriptionDTO } from '@vpn/shared';
export function LteTraffic({ subscription: s }: { subscription?: SubscriptionDTO }) {
  if (!s?.lte && !s?.lteUnavailable) return null;
  const q = s.lte;
  const percent = q && q.limitBytes > 0 ? Math.max(0, Math.min(100, q.usedBytes / q.limitBytes * 100)) : 0;
  return <section className="signature-lte" aria-label="LTE трафик">
    <div className="signature-lte-title"><span className="signature-icon"><RadioTower /></span><div><b>Локации LTE</b><p>{q ? `${bytesToHuman(q.usedBytes)} из ${bytesToHuman(q.limitBytes)}` : 'Счётчик временно недоступен'}</p></div><Link to="/addons">Докупить ГБ →</Link></div>
    {q && <><div className="signature-lte-meter" role="progressbar" aria-label="Использовано трафика LTE" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={`${bytesToHuman(q.usedBytes)} из ${bytesToHuman(q.limitBytes)}`}><div style={{ width: `${percent}%` }} /></div><div className="signature-lte-meta"><span>Осталось {bytesToHuman(q.remainingBytes)}</span><span>База 5 ГБ · 30 дней</span></div>{q.optedOut ? <p className="mt-2 text-xs text-warning">Доступ LTE отключён администратором</p> : q.remainingBytes === 0 && <p className="mt-2 text-xs leading-relaxed text-warning">Пакет LTE израсходован. Обычные VPN-локации продолжают работать.</p>}<details><summary>О пакете LTE</summary><p>Трафик учитывается за последние 30 календарных дней. Общий VPN — безлимитный.{q.extraBytes > 0 ? ` Докуплено ${bytesToHuman(q.extraBytes)}.` : ''}</p>{q.nextExpiry && <p>Ближайшее истечение пакета: {new Date(q.nextExpiry).toLocaleDateString('ru-RU')}</p>}</details></>}
  </section>;
}
