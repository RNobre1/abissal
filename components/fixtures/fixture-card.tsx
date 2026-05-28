import Link from "next/link";
import type { FixtureDTO } from "@/lib/fixtures/types";
import type { Badge as BadgeType, BadgeTone } from "@/lib/fixtures/badges";
import { formatUtcAsBrt } from "@/lib/fixtures/time";

interface FixtureCardProps {
  fixture: FixtureDTO;
  highSignal?: boolean;
  /**
   * Wave 4: render the ⚡ IA chip when an active `verdict='bet'`
   * recommendation exists for this fixture. The caller resolves the flag
   * from `fixture.ai_has_bet` (computed in `lib/fixtures/repository.ts`)
   * and forwards it explicitly so the card surface stays decoupled from
   * the DTO shape.
   */
  aiHasBet?: boolean;
  /**
   * Render the muted "IA · sem valor" chip quando a IA analisou e deu skip
   * (de `fixture.ai_no_value`) e NÃO há aposta. Distingue "analisado, sem
   * valor" de "ainda não analisado" (sem chip). `aiHasBet` tem precedência.
   */
  aiNoValue?: boolean;
}

const TONE_DESCRIPTION: Record<BadgeTone, string> = {
  cards: "Árbitro ou elenco com tendência alta de cartões.",
  over: "Os dois lados vêm de sequência forte de Over 2.5 gols.",
  btts: "Os dois lados vêm de sequência forte de BTTS.",
  "first-half": "Os dois lados vêm de sequência forte de gols no 1º tempo.",
};

export function FixtureCard({
  fixture,
  highSignal,
  aiHasBet,
  aiNoValue,
}: FixtureCardProps) {
  const ko = formatUtcAsBrt(fixture.kickoff_utc) ?? fixture.ko_time ?? "TBD";
  const badges = fixture.badges ?? [];

  return (
    <Link
      href={`/fixtures/${fixture.id}`}
      className="card card-hover flex flex-col gap-1.5 px-3 py-2.5 lg:px-4 lg:py-3"
      aria-label={`Analisar ${fixture.home_team} vs ${fixture.away_team}`}
      {...(highSignal ? { "data-high-signal": "true" } : {})}
      style={
        highSignal
          ? { borderColor: "var(--color-depth)" }
          : undefined
      }
    >
      <div className="flex items-center gap-3 lg:gap-4">
        <span
          className="num shrink-0 text-sm tabular-nums text-[var(--color-ink)]"
          aria-label="Horário de Brasília"
        >
          {ko}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-right text-sm text-[var(--color-ink)]">
            {fixture.home_team}
          </span>
          <span className="label shrink-0 text-[var(--color-ink-faint)]">
            vs
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink)]">
            {fixture.away_team}
          </span>
        </span>
        {aiHasBet ? (
          <span
            data-ai-bet="true"
            title="IA recomenda aposta nesta fixture"
            className="label shrink-0 inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-vermelho)] lg:text-[11px]"
            aria-label="IA recomenda aposta nesta fixture"
          >
            ⚡ IA
          </span>
        ) : aiNoValue ? (
          <span
            data-ai-no-value="true"
            title="IA analisou e não viu valor nesta fixture"
            className="label shrink-0 inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-faint)] lg:text-[11px]"
            aria-label="IA analisou e não viu valor nesta fixture"
          >
            IA · sem valor
          </span>
        ) : null}
        {!fixture.has_detail ? (
          <span
            className="label shrink-0 rounded-[var(--radius-sm)] border px-2 py-0.5"
            style={{
              color: "var(--color-vermelho)",
              borderColor: "var(--color-vermelho-low)",
            }}
            title="Sem detail em cache — clique para forçar refresh antes da análise."
          >
            OFF
          </span>
        ) : null}
      </div>
      {badges.length > 0 ? (
        <div className="flex flex-wrap gap-1 pl-[3.5rem] lg:pl-16">
          {badges.map((b) => (
            <BadgeChip key={b.id} badge={b} />
          ))}
        </div>
      ) : null}
    </Link>
  );
}

function BadgeChip({ badge }: { badge: BadgeType }) {
  return (
    <span
      data-badge={badge.id}
      title={TONE_DESCRIPTION[badge.tone]}
      className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)] lg:text-[11px]"
      style={
        badge.tone === "cards"
          ? {
              color: "var(--color-vermelho)",
              borderColor: "var(--color-vermelho-low)",
            }
          : undefined
      }
    >
      {badge.label}
    </span>
  );
}
