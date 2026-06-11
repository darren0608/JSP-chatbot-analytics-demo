"use client";

// JSP Assistant — chat UI with conversation sidebar, SSE streaming, citations.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Markdown from "@/components/Markdown";
import {
  api, ApiError, ChatMessage, Conversation, Source, streamChat, User,
} from "@/lib/api";

type LiveMessage = ChatMessage & { sources?: Source[]; streaming?: boolean };

export default function AssistantPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<User>("/api/auth/me")
      .then(setUser)
      .catch(() => router.push("/login"));
  }, [router]);

  const loadConversations = useCallback(() => {
    api.get<Conversation[]>("/api/conversations").then(setConversations).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) loadConversations();
  }, [user, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function openConversation(id: string) {
    setActiveId(id);
    setError("");
    const msgs = await api.get<ChatMessage[]>(`/api/conversations/${id}/messages`);
    setMessages(msgs);
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setError("");
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError("");
    setBusy(true);

    const userMsg: LiveMessage = {
      id: `tmp-u-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString(),
    };
    const draft: LiveMessage = {
      id: `tmp-a-${Date.now()}`, role: "assistant", content: "", created_at: new Date().toISOString(),
      streaming: true,
    };
    setMessages((m) => [...m, userMsg, draft]);

    try {
      await streamChat(text, activeId, (event) => {
        if (event.type === "sources") {
          setMessages((m) =>
            m.map((msg) => (msg.id === draft.id ? { ...msg, sources: event.sources } : msg)),
          );
        } else if (event.type === "token") {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === draft.id ? { ...msg, content: msg.content + event.text } : msg,
            ),
          );
        } else if (event.type === "done") {
          setActiveId(event.conversation_id);
          setMessages((m) =>
            m.map((msg) => (msg.id === draft.id ? { ...msg, streaming: false } : msg)),
          );
          loadConversations();
        }
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send message");
      setMessages((m) => m.filter((msg) => msg.id !== draft.id));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.post("/api/auth/logout");
    router.push("/login");
  }

  if (!user) return <main className="p-8 text-sm text-stone-400">Loading…</main>;

  return (
    <main className="flex h-screen">
      {/* sidebar */}
      <aside className="flex w-64 flex-col border-r border-stone-200 bg-white">
        <div className="border-b border-stone-100 p-4">
          <h1 className="font-semibold">JSP Assistant</h1>
          <p className="truncate text-xs text-stone-400">{user.email}</p>
        </div>
        <button
          onClick={newConversation}
          className="m-3 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white"
        >
          + New chat
        </button>
        <nav className="flex-1 overflow-y-auto px-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={`mb-1 w-full truncate rounded-lg px-3 py-2 text-left text-sm ${
                c.id === activeId ? "bg-stone-100 font-medium" : "hover:bg-stone-50"
              }`}
            >
              {c.title}
            </button>
          ))}
        </nav>
        <div className="border-t border-stone-100 p-3 text-sm">
          {user.role === "admin" && (
            <a href="/insights" className="block rounded-lg px-3 py-2 hover:bg-stone-50">
              📊 JSP Insights
            </a>
          )}
          <button onClick={logout} className="w-full rounded-lg px-3 py-2 text-left hover:bg-stone-50">
            Log out
          </button>
        </div>
      </aside>

      {/* chat panel */}
      <section className="flex flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
            {messages.length === 0 && (
              <div className="mt-24 text-center">
                <h2 className="text-xl font-semibold">What would you like to explore?</h2>
                <p className="mt-2 text-sm text-stone-500">
                  Ask about jobs, skills, career switches, or training. Answers are grounded in
                  ingested Jobs-Skills content and always cite their sources.
                </p>
                <div className="mx-auto mt-6 flex max-w-xl flex-wrap justify-center gap-2">
                  {[
                    "What skills do I need to become a data analyst?",
                    "How do I switch from marketing into data analytics?",
                    "What does a cybersecurity analyst do?",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-accent"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[80%] rounded-2xl bg-ink px-4 py-2.5 text-sm text-white"
                      : "max-w-[90%]"
                  }
                >
                  {m.role === "assistant" ? (
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      {m.sources && m.sources.length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {m.sources.map((s) => (
                            <a
                              key={s.source_url}
                              href={s.source_url}
                              target="_blank"
                              rel="noreferrer"
                              title={`relevance ${s.score}`}
                              className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-600 hover:bg-stone-200"
                            >
                              🔗 {s.title.replace(/^\[FIXTURE\]\s*/, "")}
                            </a>
                          ))}
                        </div>
                      )}
                      <Markdown text={m.content || (m.streaming ? "…" : "")} />
                    </div>
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-stone-200 bg-white p-4">
          <div className="mx-auto max-w-3xl">
            {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask about jobs, skills, careers, or training…"
                className="flex-1 resize-none rounded-xl border border-stone-300 px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="rounded-xl bg-accent px-5 text-sm font-medium text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-stone-400">
              Answers come only from cited sources. Please don&apos;t share personal identifiers.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
