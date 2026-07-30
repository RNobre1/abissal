/**
 * /bilhete — Página de revisão e confirmação do bilhete múltipla (Wave M).
 *
 * Server Component: lê o draft slip do user via getDraftSlip().
 * Renderiza o BetSlipPageClient (client) com estado inicial.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { authedUserId } from "@/lib/supabase/auth";
import { getDraftSlip } from "@/lib/bet-slip/actions";
import { isAiEnabled } from "@/lib/settings/ai-toggle";
import { BetSlipPageClient } from "./_components/bet-slip-page-client";

export const dynamic = "force-dynamic";

export default async function BilhetePage() {
  const supabase = await createClient();
  const userId = await authedUserId(supabase);

  if (!userId) redirect("/login");

  // Fetch draft slip with legs
  const slip = await getDraftSlip();

  // Fetch houses for commit dropdown
  const { data: houses } = await supabase
    .from("houses")
    .select("id, name")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("name");

  const houseOptions = (houses ?? []).map((h) => ({
    id: h.id,
    name: h.name,
  }));

  // Kill switch global de IA — esconde o "Criticar bilhete" quando desligado.
  const aiEnabled = await isAiEnabled(supabase);

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--color-ink-display)]">
          Bilhete
        </h1>
        <Link
          href="/fixtures"
          className="label text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          ← fixtures
        </Link>
      </header>

      <BetSlipPageClient
        initialSlip={slip}
        houses={houseOptions}
        aiEnabled={aiEnabled}
      />
    </main>
  );
}
