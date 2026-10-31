import { Button, Card, CopyField, ErrorState, Sheet, Skeleton, useToast } from '@vpn/ui';
import { Check, ChevronLeft, Download, ExternalLink, QrCode, RefreshCw, ArrowUpRight } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { CLIENT_APP_NAMES, CLIENT_APP_STATUS } from '@vpn/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/Layout';
import { post, errorText } from '../lib/api';
import { clientsFor, detectOS, importUrl, OS_LABEL, type OS } from '../lib/clients';
import { useSubscription, useConfig } from '../lib/queries';
import { confirmDialog, haptic, openExternal } from '../lib/tg';

export default function Connect() {
  const [params]=useSearchParams(); const cfg=useConfig();
  const sub = useSubscription(); const qc = useQueryClient(); const toast = useToast();
  const [os, setOs] = useState<OS>(()=>Object.keys(OS_LABEL).includes(params.get('os')??'')?params.get('os') as OS:detectOS()); const [clientId, setClientId] = useState(params.get('client')??'');
  const [step, setStep] = useState(1); const [qr, setQr] = useState(false); const [busy, setBusy] = useState(false);
  const policies=cfg.data?.clientApps??[];const policy=(id:string)=>policies.find(e=>e.id===id&&e.os===os);
  const clients = [...clientsFor(os)].sort((a,b)=>Number(Boolean(policy(b.id)?.recommended))-Number(Boolean(policy(a.id)?.recommended))); const client = clients.find(c => c.id === clientId) ?? clients.find(c=>policy(c.id)?.status!=='removed') ?? clients[0]!;
  if (sub.isLoading) return <Skeleton className="h-96 w-full" />;
  if (sub.isError) return <ErrorState message={errorText(sub.error)} onRetry={() => void sub.refetch()} />;
  const s = sub.data;
  if (!s?.subUrl || ['none', 'expired'].includes(s.state)) return <div className="space-y-5"><PageHeader title="Подключение" /><Card className="space-y-4 p-6"><h2 className="text-xl font-bold">{s?.state === 'expired' ? 'Продлите доступ' : 'Сначала выберите подписку'}</h2><p className="text-sm text-muted">После активации здесь появится мастер подключения для вашего устройства.</p><Link to="/plans"><Button className="mt-3" full>Выбрать тариф</Button></Link></Card></div>;
  const url = s.subUrl;
  async function reset() {
    if (!await confirmDialog('Старая ссылка перестанет работать на всех устройствах. Продолжить?')) return;
    setBusy(true);
    try { await post('/subscription/reset-link'); await qc.invalidateQueries({ queryKey: ['subscription'] }); setStep(2); toast('Ссылка обновлена. Добавьте её в клиент заново.', 'success'); } catch(e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  }
  function next(n: number) { haptic('light'); setStep(n); }
  return <div className="mx-auto max-w-2xl space-y-5">
    <PageHeader title="На связи за три шага" subtitle="Установите клиент. Добавьте подписку. Включите VPN." />
    {os === 'ios' && policy('karing')?.status!=='removed' && !policies.some(e=>e.os==='ios'&&(e.status!=='unknown'||e.recommended)) && <Card className="space-y-3 p-5"><h2 className="text-lg font-bold">Happ или Incy не обновляют подписку?</h2><p className="text-sm leading-relaxed text-muted">Можно подключиться через Karing для iPhone. Если ошибка повторяется, отправьте её текст в поддержку — причина может быть в доступности ссылки подписки.</p><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>openExternal('https://apps.apple.com/app/karing/id6472431552')}>Скачать Karing</Button><Button onClick={()=>{setClientId('karing');setStep(2);}}>Добавить в Karing</Button></div><p className="text-xs leading-relaxed text-muted">При лимите устройств включите передачу X-HWID в настройках подписки Karing. Импортируйте ссылку подписки, чтобы локации могли обновляться.</p></Card>}
    <div className="orbit-segment" aria-label="Устройство">{(Object.keys(OS_LABEL) as OS[]).map(o => <button key={o} aria-pressed={os === o} onClick={() => {setOs(o); setClientId(''); setStep(1);}}>{OS_LABEL[o]}</button>)}</div>
    <div className="flex items-center gap-2" aria-label="Шаги подключения">{['Клиент', 'Подписка', 'Подключение'].map((name, i) => <button className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-3 text-xs font-bold sm:flex-row ${step === i + 1 ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted'}`} key={name} onClick={() => next(i+1)} aria-current={step === i + 1 ? 'step' : undefined}>{step > i + 1 ? <Check className="h-3 w-3" /> : i+1}<span>{name}</span></button>)}</div>
    {policies.some(e=>e.os===os&&(e.status!=='unknown'||e.recommended))&&<Card className="space-y-3 p-5"><h2 className="font-bold">Приложения для {OS_LABEL[os]}</h2><p className="text-xs text-muted">По информации администрации. Доступность магазина может зависеть от региона аккаунта.</p>{policies.filter(e=>e.os===os&&(e.status!=='unknown'||e.recommended)).map(e=><div key={e.id} className="text-sm"><b>{CLIENT_APP_NAMES[e.id]}</b> · {CLIENT_APP_STATUS[e.status]}{e.recommended?' · Рекомендуем':''}{e.note&&<p className="mt-1 break-words text-xs text-muted">{e.note}</p>}</div>)}<p className="text-xs text-muted">Сохраните установленное приложение и ссылку подписки. При переходе в другой клиент добавьте прежнюю ссылку — повторная покупка не нужна.</p></Card>}
    <section key={`${step}:${os}`} className="orbit-step">
      <div className="orbit-step-num">0{step}</div>
      {step === 1 ? <>
        <div className="orbit-kicker mb-2">Клиент для {OS_LABEL[os]}</div><h2>Ваше приложение — {client.name}</h2><p className="mb-6 text-sm leading-relaxed text-muted">{policy(client.id)?.status==='removed'?'По информации администрации, приложение недоступно в магазине. Если оно уже установлено, можно попробовать добавить подписку или выбрать другой клиент.':(policy(client.id)?.note||client.note||'Приложение устанавливает VPN-соединение на вашем устройстве.')} Подписка VAYLO добавится на следующем шаге.</p>
        <button className="orbit-cta" disabled={policy(client.id)?.status==='removed'} onClick={() => client.store[os] && openExternal(client.store[os]!)}><Download className="h-5 w-5" />Скачать {client.name}<ExternalLink className="h-4 w-4" /></button><Button full variant="secondary" className="mt-3" onClick={() => next(2)}>Приложение уже установлено →</Button>
        <details className="mt-5 text-sm"><summary className="cursor-pointer text-muted">Выбрать другое приложение</summary><div className="orbit-segment mt-3">{clients.map(c => <button key={c.id} aria-pressed={c.id === client.id} onClick={() => setClientId(c.id)}>{c.name}</button>)}</div></details>
      </> : step === 2 ? <>
        <div className="orbit-kicker mb-2">Импорт в {client.name}</div><h2>Добавьте вашу подписку</h2><p className="mb-6 text-sm leading-relaxed text-muted">Нажмите кнопку и разрешите открыть {client.name}. Подтвердите добавление подписки в приложении.</p><button className="orbit-cta" onClick={() => {haptic('light'); openExternal(importUrl(client.id, url));}}>Добавить в {client.name}<ArrowUpRight className="h-5 w-5" /></button><Button full variant="secondary" className="mt-3" onClick={() => next(3)}>Подписка добавлена →</Button><p className="mt-4 text-xs leading-relaxed text-muted">Если клиент не открылся, используйте ссылку или QR-код ниже. Не передавайте личную ссылку другим людям.</p>
      </> : <>
        <div className="orbit-kicker mb-2">Последний шаг</div><h2>Включите VPN в {client.name}</h2><ol className="mb-6 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-muted"><li>Обновите подписку и выберите сервер.</li><li>Нажмите кнопку подключения в {client.name}.</li><li>Разрешите создание VPN-соединения, если устройство попросит.</li></ol><div className="orbit-help"><b className="text-sm">Всё готово к подключению</b><p className="mt-2 text-xs leading-relaxed text-muted">Этот кабинет управляет подпиской. Состояние VPN смотрите в приложении {client.name}.</p></div><Link to="/help" className="mt-5 block text-center text-sm font-bold text-primary">Не подключается? Поможем →</Link>
      </>}
      {step > 1 && <button className="mt-6 flex items-center gap-1 text-xs text-muted" onClick={() => next(step-1)}><ChevronLeft className="h-4 w-4" />Назад</button>}
    </section>
    <details className="card p-5"><summary className="cursor-pointer text-sm font-bold">Ссылка, QR-код и дополнительные настройки</summary><div className="mt-4 space-y-4"><CopyField value={url} /><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => setQr(true)} icon={<QrCode className="h-4 w-4" />}>QR-код</Button><Button size="sm" variant="secondary" onClick={() => openExternal(url)}>Страница подписки</Button><Button size="sm" variant="ghost" loading={busy} onClick={() => void reset()} icon={<RefreshCw className="h-4 w-4" />}>Обновить ссылку</Button></div><p className="text-xs leading-relaxed text-muted">Раздельная маршрутизация настраивается в клиенте: нужные сайты через VPN, остальные напрямую.</p></div></details>
    <Sheet open={qr} onClose={() => setQr(false)} title="QR-код подписки"><div className="mx-auto w-fit rounded-2xl bg-white p-4"><QRCodeSVG value={url} size={232} /></div><p className="mt-4 text-center text-xs text-muted">Личная ссылка. Не публикуйте этот код.</p></Sheet>
  </div>;
}
