"use client";

// Conversation viewer: searchable, PII-redacted, with per-message intent and
// entity annotations.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

type ConvRow = { id: string; title: string; message_count: number; updated_at: string };
type ConvDetail = {
  id: string;
  title: string;
  messages: {
    id: string; role: string; content: string; created_at: string;
    intent: string | null; intent_confidence: number | null;
    retrieval_score: number | null;
    entities: { type: string; value: string }[];
  }[];
};

function ConversationsInner() {
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [detail, setDetail] = useState<ConvDetail | null>(null);

  const load = useCallback(async (q: string) => {
    setRows(await api.get<ConvRow[]>(`/api/admin/conversations?search=${encodeURIComponent(q)}`));
  }, []);

  useEffect(() => {
    load("");
    const open = params.get("open");
    if (open) openConversation(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openConversation(id: string) {
    setDetail(await api.get<ConvDetail>(`/api/admin/conversations/${id}`));
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Conversation viewer</h2>
        <p className="text-sm text-stone-500">
          All content shown here is PII-redacted before display.
        </p>
      </header>

      <div className="flex gap-6">
        <div className="w-80 shrink-0">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              load(e.target.value);
            }}
            placeholder="Search conversations…"
            className="mb-3 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <ul className="space-y-1">
            {rows.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => openConversation(c.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    detail?.id === c.id ? "border-accent bg-white" : "border-stone-200 bg-white hover:border-stone-300"
                  }`}
                >
                  <span className="block truncate">{c.title}</span>
                  <span className="text-xs text-stone-400">
                    {c.message_count} messages · {new Date(c.updated_at).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1">
          {!detail ? (
            <p className="text-sm text-stone-400">Select a conversation.</p>
          ) : (
            <div className="space-y-3">
              {detail.messages.map((m) => (
                <div key={m.id}
                     className={`rounded-xl border p-4 ${
                       m.role === "user" ? "border-stone-300 bg-white" : "border-stone-200 bg-stone-50"
                     }`}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
                    <span className="font-medium uppercase">{m.role}</span>
                    {m.intent && (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5">
                        {m.intent} ({m.intent_confidence})
                      </span>
                    )}
                    {m.retrieval_score != null && (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5">
                        retrieval {m.retrieval_score.toFixed(2)}
                      </span>
                    )}
                    {m.entities.map((e) => (
                      <span key={`${e.type}-${e.value}`}
                            className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                        {e.type}: {e.value}
                      </span>
                    ))}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-stone-400">Loading…</p>}>
      <ConversationsInner />
    </Suspense>
  );
}
