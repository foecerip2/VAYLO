import { ClosureBanner } from '../components/Closure';
import { Badge, Button, Card, Logo } from '@vpn/ui';
import { durationLabel, formatRub } from '@vpn/shared';
import { Check, Gauge, Globe, Lock, MessagesSquare, Rocket, ShieldCheck, Smartphone, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useConfig, usePlansPublic } from '../lib/queries';

const FEATURES = [
  { icon: Zap, title: 'Высокая скорость', text: 'Современные протоколы VLESS + Reality без потерь скорости и с обходом блокировок.' },
  { icon: ShieldCheck, title: 'Без логов', text: 'Мы не храним историю посещений и IP-адреса подключений.' },
  { icon: Globe, title: 'Много локаций', text: 'Серверы в разных странах — переключайтесь одним тапом в приложении.' },
  { icon: Smartphone, title: 'Все устройства', text: 'iPhone, Android, Windows, macOS и Linux. До нескольких устройств на одну подписку.' },
  { icon: Gauge, title: 'Безлимитный трафик', text: 'Смотрите видео, играйте и работайте без ограничений по объёму.' },
  { icon: MessagesSquare, title: 'Поддержка 24/7', text: 'Отвечаем в Telegram — помогаем подключиться и решить любые вопросы.' },
];

export default function Landing() {
  const cfg = useConfig();
  const plans = usePlansPublic();
  const name = cfg.data?.brandName ?? 'VPN';
  const bot = cfg.data?.botUsername;

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo name={name} />
        <Link to="/login"><Button variant="secondary" size="sm">Войти</Button></Link>
      </header>

      <div className="mx-auto max-w-6xl px-5 pt-2"><ClosureBanner full /></div>
      <section className="mx-auto max-w-6xl px-5 pb-12 pt-8 md:pt-16">
        <div className="hero-bg relative overflow-hidden rounded-[28px] p-8 text-white shadow-glow md:p-16">
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
          <Badge className="!bg-white/20 !text-white">Быстро · Безопасно · Без логов</Badge>
          <h1 className="mt-5 max-w-2xl text-4xl font-extrabold leading-[1.1] tracking-tight md:text-6xl">Интернет без границ и слежки</h1>
          <p className="mt-4 max-w-xl text-base text-white/85 md:text-lg">Подключитесь за минуту: получите пробный период, добавьте подписку в приложение — и всё работает.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/login"><Button size="lg" className="w-full !bg-white !text-[#7c3aed] shadow-lg hover:!brightness-95 sm:w-auto" icon={<Rocket className="h-5 w-5" />}>Начать бесплатно</Button></Link>
            {bot && <a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer"><Button size="lg" variant="ghost" className="w-full !bg-white/20 !text-white hover:!bg-white/30 sm:w-auto">Открыть бота</Button></a>}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <h2 className="text-center text-3xl font-bold tracking-tight">Почему выбирают нас</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary"><f.icon className="h-6 w-6" /></div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>

      {plans.data && plans.data.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-10">
          <h2 className="text-center text-3xl font-bold tracking-tight">Тарифы</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.data.map((p) => (
              <Card key={p.id} className="flex flex-col gap-3 p-6">
                <div className="flex items-center justify-between"><div className="font-semibold">{p.name}</div>{p.badge && <Badge tone="primary">{p.badge}</Badge>}</div>
                <div className="text-3xl font-bold">{formatRub(p.price)}</div>
                <div className="text-sm text-muted">{durationLabel(p.durationDays)}</div>
                <ul className="mt-1 space-y-1.5 text-sm text-muted">
                  <li className="flex gap-2"><Check className="h-4 w-4 text-success" />{p.trafficLimitGb ? `${p.trafficLimitGb} ГБ` : 'Безлимит'}</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 text-success" />{p.deviceLimit ? `До ${p.deviceLimit} устройств` : "Без ограничений по устройствам"}</li>
                </ul>
                <Link to="/login" className="mt-auto"><Button full variant="secondary">Выбрать</Button></Link>
              </Card>
            ))}
          </div>
        </section>
      )}

      <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-10 text-sm text-muted sm:flex-row">
        <div className="flex items-center gap-2"><Lock className="h-4 w-4" /> © {new Date().getFullYear()} {name}</div>
        <div className="flex gap-5">
          {cfg.data?.supportUrl && <a href={cfg.data.supportUrl} className="hover:text-fg">Поддержка</a>}
          {cfg.data?.termsUrl && <a href={cfg.data.termsUrl} className="hover:text-fg">Условия</a>}
        </div>
      </footer>
    </div>
  );
}
