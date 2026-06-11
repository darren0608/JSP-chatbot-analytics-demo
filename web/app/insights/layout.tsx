"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, User } from "@/lib/api";

const NAV = [
  { href: "/insights", label: "Overview" },
  { href: "/insights/intents", label: "Intent explorer" },
  { href: "/insights/entities", label: "Entity explorer" },
  { href: "/insights/conversations", label: "Conversations" },
  { href: "/insights/gaps", label: "Content gaps" },
  { href: "/insights/taxonomy", label: "Taxonomy" },
];

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    api.get<User>("/api/auth/me")
      .then((u) => (u.role === "admin" ? setUser(u) : setDenied(true)))
      .catch(() => router.push("/login"));
  }, [router]);

  if (denied)
    return (
      <main className="p-12 text-center text-sm text-stone-500">
        JSP Insights requires an admin account. <Link className="text-accent underline" href="/">Back to the assistant</Link>.
      </main>
    );
  if (!user) return <main className="p-8 text-sm text-stone-400">Loading…</main>;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-stone-200 bg-white">
        <div className="border-b border-stone-100 p-4">
          <h1 className="font-semibold">JSP Insights</h1>
          <p className="truncate text-xs text-stone-400">{user.email}</p>
        </div>
        <nav className="p-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-1 block rounded-lg px-3 py-2 text-sm ${
                pathname === item.href ? "bg-stone-100 font-medium" : "hover:bg-stone-50"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-2">
          <Link href="/" className="block rounded-lg px-3 py-2 text-sm hover:bg-stone-50">
            ← JSP Assistant
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-8">{children}</main>
    </div>
  );
}
