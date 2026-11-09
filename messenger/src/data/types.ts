export type ChatType = "direct" | "group" | "channel";
export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface User {
  id: string;
  phone: string;
  name: string;
}

export interface Message {
  id: string;
  chatId: string;
  seq: number;
  senderId: string;
  clientMsgId: string;
  body: string;
  sentAt: number;
  editedAt?: number;
  deleted?: boolean;
  status: MessageStatus;
}

export interface ChatSummary {
  id: string;
  type: ChatType;
  title: string;
  lastMessage?: Message;
  unread: number;
  pinned: boolean;
  muted: boolean;
  typing: boolean;
  online: boolean;
}

/** Same signatures the real backend (replica-backend) will implement. Screens only import this. */
export interface Api {
  requestCode(phone: string): Promise<void>;
  verifyCode(phone: string, code: string): Promise<{ user: User; needsProfile: boolean }>;
  updateProfile(name: string): Promise<User>;
  me(): User | null;
  listChats(): Promise<ChatSummary[]>;
  listMessages(chatId: string, beforeSeq?: number, limit?: number): Promise<Message[]>;
  sendMessage(chatId: string, clientMsgId: string, body: string): Promise<Message>;
  markRead(chatId: string, seq: number): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export class ApiError extends Error {
  constructor(public code: "invalid_phone" | "wrong_code" | "too_many_attempts" | "offline" | "empty", message: string) {
    super(message);
  }
}
