import { Button, Switch, useToast } from '@vpn/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plug, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, post, put } from '../lib/api';
import { Section } from './kit';

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4 py-1"><div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div><Switch checked={checked} onChange={onChange} label={label} /></div>;
}

/** Форма одной группы настроек с сохранением и кнопкой «Проверить» */
export function GroupForm({ group, data, title, description, right, children, testTarget, testLabel, locked, invalid }: { group: string; data: any; title: string; description?: string; right?: ReactNode; children: (v: any, set: (k: string, val: unknown) => void) => ReactNode; testTarget?: 'yookassa' | 'platega' | 'rollypay' | 'remnawave'; testLabel?: string; locked?: boolean; invalid?: (v: any) => boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState<any>(data);
  const [dirty, setDirty] = useState(false);
  const [testRes, setTestRes] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!dirty) setV(data); }, [data, dirty]);
  const set = (k: string, val: unknown) => { setV((p: any) => ({ ...p, [k]: val })); setDirty(true); setTestRes(null); };
  const save = useMutation({
    mutationFn: () => put(`/settings/${group}`, v),
    onSuccess: () => { setDirty(false); void qc.invalidateQueries({ queryKey: ['settings'] }); toast('Настройки сохранены', 'success'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const test = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; version?: string; squadName?: string; squadUuid?: string }>(`/settings/test/${testTarget}`),
    onSuccess: (r) => setTestRes({
      ok: r.ok,
      text: r.ok
        ? 'Подключение работает' + (r.version ? ` (Remnawave ${r.version})` : '') + (r.squadName ? `. Группа для новых пользователей: «${r.squadName}»` : '')
        // панель ответила, но есть проблема с группой (сквадом) — показываем её отдельно от «нет связи»
        : (r.version || r.squadUuid ? 'Панель отвечает, но есть проблема: ' : '') + (r.error ?? 'Не удалось подключиться'),
    }),
    onError: (e) => setTestRes({ ok: false, text: errMsg(e) }),
  });
  return (
    <Section title={title} description={description} right={right}>
      <fieldset disabled={locked} className="min-w-0 space-y-4">
        {children(v, set)}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="button" loading={save.isPending} disabled={!dirty || locked || Boolean(invalid?.(v))} onClick={() => save.mutate()}>Сохранить</Button>
          {testTarget && <Button type="button" variant="secondary" icon={<Plug className="h-4 w-4" />} loading={test.isPending} disabled={dirty || locked} onClick={() => test.mutate()}>{testLabel ?? 'Проверить подключение'}</Button>}
          {dirty && testTarget && <span className="text-xs text-muted">Сначала сохраните изменения</span>}
          {testRes && <span className={`flex items-center gap-1.5 text-sm ${testRes.ok ? 'text-success' : 'text-danger'}`}>{testRes.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{testRes.text}</span>}
        </div>
      </fieldset>
    </Section>
  );
}

