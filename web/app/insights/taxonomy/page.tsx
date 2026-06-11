"use client";

// Taxonomy admin: view/edit the seed intent taxonomy; promoted intents from
// the Intent explorer also appear here.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Taxon = {
  id: string; label: string; description: string; keywords: string[];
  origin: string; active: boolean;
};

export default function TaxonomyPage() {
  const [rows, setRows] = useState<Taxon[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [keywordsDraft, setKeywordsDraft] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get<Taxon[]>("/api/admin/taxonomy").then(setRows);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(t: Taxon) {
    await api.patch(`/api/admin/taxonomy/${t.id}`, { active: !t.active });
    load();
  }

  async function saveKeywords(t: Taxon) {
    await api.patch(`/api/admin/taxonomy/${t.id}`, {
      keywords: keywordsDraft.split(",").map((k) => k.trim()).filter(Boolean),
    });
    setEditing(null);
    load();
  }

  async function addIntent() {
    setError("");
    try {
      await api.post("/api/admin/taxonomy", {
        label: newLabel.trim().toLowerCase().replace(/\s+/g, "_"),
      });
      setNewLabel("");
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Intent taxonomy</h2>
        <p className="text-sm text-stone-500">
          Seed intents drive classification; keywords are the classifier&apos;s signals. Promote
          emergent clusters from the Intent explorer.
        </p>
      </header>

      <div className="flex items-center gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="new_intent_label"
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <button onClick={addIntent} disabled={!newLabel.trim()}
                className="rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-40">
          Add intent
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      <table className="w-full rounded-xl border border-stone-200 bg-white text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
            <th className="p-3">Label</th>
            <th className="p-3">Description</th>
            <th className="p-3">Keywords</th>
            <th className="p-3">Origin</th>
            <th className="p-3">Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-stone-100 align-top last:border-0">
              <td className="p-3 font-medium">{t.label}</td>
              <td className="p-3 text-stone-500">{t.description}</td>
              <td className="p-3">
                {editing === t.id ? (
                  <span className="flex gap-2">
                    <input value={keywordsDraft}
                           onChange={(e) => setKeywordsDraft(e.target.value)}
                           className="w-64 rounded border border-stone-300 px-2 py-1 text-xs" />
                    <button onClick={() => saveKeywords(t)} className="text-xs text-accent">save</button>
                    <button onClick={() => setEditing(null)} className="text-xs text-stone-400">cancel</button>
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      setEditing(t.id);
                      setKeywordsDraft(t.keywords.join(", "));
                    }}
                    className="text-left text-xs text-stone-500 underline decoration-dotted"
                  >
                    {t.keywords.length ? t.keywords.join(", ") : "—"}
                  </button>
                )}
              </td>
              <td className="p-3">
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  t.origin === "promoted" ? "bg-amber-50 text-amber-700" : "bg-stone-100 text-stone-500"
                }`}>
                  {t.origin}
                </span>
              </td>
              <td className="p-3">
                <button onClick={() => toggleActive(t)}
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          t.active ? "bg-green-50 text-green-700" : "bg-stone-100 text-stone-400"
                        }`}>
                  {t.active ? "active" : "inactive"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
