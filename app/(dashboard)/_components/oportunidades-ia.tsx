import { fetchTopOpportunities } from "@/lib/ai-reco/reco-repository";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * OportunidadesIa — seção do dashboard "/" com as top 5 recomendações IA
 * ativas (verdict='bet' + kickoff_utc > now), ordenadas por
 * edge_pct * confidence_weight desc (alto=1.0 / medio=0.7 / baixo=0.4).
 *
 * Server Component — depende somente do reader scalar-only
 * (lib/ai-reco/reco-repository) e degrada para estado vazio quando a
 * tabela ai_recommendations ainda não foi populada pela Wave 1+2.
 *
 * Spec: docs/superpowers/specs/2026-05-24-ai-recomendador-design.md §7.3
 */
export async function OportunidadesIa() {
  const supabase = createAdminClient();
  const tops = await fetchTopOpportunities(supabase, 5);

  if (tops.length === 0) {
    return (
      <section
        data-section="oportunidades-ia"
        className="card mb-8 flex flex-col gap-2 p-4 lg:p-5"
      >
        <header className="flex items-baseline justify-between gap-2">
          <span className="label">oportunidades IA</span>
          <span className="label text-[var(--color-ink-faint)]">
            top 5
          </span>
        </header>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Nenhuma oportunidade ativa no momento.
        </p>
      </section>
    );
  }

  return (
    <section
      data-section="oportunidades-ia"
      className="card mb-8 flex flex-col gap-3 p-4 lg:p-5"
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className="label">
          oportunidades IA · top {tops.length}
        </span>
        <span className="label text-[var(--color-ink-faint)]">
          verdict=bet · kickoff &gt; now
        </span>
      </header>
      <ul className="flex flex-col gap-2">
        {tops.map((r) => (
          <li key={r.id}>
            <a
              href={`/fixtures/${r.fixture_id ?? ""}`}
              className="flex items-baseline justify-between gap-3 rounded-[var(--radius-sm)] border border-transparent px-2 py-1 transition-colors hover:border-[var(--color-line)] hover:text-[var(--color-ink)]"
            >
              <span className="min-w-0 truncate text-sm text-[var(--color-ink)]">
                {r.home_team} vs {r.away_team}
              </span>
              <span className="num shrink-0 text-sm tabular-nums text-[var(--color-ink-muted)]">
                {r.summary_line ?? "—"}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
