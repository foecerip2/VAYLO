import { ReactNode, useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import type { ChatSummary, Message } from "../data/types";

export function Button({ variant = "primary", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button {...p} className={`btn ${variant === "primary" ? "" : variant} ${p.className ?? ""}`} />;
}

export function TextField({ label, error, id, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const eid = `${id}-err`;
  return (
    <div className={`field ${error ? "error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={error ? eid : undefined} {...p} />
      {error && <span id={eid} className="err" role="alert">{error}</span>}
    </div>
  );
}

// Avatar colours: fixed palette, white text passes AA on every entry.
const PALETTE = ["#0b6e6e", "#7a3fb0", "#b0412f", "#2f5bb0", "#8a5a00", "#a8325e", "#3b6e1f", "#555d8a"];
export function Avatar({ name, size = 52, online }: { name: string; size?: number; online?: boolean }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="avatar" style={{ ["--av" as string]: `${size}px`, background: PALETTE[h % PALETTE.length] }} aria-hidden="true">
      {name.trim().slice(0, 1).toUpperCase() || "?"}
      {online && <span className="dot" />}
    </span>
  );
}

export function TopBar({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack && <button className="btn ghost icon" onClick={onBack} aria-label="Назад"><ArrowLeft size={22} /></button>}
      <div className="title ellipsis" style={{ paddingLeft: onBack ? 0 : "var(--space-2)" }}>
        {title}
        {subtitle && <small>{subtitle}</small>}
      </div>
      {right}
    </header>
  );
}

export const formatTime = (t: number, now = Date.now()) => {
  const d = new Date(t);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
};

export function ChatRow({ chat, onOpen, mine }: { chat: ChatSummary; onOpen: () => void; mine: string | undefined }) {
  const last = chat.lastMessage;
  const preview = chat.typing ? "печатает…" : last ? (last.deleted ? "Сообщение удалено" : (last.senderId === mine ? "Вы: " : "") + last.body) : "Сообщений пока нет";
  return (
    <button className={`row ${chat.unread ? "unread" : ""}`} onClick={onOpen}
      aria-label={`${chat.title}${chat.unread ? `, непрочитанных: ${chat.unread}` : ""}. ${preview}`}>
      <Avatar name={chat.title} online={chat.online} />
      <span className="main">
        <span className="top"><span className="name ellipsis">{chat.title}</span>{last && <span className="time">{formatTime(last.sentAt)}</span>}</span>
        <span className="bottom">
          <span className="preview ellipsis">{preview}</span>
          {chat.unread > 0 && <span className={`badge ${chat.muted ? "muted" : ""}`}>{chat.unread > 99 ? "99+" : chat.unread}</span>}
        </span>
      </span>
    </button>
  );
}

const STATUS: Record<Message["status"], string> = { sending: "отправляется", sent: "отправлено", delivered: "доставлено", read: "прочитано", failed: "не отправлено" };

export function Bubble({ m, mine, who, onRetry }: { m: Message; mine: boolean; who?: string; onRetry?: () => void }) {
  return (
    <div className={`bubble ${mine ? "out" : "in"} ${m.status === "failed" ? "failed" : ""}`}>
      {who && !mine && <div className="who">{who}</div>}
      {m.deleted ? <em>Сообщение удалено</em> : m.body}
      <div className="meta">
        {formatTime(m.sentAt)}{m.editedAt ? " · изменено" : ""}
        {mine && <span> · <span className="sr">{STATUS[m.status]}</span><span aria-hidden="true">{m.status === "failed" ? "!" : m.status === "sending" ? "…" : m.status === "sent" ? "✓" : "✓✓"}</span></span>}
        {m.status === "failed" && onRetry && <> <button className="btn ghost" style={{ minHeight: 24, padding: 0, color: "inherit", textDecoration: "underline" }} onClick={onRetry}>Повторить</button></>}
      </div>
    </div>
  );
}

export function Snackbar({ text, onClose }: { text: string; onClose: () => void }) {
  const t = useRef<number>();
  useEffect(() => { t.current = window.setTimeout(onClose, 4000); return () => clearTimeout(t.current); }, [text, onClose]);
  return <div className="snack" role="status"><span>{text}</span><button className="btn ghost" style={{ color: "inherit" }} onClick={onClose}>Закрыть</button></div>;
}
