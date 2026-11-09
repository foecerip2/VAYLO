import { Api, ApiError, ChatSummary, Message, User } from "./types";

interface FakeChat {
  id: string;
  type: ChatSummary["type"];
  title: string;
  pinned: boolean;
  muted: boolean;
  online: boolean;
  lastReadSeq: number;
  messages: Message[];
}

export const FAKE_CODE = "12345"; // development only; the real backend sends an OTP by SMS
const OTHERS: Record<string, string> = { u_anna: "Анна", u_max: "Максим", u_team: "Команда" };

export function createFakeApi(now: () => number = Date.now): Api {
  let user: User | null = null;
  let pendingPhone: string | null = null;
  let attempts = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const chats: FakeChat[] = [];
  const seed = (id: string, type: FakeChat["type"], title: string, lines: [string, string][], opts: Partial<FakeChat> = {}) => {
    const chat: FakeChat = { id, type, title, pinned: false, muted: false, online: false, lastReadSeq: 0, messages: [], ...opts };
    lines.forEach(([sender, body], i) =>
      chat.messages.push({
        id: `${id}_${i + 1}`, chatId: id, seq: i + 1, senderId: sender, clientMsgId: `seed_${id}_${i}`,
        body, sentAt: now() - (lines.length - i) * 3_600_000, status: "delivered",
      }),
    );
    chats.push(chat);
  };
  seed("c_anna", "direct", "Анна", [["u_anna", "Привет! Ты видел новые макеты?"], ["u_anna", "Скинь, когда посмотришь"]], { online: true });
  seed("c_team", "group", "Команда", [["u_max", "Созвон в пять"], ["u_anna", "Буду"], ["u_max", "Отлично, до связи"]], { pinned: true });
  seed("c_max", "direct", "Максим", [["u_max", "Спасибо за помощь вчера"]], { muted: true });
  seed("c_empty", "direct", "Новый чат", []);

  const find = (id: string) => {
    const c = chats.find((x) => x.id === id);
    if (!c) throw new Error("chat not found: " + id);
    return c;
  };

  return {
    async requestCode(phone) {
      if (!/^\+\d{10,15}$/.test(phone)) throw new ApiError("invalid_phone", "Введите номер в международном формате");
      pendingPhone = phone;
      attempts = 0;
    },
    async verifyCode(phone, code) {
      if (phone !== pendingPhone) throw new ApiError("invalid_phone", "Сначала запросите код");
      if (attempts >= 5) throw new ApiError("too_many_attempts", "Слишком много попыток");
      attempts++;
      if (code !== FAKE_CODE) throw new ApiError("wrong_code", "Неверный код");
      const isNew = user?.phone !== phone;
      user = user?.phone === phone ? user : { id: "u_me", phone, name: "" };
      return { user, needsProfile: isNew && !user.name };
    },
    async updateProfile(name) {
      if (!user) throw new Error("not signed in");
      const trimmed = name.trim();
      if (!trimmed) throw new ApiError("empty", "Введите имя");
      user = { ...user, name: trimmed };
      return user;
    },
    me: () => user,
    async listChats() {
      const rows = chats.map<ChatSummary>((c) => {
        const last = c.messages[c.messages.length - 1];
        return {
          id: c.id, type: c.type, title: c.title, lastMessage: last,
          unread: c.messages.filter((m) => m.seq > c.lastReadSeq && m.senderId !== user?.id).length,
          pinned: c.pinned, muted: c.muted, typing: false, online: c.online,
        };
      });
      return rows.sort((a, b) =>
        Number(b.pinned) - Number(a.pinned) || (b.lastMessage?.sentAt ?? 0) - (a.lastMessage?.sentAt ?? 0));
    },
    async listMessages(chatId, beforeSeq, limit = 50) {
      const all = find(chatId).messages.filter((m) => beforeSeq === undefined || m.seq < beforeSeq);
      return all.slice(-limit);
    },
    async sendMessage(chatId, clientMsgId, body) {
      if (!user) throw new Error("not signed in");
      const text = body.trim();
      if (!text) throw new ApiError("empty", "Пустое сообщение");
      if (text.length > 4096) throw new Error("message too long");
      const chat = find(chatId);
      const dup = chat.messages.find((m) => m.senderId === user!.id && m.clientMsgId === clientMsgId);
      if (dup) return dup; // retries never duplicate
      const msg: Message = {
        id: `${chatId}_${chat.messages.length + 1}`, chatId, seq: chat.messages.length + 1, senderId: user.id,
        clientMsgId, body: text, sentAt: now(), status: "sent",
      };
      chat.messages.push(msg);
      chat.lastReadSeq = msg.seq;
      emit();
      setTimeout(() => { msg.status = "delivered"; emit(); }, 400);
      return msg;
    },
    async markRead(chatId, seq) {
      const chat = find(chatId);
      if (seq <= chat.lastReadSeq) return; // only moves forward; no change, no event
      chat.lastReadSeq = seq;
      emit();
    },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  };
}

export const senderName = (id: string, me: User | null) => (me && id === me.id ? me.name || "Вы" : OTHERS[id] ?? "Участник");
