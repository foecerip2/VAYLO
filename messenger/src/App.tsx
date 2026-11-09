import { useMemo, useState } from "react";
import { createFakeApi } from "./data/fake";
import { CodeScreen, PhoneScreen, ProfileScreen } from "./screens/Auth";
import { ChatListScreen, ConversationScreen } from "./screens/Chats";

type Route = { name: "phone" } | { name: "code"; phone: string } | { name: "profile" } | { name: "chats" } | { name: "chat"; id: string };

export default function App() {
  const api = useMemo(() => createFakeApi(), []);
  const [route, setRoute] = useState<Route>({ name: "phone" });
  return (
    <main className="app">
      {route.name === "phone" && <PhoneScreen api={api} onNext={(phone) => setRoute({ name: "code", phone })} />}
      {route.name === "code" && <CodeScreen api={api} phone={route.phone} onBack={() => setRoute({ name: "phone" })} onDone={(p) => setRoute(p ? { name: "profile" } : { name: "chats" })} />}
      {route.name === "profile" && <ProfileScreen api={api} onDone={() => setRoute({ name: "chats" })} />}
      {route.name === "chats" && <ChatListScreen api={api} onOpen={(id) => setRoute({ name: "chat", id })} />}
      {route.name === "chat" && <ConversationScreen api={api} chatId={route.id} onBack={() => setRoute({ name: "chats" })} />}
    </main>
  );
}
