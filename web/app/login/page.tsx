"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, User } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user =
        mode === "login"
          ? await api.post<User>("/api/auth/login", { email, password })
          : await api.post<User>("/api/auth/signup", { email, password, consent_analytics: consent });
      router.push(user.role === "admin" ? "/insights" : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">JSP Assistant</h1>
        <p className="mt-1 text-sm text-stone-500">
          Your guide to jobs, skills, careers, and training.
        </p>

        <div className="mt-6 flex gap-2 text-sm">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-4 py-1.5 ${
                mode === m ? "bg-ink text-white" : "bg-stone-100 text-stone-600"
              }`}
            >
              {m === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          {mode === "signup" && (
            <label className="flex items-start gap-2 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I consent to my queries being analysed (anonymised and PII-redacted) to improve
                jobs-and-skills content. You can withdraw this at any time; without consent your
                chats are excluded from analytics.
              </span>
            </label>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            disabled={busy}
            className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-xs text-stone-400">
          Prototype login — not hardened production identity. Demo accounts: demo@example.com /
          demo12345 · admin@example.com / admin12345 (after seeding).
        </p>
      </div>
    </main>
  );
}
