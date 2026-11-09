import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Api, ChatSummary, Message } from "../data/types";
import { senderName } from "../data/fake";
import { Avatar, Bubble, Button, ChatRow, Snackbar, TopBar } from "../ui";

function useLive<T>(api: Api, load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState(false);
  const run = useCallback(() => load().then((d) => { setData(d); setError(false); }).catch(() => setError(true)), deps); // eslint-disable-line
  useEffect(() => { run(); return api.subscribe(run); }, [api, run]);
  return { data, error, reload: run };
}

/** S04 */
export function ChatListScreen({ api, onOpen }: { api: Api; onOpen: (id: string) => void }) {
  const { data, error, reload } = useLive<ChatSummary[]>(api, () => api.listChats(), []);
  const me = api.me();
  return (
    <div className="screen">
      <TopBar title="Чаты" />
      {error && <div className="banner" role="alert">Нет соединения. <button className="btn ghost" style={{ minHeight: 32 }} onClick={reload}>Повторить</button></div>}
      <div className="list">
        {!data && !error && [0, 1, 2, 3].map((i) => (
          <div className="skel" key={i} aria-hidden="true"><i style={{ width: 52, height: 52, borderRadius: "50%" }} /><i style={{ flex: 1, height: 32 }} /></div>
        ))}
        {data?.length === 0 && <div className="empty"><p>Здесь появятся ваши переписки.</p></div>}
        {data?.map((c) => <ChatRow key={c.id} chat={c} mine={me?.id} onOpen={() => onOpen(c.id)} />)}
      </div>
    </div>
  );
}

/** S06 */
export function ConversationScreen({ api, chatId, onBack }: { api: Api; chatId: string; onBack: () => void }) {
  const me = api.me();
  const { data: chats } = useLive(api, () => api.listChats(), []);
  const { data: messages, error } = useLive<Message[]>(api, () => api.listMessages(chatId), [chatId]);
  const chat = chats?.find((c) => c.id === chatId);
  const [text, setText] = useState("");
  const [snack, setSnack] = useState<string>();
  const [failed, setFailed] = useState<Message[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages?.length, failed.length]);
  const lastSeq = messages?.[messages.length - 1]?.seq;
  useEffect(() => {
    if (lastSeq !== undefined) void api.markRead(chatId, lastSeq);
  }, [api, chatId, lastSeq]);

  const send = async (body: string, clientMsgId: string = crypto.randomUUID()) => {
    if (!body.trim() || !me) return;
    try { await api.sendMessage(chatId, clientMsgId, body); setFailed((f) => f.filter((m) => m.clientMsgId !== clientMsgId)); }
    catch {
      setFailed((f) => f.some((m) => m.clientMsgId === clientMsgId) ? f
        : [...f, { id: clientMsgId, chatId, seq: Number.MAX_SAFE_INTEGER, senderId: me.id, clientMsgId, body, sentAt: Date.now(), status: "failed" }]);
      setSnack("Не удалось отправить сообщение");
    }
  };
  const submit = () => { const b = text; if (!b.trim()) return; setText(""); void send(b); };
  const isGroup = chat?.type !== "direct";

  return (
    <div className="screen">
      <TopBar title={chat?.title ?? "Чат"} subtitle={chat ? (chat.typing ? "печатает…" : chat.online ? "в сети" : undefined) : undefined} onBack={onBack}
        right={chat ? <Avatar name={chat.title} size={40} online={chat.online} /> : undefined} />
      {error && <div className="banner" role="alert">Нет соединения. Сообщения будут отправлены позже.</div>}
      <div className="thread" role="log" aria-live="polite" aria-label="Сообщения">
        {messages?.length === 0 && failed.length === 0 && <div className="empty">Сообщений пока нет. Напишите первым.</div>}
        {messages?.map((m) => <Bubble key={m.id} m={m} mine={m.senderId === me?.id} who={isGroup ? senderName(m.senderId, me) : undefined} />)}
        {failed.map((m) => <Bubble key={m.id} m={m} mine onRetry={() => send(m.body, m.clientMsgId)} />)}
        <div ref={end} />
      </div>
      <div className="composer">
        <textarea rows={1} value={text} placeholder="Сообщение" aria-label="Текст сообщения" maxLength={4096}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <Button className="icon" onClick={submit} disabled={!text.trim()} aria-label="Отправить"><Send size={20} /></Button>
      </div>
      {snack && <Snackbar text={snack} onClose={() => setSnack(undefined)} />}
    </div>
  );
}
