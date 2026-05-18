import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fixturesWithBadgesForDashboard } from "@/lib/fixtures/repository";
import { todayBrt, formatUtcAsBrt } from "@/lib/fixtures/time";
import type { FixtureDTO } from "@/lib/fixtures/types";
import type { Badge } from "@/lib/fixtures/badges";
import { dismissAlert } from "./actions";

/**
 * Seção "⚡ Destaques do dia" do dashboard.
 *
 * Server Component — avalia sinais em read-time:
 * 1. Busca fixtures da janela BRT de hoje com sub-paths para badges.
 * 2. Filtra por `high_signal === true` (≥2 badges, computado na view SQL).
 * 3. Exclui as dispensadas pelo usuário (tabela alert_dismissals).
 * 4. Se lista vazia, retorna null (sem header órfão).
 */
export async function DestaquesDoDia() {
  const today = todayBrt();

  // Query com badges (sub-paths leves de detail_json — ver repository.ts)
  const admin = createAdminClient();
  const allFixtures = await fixturesWithBadgesForDashboard(today, admin);

  // Filtra apenas alto sinal. high_signal vem JÁ computado da view Postgres
  // (fixture_badges_view, migration 0017) — escalar, sem detail_json no Worker.
  // fixturesWithBadgesForDashboard seta high_signal e badges atomicamente da
  // mesma view; não há rows com high_signal=false mas badges.length>=2, logo
  // o filtro usa somente high_signal (YAGNI — ramo || seria dead code).
  const highSignalFixtures = allFixtures.filter((f) => f.high_signal === true);

  if (highSignalFixtures.length === 0) return null;

  // Busca dismissals do usuário autenticado
  let dismissedIds = new Set<number>();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data } = await supabase
        .from("alert_dismissals")
        .select("fixture_id")
        .eq("user_id", user.id);
      if (data) {
        dismissedIds = new Set(
          (data as { fixture_id: number }[]).map((r) => r.fixture_id),
        );
      }
    }
  } catch {
    // alert_dismissals indisponível → degrada: mostra todos (sem crash)
  }

  const visible = highSignalFixtures.filter((f) => !dismissedIds.has(f.id));

  if (visible.length === 0) return null;

  return (
    <section
      data-destaques="true"
      className="mb-12 card p-6"
    >
      <header className="mb-4 flex items-baseline gap-3">
        <span className="text-base leading-none" aria-hidden>
          ⚡
        </span>
        <span className="label">destaques do dia</span>
        <span className="label num text-[var(--color-ink-faint)]">
          {visible.length}
        </span>
      </header>

      <ul className="flex flex-col gap-2">
        {visible.map((fixture) => (
          <DestaqueLine
            key={fixture.id}
            fixture={fixture}
            badges={fixture.badges ?? []}
          />
        ))}
      </ul>
    </section>
  );
}

function DestaqueLine({
  fixture,
  badges,
}: {
  fixture: FixtureDTO;
  badges: Badge[];
}) {
  const ko = formatUtcAsBrt(fixture.kickoff_utc) ?? fixture.ko_time ?? "TBD";

  return (
    <li className="flex items-center gap-3">
      <Link
        href={`/fixtures/${fixture.id}`}
        className="flex min-w-0 flex-1 items-baseline gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm hover:bg-[var(--color-surface-3)] transition-colors"
        style={{ borderLeft: "2px solid var(--color-depth)" }}
      >
        <span className="num shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">
          {ko}
        </span>
        <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
          {fixture.home_team}
        </span>
        <span className="label shrink-0 text-[var(--color-ink-faint)]">vs</span>
        <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
          {fixture.away_team}
        </span>
        {badges.length > 0 && (
          <span className="shrink-0 flex gap-1">
            {badges.map((b) => (
              <span
                key={b.id}
                className="label inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)] px-1 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]"
              >
                {b.label}
              </span>
            ))}
          </span>
        )}
      </Link>
      <form
        action={dismissAlert.bind(null, fixture.id)}
      >
        <button
          type="submit"
          className="label shrink-0 px-2 py-1 text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)] transition-colors"
          aria-label={`Dispensar destaque: ${fixture.home_team} vs ${fixture.away_team}`}
        >
          ×
        </button>
      </form>
    </li>
  );
}
