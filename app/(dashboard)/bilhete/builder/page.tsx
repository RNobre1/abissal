/**
 * /bilhete/builder — Página do Bet Builder manual.
 *
 * Server Component: carrega casas do usuário e renderiza BuilderForm (client).
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BuilderForm } from "./_components/builder-form";

export const dynamic = "force-dynamic";

interface BetBuilderPageProps {
  // Next.js 15+/16: searchParams é Promise
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function BetBuilderPage({ searchParams }: BetBuilderPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: houses } = await supabase
    .from("houses")
    .select("id, name")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("name");

  const houseOptions = (houses ?? []).map((h) => ({
    id: h.id,
    name: h.name,
  }));

  // searchParams (Next 16: Promise) → plain object pra serializar no boundary
  // RSC→Client (URLSearchParams não é serializable, gera "l.get is not a
  // function" em runtime). BuilderForm reconstrói URLSearchParams interno.
  // Caminho de pré-preenchimento via foto OCR (Worker C):
  // /bilhete/builder?fixture_id=...&home=...&away=...&odd=...&stake=...&house=...&legs=<JSON encoded>
  const resolvedParams = await searchParams;
  const initialParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(resolvedParams)) {
    if (typeof value === "string") initialParams[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") initialParams[key] = value[0];
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 pb-24">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--color-ink-display)]">
          Bet Builder
        </h1>
        <Link
          href="/bilhete"
          className="label shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          ← bilhete
        </Link>
      </header>

      <p className="label mb-6 text-[var(--color-ink-faint)]">
        1 jogo · N condições · 1 odd combinada única
      </p>

      <BuilderForm houses={houseOptions} initialParams={initialParams} />
    </main>
  );
}
