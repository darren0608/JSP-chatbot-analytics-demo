"use client";

// Content gaps: low-retrieval / out-of-scope / low-confidence queries, ranked
// by frequency — the backlog feed for portal content owners.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Gap = {
  text: string;
  count: number;
  intents: Record<string, number>;
  min_retrieval_score: number | null;
};

export default function GapsPage() {
  const [gaps, setGaps] = useState<Gap[]>([]);

  useEffect(() => {
    api.get<Gap[]>("/api/admin/gaps").then(setGaps);
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Content gaps</h2>
        <p className="text-sm text-stone-500">
          Queries the assistant couldn&apos;t answer well — low retrieval score, out-of-scope, or
          low-confidence intent. Ranked by frequency.
        </p>
      </header>

      {gaps.length === 0 ? (
        <p className="text-sm text-stone-400">No gaps detected yet. 🎉</p>
      ) : (
        <table className="w-full rounded-xl border border-stone-200 bg-white text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="p-3">Query (redacted)</th>
              <th className="p-3">Frequency</th>
              <th className="p-3">Intents</th>
              <th className="p-3">Min retrieval</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => (
              <tr key={g.text} className="border-b border-stone-100 last:border-0">
                <td className="p-3">“{g.text}”</td>
                <td className="p-3 font-medium">{g.count}</td>
                <td className="p-3 text-xs text-stone-500">
                  {Object.entries(g.intents).map(([k, v]) => `${k} (${v})`).join(", ")}
                </td>
                <td className="p-3 text-xs text-stone-500">
                  {g.min_retrieval_score == null ? "—" : g.min_retrieval_score.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
