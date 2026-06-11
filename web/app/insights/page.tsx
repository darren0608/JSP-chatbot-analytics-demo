"use client";

// Overview: volumes, top intents/roles/skills, trend line, date-range filter.
import { useCallback, useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "@/lib/api";

type Overview = {
  query_volume: number;
  active_users: number;
  analyzed: number;
  top_intents: { label: string; count: number }[];
  top_roles: { value: string; count: number }[];
  top_skills: { value: string; count: number }[];
  sector_split: { value: string; count: number }[];
  volume_by_day: { date: string; count: number }[];
};

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [jobMsg, setJobMsg] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (from) params.set("date_from", from);
    if (to) params.set("date_to", to);
    api.get<Overview>(`/api/admin/overview?${params}`).then(setData);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  async function runJob(name: "ingest" | "analyze" | "cluster") {
    setJobMsg(`Running ${name}…`);
    const result = await api.post<Record<string, unknown>>(`/api/admin/jobs/${name}`);
    setJobMsg(`${name}: ${JSON.stringify(result)}`);
    load();
  }

  if (!data) return <p className="text-sm text-stone-400">Loading…</p>;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Overview</h2>
          <p className="text-sm text-stone-500">What people are asking, at a glance.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 className="rounded-lg border border-stone-300 px-2 py-1.5" />
          <span className="text-stone-400">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                 className="rounded-lg border border-stone-300 px-2 py-1.5" />
        </div>
      </header>

      <div className="grid grid-cols-3 gap-4">
        {[
          ["Queries", data.query_volume],
          ["Active users", data.active_users],
          ["Analysed (consented)", data.analyzed],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-stone-200 bg-white p-5">
            <p className="text-xs uppercase tracking-wide text-stone-400">{label}</p>
            <p className="mt-1 text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-medium">Query volume over time</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.volume_by_day}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={11} />
            <YAxis allowDecimals={false} fontSize={11} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#c96442" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Top intents" data={data.top_intents.map((d) => ({ name: d.label, count: d.count }))} />
        <ChartCard title="Top job roles" data={data.top_roles.map((d) => ({ name: d.value, count: d.count }))} />
        <ChartCard title="Top skills" data={data.top_skills.map((d) => ({ name: d.value, count: d.count }))} />
        <ChartCard title="Sector split" data={data.sector_split.map((d) => ({ name: d.value, count: d.count }))} />
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h3 className="text-sm font-medium">Batch jobs</h3>
        <p className="mt-1 text-xs text-stone-500">
          Normally scheduled; run on demand here.
        </p>
        <div className="mt-3 flex gap-2">
          {(["ingest", "analyze", "cluster"] as const).map((name) => (
            <button key={name} onClick={() => runJob(name)}
                    className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:border-accent">
              Run {name}
            </button>
          ))}
        </div>
        {jobMsg && <p className="mt-2 break-all text-xs text-stone-500">{jobMsg}</p>}
      </div>
    </div>
  );
}

function ChartCard({ title, data }: { title: string; data: { name: string; count: number }[] }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-medium">{title}</h3>
      {data.length === 0 ? (
        <p className="text-xs text-stone-400">No data yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(120, data.length * 32)}>
          <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
            <XAxis type="number" allowDecimals={false} fontSize={11} />
            <YAxis type="category" dataKey="name" width={130} fontSize={11} />
            <Tooltip />
            <Bar dataKey="count" fill="#c96442" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
