"use client";

// Entity explorer: ranked roles/skills, role × skill co-occurrence heatmap,
// drill-down to the queries mentioning each entity.
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type EntityRow = { entity_type: string; value: string; count: number };
type Cooc = { roles: string[]; skills: string[]; matrix: number[][] };
type EntityMessage = {
  message_id: string; conversation_id: string; text: string; intent: string; created_at: string;
};

export default function EntityExplorerPage() {
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [cooc, setCooc] = useState<Cooc | null>(null);
  const [drill, setDrill] = useState<{ label: string; messages: EntityMessage[] } | null>(null);

  useEffect(() => {
    api.get<EntityRow[]>("/api/admin/entities").then(setEntities);
    api.get<Cooc>("/api/admin/entities/cooccurrence").then(setCooc);
  }, []);

  async function openEntity(type: string, value: string) {
    const messages = await api.get<EntityMessage[]>(
      `/api/admin/entities/${type}/${encodeURIComponent(value)}/messages`,
    );
    setDrill({ label: `${type}: ${value}`, messages });
  }

  const maxCell = cooc ? Math.max(1, ...cooc.matrix.flat()) : 1;
  const byType = (t: string) => entities.filter((e) => e.entity_type === t).slice(0, 12);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Entity explorer</h2>
        <p className="text-sm text-stone-500">
          Job roles, skills, and sectors people mention. Click any entity to see the queries behind it.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        {[["job_role", "Job roles"], ["skill", "Skills"], ["sector", "Sectors"]].map(([type, title]) => (
          <div key={type} className="rounded-xl border border-stone-200 bg-white p-5">
            <h3 className="mb-3 text-sm font-medium">{title}</h3>
            {byType(type).length === 0 && <p className="text-xs text-stone-400">None yet.</p>}
            <ul className="space-y-1">
              {byType(type).map((e) => (
                <li key={e.value}>
                  <button
                    onClick={() => openEntity(e.entity_type, e.value)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-stone-50"
                  >
                    <span>{e.value}</span>
                    <span className="text-xs text-stone-400">{e.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h3 className="text-sm font-medium">Role × skill co-occurrence</h3>
        <p className="mt-1 text-xs text-stone-500">
          Within the same conversation — “people asking about <em>data analyst</em> also ask about…”.
        </p>
        {!cooc || cooc.roles.length === 0 ? (
          <p className="mt-3 text-xs text-stone-400">No co-occurrences yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="p-1" />
                  {cooc.skills.map((s) => (
                    <th key={s} className="max-w-[90px] truncate p-1 text-left font-normal text-stone-500">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cooc.roles.map((r, i) => (
                  <tr key={r}>
                    <td className="whitespace-nowrap p-1 pr-3 font-medium">{r}</td>
                    {cooc.skills.map((s, j) => {
                      const v = cooc.matrix[i][j];
                      const alpha = v / maxCell;
                      return (
                        <td key={s} className="p-1">
                          <div
                            className="flex h-8 w-16 items-center justify-center rounded"
                            style={{
                              background: v ? `rgba(201,100,66,${0.15 + 0.75 * alpha})` : "#f5f5f4",
                              color: alpha > 0.5 ? "white" : "#44403c",
                            }}
                            title={`${r} × ${s}: ${v}`}
                          >
                            {v || ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drill && (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h3 className="text-sm font-medium">Queries mentioning {drill.label}</h3>
          <ul className="mt-3 divide-y divide-stone-100">
            {drill.messages.map((m) => (
              <li key={m.message_id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span>“{m.text}”</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-stone-400">
                  {m.intent}
                  <Link className="text-accent underline"
                        href={`/insights/conversations?open=${m.conversation_id}`}>
                    view chat
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
