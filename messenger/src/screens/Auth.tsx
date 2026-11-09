import { useState } from "react";
import { Api, ApiError } from "../data/types";
import { Button, TextField, TopBar } from "../ui";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Что-то пошло не так. Попробуйте ещё раз.");

/** S01 */
export function PhoneScreen({ api, onNext }: { api: Api; onNext: (phone: string) => void }) {
  const [phone, setPhone] = useState("+7");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(undefined);
    try { await api.requestCode(phone.replace(/[\s()-]/g, "")); onNext(phone.replace(/[\s()-]/g, "")); }
    catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  };
  return (
    <form className="screen pad stack" onSubmit={submit}>
      <h1>Вход по номеру телефона</h1>
      <p className="muted">Мы отправим код подтверждения. Номер увидят только ваши контакты.</p>
      <TextField id="phone" label="Номер телефона" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={err} />
      <Button type="submit" disabled={busy}>{busy ? "Отправляем…" : "Получить код"}</Button>
    </form>
  );
}

/** S02 */
export function CodeScreen({ api, phone, onBack, onDone }: { api: Api; phone: string; onBack: () => void; onDone: (needsProfile: boolean) => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(undefined);
    try { const r = await api.verifyCode(phone, code); onDone(r.needsProfile); }
    catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <TopBar title="Код подтверждения" onBack={onBack} />
      <form className="pad stack" onSubmit={submit}>
        <p className="muted">Код отправлен на {phone}.</p>
        <TextField id="code" label="Код из сообщения" inputMode="numeric" autoComplete="one-time-code" maxLength={5} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} error={err} />
        <Button type="submit" disabled={busy || code.length < 5}>{busy ? "Проверяем…" : "Продолжить"}</Button>
      </form>
    </div>
  );
}

/** S03 */
export function ProfileScreen({ api, onDone }: { api: Api; onDone: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string>();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.updateProfile(name); onDone(); } catch (x) { setErr(msg(x)); }
  };
  return (
    <form className="screen pad stack" onSubmit={submit}>
      <h1>Как вас зовут?</h1>
      <TextField id="name" label="Имя" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} error={err} />
      <Button type="submit">Готово</Button>
    </form>
  );
}
