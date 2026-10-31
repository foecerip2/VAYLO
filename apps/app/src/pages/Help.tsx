import { Button, Card, CopyField } from '@vpn/ui';
import { ArrowUpRight, LifeBuoy, MessageCircle, RefreshCw, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { DiagnoseWizard } from '../components/DiagnoseWizard';
import { ServerStatusChip } from '../components/ServerStatusChip';
import { clientsFor, detectOS, OS_LABEL, type OS } from '../lib/clients';
import { useConfig } from '../lib/queries';
import { openExternal } from '../lib/tg';

export default function Help() {
  const cfg = useConfig(); const [os, setOs] = useState<OS>(detectOS()); const [operator, setOperator] = useState('Не указан'); const [client, setClient] = useState(''); const [issue, setIssue] = useState('Не подключается');
  const selectedClient = client || clientsFor(os)[0]?.name || 'Другой';
  const steps = issue === 'Клиент не открывается' ? ['Установите выбранный клиент для вашего устройства.', 'В мастере подключения нажмите «Добавить подписку».', 'Если переход не сработал, скопируйте ссылку и импортируйте её вручную.'] : issue === 'Медленно работает' ? ['Обновите подписку в VPN-клиенте.', 'Попробуйте другую локацию из списка. Ближайшая страна не всегда даёт лучший маршрут.', 'Сравните работу через Wi-Fi и мобильную сеть. Отключите другие VPN-приложения.'] : ['Убедитесь, что подписка активна и дата на устройстве выставлена автоматически.', 'Обновите подписку в клиенте и выберите другой сервер из списка.', 'Отключите другие VPN-приложения и попробуйте Wi-Fi вместо мобильной сети или наоборот.'];
  const diagnostic = `Устройство: ${OS_LABEL[os]}\nКлиент: ${selectedClient}\nОператор: ${operator}\nПроблема: ${issue}`;
  return <div className="mx-auto max-w-2xl space-y-6"><PageHeader title="Помощь всегда рядом" subtitle="Начнём с нескольких простых шагов" />
    <ServerStatusChip />
    <DiagnoseWizard />
    <Link to="/connect" className="orbit-row"><Smartphone /><div><b>Подключить устройство</b><p className="mt-1 text-xs text-muted">Мастер установки и импорта подписки</p></div><ArrowUpRight className="arrow" /></Link>
    <Card className="space-y-5 p-5"><div className="flex items-center gap-3"><LifeBuoy className="h-6 w-6 text-primary" /><h2 className="text-xl font-bold tracking-tight">Что случилось?</h2></div><div className="orbit-segment">{['Не подключается', 'Медленно работает', 'Клиент не открывается'].map(x => <button key={x} aria-pressed={issue===x} onClick={() => setIssue(x)}>{x}</button>)}</div>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-muted">Устройство<select className="mt-2 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm text-fg" value={os} onChange={e => {setOs(e.target.value as OS);setClient('');}}>{Object.entries(OS_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label><label className="text-xs text-muted">VPN-клиент<select className="mt-2 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm text-fg" value={selectedClient} onChange={e => setClient(e.target.value)}>{clientsFor(os).map(c => <option key={c.id}>{c.name}</option>)}<option>Другой</option></select></label></div>
      <label className="block text-xs text-muted">Ваш оператор<select className="mt-2 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm text-fg" value={operator} onChange={e => setOperator(e.target.value)}>{['Не указан','МТС','МегаФон','Билайн','T2','Yota','Другой / Wi-Fi'].map(o => <option key={o}>{o}</option>)}</select></label>
      <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-muted">{steps.map(s => <li key={s}>{s}</li>)}</ol><p className="text-xs text-muted">У разных сетей условия подключения могут отличаться. Попробуйте резервную локацию в клиенте.</p>
    </Card>
    <div className="orbit-help"><div className="flex items-center gap-2 font-bold"><MessageCircle className="h-5 w-5 text-primary" />Не получилось? Напишите нам</div><p className="my-3 text-sm leading-relaxed text-muted">Передайте эти сведения поддержке. Личную ссылку подписки и коды доступа отправлять не нужно.</p><CopyField value={diagnostic} />{cfg.data?.supportInApp ? <Link to={`/support?diagnostic=${encodeURIComponent(diagnostic)}`}><Button full className="mt-4">Открыть поддержку</Button></Link> : cfg.data?.supportUrl ? <Button full className="mt-4" onClick={() => openExternal(cfg.data!.supportUrl!)}>Написать в поддержку</Button> : <p className="mt-4 text-sm text-muted">Контакт поддержки появится после настройки сервиса.</p>}</div>
    <Link to="/locations" className="orbit-row"><RefreshCw className="h-5 w-5" /><span className="text-sm">Посмотреть локации</span><ArrowUpRight className="arrow" /></Link>
  </div>;
}
