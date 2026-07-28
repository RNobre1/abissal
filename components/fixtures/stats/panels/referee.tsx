/**
 * Panel I — Referee record (OPTIONAL).
 *
 * Returns `null` when `record` is null. choistats só publica o árbitro
 * escalado perto do KO, então o painel some para parte das fixtures — por
 * design, sem placeholder.
 *
 * Headline: quando há contagem de cartões (`avg_total_cards`), ela é a
 * manchete — é a unidade em que os mercados são cotados. Booking points
 * (amarelo=10, vermelho=25) vira métrica secundária: é composta e esconde a
 * forma da distribuição. Registros antigos, sem os campos por jogo, caem de
 * volta na headline de BP.
 *
 * Realce em `--color-vermelho` acima de 45 BP (mesma heurística do motor de
 * insights, `REF_BP_HIGH`) ou de 5 cartões/jogo.
 */

import { PanelShell } from "@/components/fixtures/stats/panels/_shell";
import type { RefereeRecord } from "@/lib/fixtures/stats/detail-json-types";

interface RefereeProps {
  record: RefereeRecord | null;
}

const BP_THRESHOLD = 45;
const CARDS_THRESHOLD = 5;
/** Acima disso a variância supera a média o bastante pra fugir do Poisson. */
const DISPERSION_OVER = 1.15;
const DISPERSION_SUB = 0.85;

function has(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function dispersionKind(v: number): "over" | "sub" | "poisson" {
  if (v > DISPERSION_OVER) return "over";
  if (v < DISPERSION_SUB) return "sub";
  return "poisson";
}

const DISPERSION_LABEL: Record<string, string> = {
  over: "irregular",
  sub: "consistente",
  poisson: "típica",
};

export function Referee({ record }: RefereeProps) {
  if (record === null) return null;

  const hasCards = has(record.avg_total_cards);
  const headlineValue = hasCards
    ? record.avg_total_cards!
    : record.avg_total_booking_points;
  const isHigh = hasCards
    ? headlineValue > CARDS_THRESHOLD
    : record.avg_total_booking_points > BP_THRESHOLD;
  const headlineColor = isHigh
    ? "var(--color-vermelho)"
    : "var(--color-ink-display)";

  const lines = record.cards_over_pct
    ? Object.entries(record.cards_over_pct).sort(
        (a, b) => Number(a[0]) - Number(b[0]),
      )
    : [];

  return (
    <PanelShell title={record.name} eyebrow="árbitro">
      <div className="flex items-baseline gap-3">
        <span
          data-bp-headline
          className="font-display num text-4xl"
          style={{ color: headlineColor }}
        >
          {headlineValue.toFixed(1)}
        </span>
        <span className="label text-[var(--color-ink-faint)]">
          {hasCards ? "cartões por jogo" : "BP médio por jogo"}
        </span>
        {has(record.cards_dispersion) && (
          <span
            data-dispersion={dispersionKind(record.cards_dispersion)}
            className="label ml-auto text-[var(--color-ink-faint)]"
            title={`dispersão ${record.cards_dispersion.toFixed(2)} (variância ÷ média)`}
          >
            {DISPERSION_LABEL[dispersionKind(record.cards_dispersion)]}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="flex flex-col">
          <span className="label text-[var(--color-ink-faint)]">casa</span>
          <span className="num text-[var(--color-ink-display)]">
            {has(record.avg_home_cards)
              ? record.avg_home_cards.toFixed(1)
              : record.avg_home_booking_points.toFixed(1)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="label text-[var(--color-ink-faint)]">fora</span>
          <span className="num text-[var(--color-ink-display)]">
            {has(record.avg_away_cards)
              ? record.avg_away_cards.toFixed(1)
              : record.avg_away_booking_points.toFixed(1)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="label text-[var(--color-ink-faint)]">
            {hasCards ? "BP médio" : "2º amarelo"}
          </span>
          <span className="num text-[var(--color-ink-display)]">
            {hasCards
              ? record.avg_total_booking_points.toFixed(0)
              : record.total_yellow_reds}
          </span>
        </div>
      </div>

      {(has(record.pct_home_2plus_cards) ||
        has(record.pct_away_2plus_cards)) && (
        <div
          data-cards-2plus
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
        >
          <span className="label text-[var(--color-ink-faint)]">2+ cartões</span>
          {has(record.pct_home_2plus_cards) && (
            <span className="num text-[var(--color-ink-display)]">
              casa {record.pct_home_2plus_cards.toFixed(0)}%
            </span>
          )}
          {has(record.pct_away_2plus_cards) && (
            <span className="num text-[var(--color-ink-display)]">
              fora {record.pct_away_2plus_cards.toFixed(0)}%
            </span>
          )}
          {has(record.pct_both_2plus_cards) && (
            <span
              data-both-2plus
              className="num text-[var(--color-ink-display)]"
            >
              ambos {record.pct_both_2plus_cards.toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="label text-[var(--color-ink-faint)]">
            over de cartões (histórico do árbitro)
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {lines.map(([line, pct]) => (
              <span key={line} data-card-line={line} className="num">
                <span className="text-[var(--color-ink-faint)]">{line}</span>{" "}
                <span className="text-[var(--color-ink-display)]">
                  {pct.toFixed(1)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {has(record.avg_total_fouls) && (
        <div data-fouls className="flex items-baseline gap-2 text-sm">
          <span className="label text-[var(--color-ink-faint)]">faltas/jogo</span>
          <span className="num text-[var(--color-ink-display)]">
            {record.avg_total_fouls.toFixed(1)}
          </span>
        </div>
      )}

      <span className="label text-[var(--color-ink-faint)]">
        base: {record.completed} jogos apitados
      </span>
    </PanelShell>
  );
}
