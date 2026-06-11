"use client";

// Intent explorer: 2D scatter of query embeddings coloured by cluster, cluster
// cards, drill-down to the real (PII-redacted) chats, promote-to-taxonomy.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, Cell,
} from "recharts";
import { api } from "@/lib/api";

const COLORS = ["#c96442", "#3d7a6e", "#5b6abf", "#b08c2e", "#9c4f7c", "#557a2e", "#856a5d", "#2e8ab0"];

type Point = {
  message_id: string; x: number; y: number; text: string; intent: string;
  cluster: { id: string; label: string } | null;
};
type ClusterInfo = { id: string; label: string; summary: string; size: number; pct_of_total: number };
type ClusterMessages = {
  cluster: ClusterInfo;
  messages: { message_id: string; conversation_id: string; text: string; intent: string; distance: number }[];
};

export default function IntentExplorerPage() {
  const [points, setPoints] = useState<Point[]>([]);
  const [clusters, setClusters] = useState<ClusterInfo[]>([]);
  const [selected, setSelected] = useState<ClusterMessages | null>(null);
  const [promoteLabel, setPromoteLabel] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [proj, cl] = await Promise.all([
      api.get<{ points: Point[] }>("/api/admin/projection"),
      api.get<{ clusters: ClusterInfo[] }>("/api/admin/clusters"),
    ]);
    setPoints(proj.points);
    setClusters(cl.clusters);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clusterIds = clusters.map((c) => c.id);
  const colorOf = (p: Point) =>
    p.cluster ? COLORS[clusterIds.indexOf(p.cluster.id) % COLORS.length] : "#d6d3d1";

  async function openCluster(id: string) {
    setSelected(await api.get<ClusterMessages>(`/api/admin/clusters/${id}/messages`));
    setNotice("");
  }

  async function promote() {
    if (!selected || !promoteLabel.trim()) return;
    try {
      await api.post("/api/admin/taxonomy/promote", {
        cluster_id: selected.cluster.id,
        label: promoteLabel.trim().toLowerCase().replace(/\s+/g, "_"),
      });
      setNotice(`Promoted to intent "${promoteLabel}". Edit keywords in Taxonomy.`);
      setPromoteLabel("");
    } catch (e) {
      setNotice(String(e));
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Intent explorer</h2>
        <p className="text-sm text-stone-500">
          Each dot is one (redacted) user query. Colour = emergent cluster; grey = noise. Click a
          cluster card to read the underlying chats.
        </p>
      </header>

      <div className="rounded-xl border border-stone-200 bg-white p-5">
        {points.length === 0 ? (
          <p className="text-xs text-stone-400">No analysed queries yet — run analyze + cluster from Overview.</p>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" hide />
              <YAxis type="number" dataKey="y" hide />
              <Tooltip
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as Point | undefined;
                  if (!p) return null;
                  return (
                    <div className="max-w-xs rounded-lg border border-stone-200 bg-white p-2 text-xs shadow">
                      <p>{p.text}</p>
                      <p className="mt-1 text-stone-400">
                        {p.intent} · {p.cluster ? p.cluster.label : "unclustered"}
                      </p>
                    </div>
                  );
                }}
              />
              <Scatter data={points} onClick={(p: any) => p?.cluster && openCluster(p.cluster.id)}>
                {points.map((p) => (
                  <Cell key={p.message_id} fill={colorOf(p)} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {clusters.map((c, i) => (
          <button
            key={c.id}
            onClick={() => openCluster(c.id)}
            className={`rounded-xl border bg-white p-4 text-left hover:border-accent ${
              selected?.cluster.id === c.id ? "border-accent" : "border-stone-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-sm font-medium">{c.label}</span>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {c.size} queries · {c.pct_of_total}% of analysed
            </p>
          </button>
        ))}
        {clusters.length === 0 && <p className="text-xs text-stone-400">No clusters yet.</p>}
      </div>

      {selected && (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium">Cluster: {selected.cluster.label}</h3>
              <p className="mt-1 text-xs text-stone-500">{selected.cluster.summary}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                value={promoteLabel}
                onChange={(e) => setPromoteLabel(e.target.value)}
                placeholder="new intent label"
                className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
              />
              <button onClick={promote}
                      className="rounded-lg bg-ink px-3 py-1.5 text-xs text-white">
                Promote to intent
              </button>
            </div>
          </div>
          {notice && <p className="mt-2 text-xs text-accent">{notice}</p>}
          <ul className="mt-4 divide-y divide-stone-100">
            {selected.messages.map((m) => (
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
