import type {
  FixtureSimulationDTO,
  SimPlayerEvent,
} from "@/lib/fixtures/simulation-repository";
import { InfoPopover } from "@/components/fixtures/stats/_primitives/info-popover";
import { PanelShell } from "@/components/fixtures/stats/panels/_shell";
import {
  TeamLegend,
  teamColor,
} from "@/components/fixtures/stats/_primitives/team-legend";

/**
 * Painel SIM · simulação pré-jogo.
 *
 * Lê o registro escalar de `fixture_simulations` (via simulation-repository,
 * scalar-only) e o `avgs` enriquecido do detail_json (campo de fundação T1)
 * apenas para mostrar o tamanho de amostra do modelo (honestidade).
 *
 * Diretrizes de produto (firmes):
 *  - placar provável + barras 1X2/over/BTTS com a probabilidade VISÍVEL como
 *    texto (fora de tooltip também);
 *  - aba/seção de stats com números EXATOS por time;
 *  - campo de futebol com a provável escalação, SEMPRE rotulada
 *    "provável escalação" — NUNCA "oficial"/"XI oficial";
 *  - ícones de gol/cartão por jogador;
 *  - tooltips reutilizando o InfoPopover existente do dashboard de stats;
 *  - degradação honesta: stat sem split de tempo → "total do jogo";
 *    posse nunca é simulada (não renderiza número); `status: 'unsimulable'`
 *    ou ausência de simulação → estado "simulação indisponível".
 *
 * Adesão ao design system: renderiza via `PanelShell` (mesma casca card+
 * header de todo painel server), usa `teamColor`/`TeamLegend` como fonte
 * única de cor por time, tokens de raio válidos (`--radius-sm`) e a barra de
 * proporção única com `role="meter"` + valor textual (convenção de
 * `distributions.tsx`). Aba mobile dedicada (MOBILE_TABS em
 * `stats-layout.tsx`) fica adiada para T6 — fora do escopo deste painel.
 */

interface SimulationPanelProps {
  sim: FixtureSimulationDTO | null;
  homeTeam: string;
  awayTeam: string;
  /** num_matches de avgs (T1) — tamanho de amostra do modelo, p/ honestidade. */
  sampleSize: { home: number | null; away: number | null };
}

function pct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function pctNum(v: number | null): number {
  if (v === null || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v * 100)));
}

/**
 * A single probability bar — exactly the dashboard convention used by
 * `distributions.tsx`: ONE element carrying `role="meter"` +
 * `aria-valuenow/min/max`, a VISIBLE numeric value (MetricCell typography:
 * `num` + `text-sm font-semibold`) and an `aria-hidden` decorative track.
 * No native `<meter>`, no second element duplicating the same value.
 */
function ProbBar({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | null;
  accent: string;
}) {
  const p = pctNum(value);
  return (
    <div
      role="meter"
      aria-valuenow={p}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label} ${pct(value)}`}
      className="flex flex-col gap-1"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="label text-[var(--color-ink-muted)]">{label}</span>
        <span className="num text-sm font-semibold text-[var(--color-ink-display)]">
          {pct(value)}
        </span>
      </div>
      <div
        aria-hidden
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${p}%`, background: accent }}
        />
      </div>
    </div>
  );
}

/**
 * Empty / unsimulable state — still a standard card with the standard
 * header (rendered through `PanelShell`), so it reads as native dashboard
 * furniture rather than a bolt-on placeholder.
 */
function Unavailable({ reason }: { reason: string }) {
  return (
    <PanelShell title="Simulação pré-jogo" eyebrow="Monte Carlo">
      <div className="flex flex-col items-center justify-center gap-2 py-8">
        <p className="text-[var(--color-ink-muted)]">simulação indisponível</p>
        <p className="label text-[var(--color-ink-faint)]">{reason}</p>
      </div>
    </PanelShell>
  );
}

interface SimStatRow {
  key: string;
  label: string;
  /** true quando a métrica não tem split de tempo (rotular "total do jogo"). */
  totalOnly: boolean;
}

// Posse NÃO entra (nunca simulada). Escanteios/gols têm split de tempo
// quando per_half_available; o resto é sempre total do jogo.
const STAT_ROWS: SimStatRow[] = [
  { key: "goals", label: "Gols", totalOnly: false },
  { key: "corners", label: "Escanteios", totalOnly: false },
  { key: "sot", label: "Finalizações no alvo", totalOnly: true },
  { key: "cards", label: "Cartões", totalOnly: true },
];

function statValue(
  bucket: Record<string, Record<string, number>> | undefined,
  key: string,
): string {
  const metric = bucket?.[key];
  if (!metric) return "—";
  const v = metric.p50 ?? metric.median ?? metric.p90 ?? null;
  if (v === null || !Number.isFinite(v)) return "—";
  return Number(v.toFixed(2)).toString();
}

export function SimulationPanel({
  sim,
  homeTeam,
  awayTeam,
  sampleSize,
}: SimulationPanelProps) {
  if (!sim) {
    return <Unavailable reason="scraper ainda não computou esta partida" />;
  }
  if (sim.status === "unsimulable") {
    return <Unavailable reason="dados insuficientes para simular" />;
  }

  const top = sim.top_scorelines[0] ?? null;
  const homeStats = sim.sim_stats?.home as
    | Record<string, Record<string, number>>
    | undefined;
  const awayStats = sim.sim_stats?.away as
    | Record<string, Record<string, number>>
    | undefined;

  const xi = sim.player_events.filter((p) => p.provavel_titular);
  const xiToShow = xi.length > 0 ? xi : sim.player_events;

  return (
    <PanelShell
      title="Simulação pré-jogo"
      gap={4}
      eyebrow={
        <span className="inline-flex items-center gap-1.5">
          Monte Carlo
          <InfoPopover label="o que é a simulação pré-jogo">
            <p>
              Resultado de uma simulação Monte Carlo (10k iterações) computada
              no scraper a partir das médias de temporada. Mostra o placar mais
              provável, probabilidades de mercado e a alocação de eventos por
              jogador. Não é palpite do mercado nem opinião — é a distribuição
              do modelo.
            </p>
          </InfoPopover>
        </span>
      }
    >
      {/* ── Placar provável + barras de probabilidade ── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="label text-[var(--color-ink-muted)]">
            Placar mais provável
          </span>
          <span
            className="num text-3xl font-bold"
            style={{ color: "var(--color-ink-display)" }}
            data-probable-score
          >
            {top ? top.score : "—"}
          </span>
          {top ? (
            <span className="label num text-[var(--color-ink-faint)]">
              {pct(top.prob)} das simulações
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 @md/card:grid-cols-3">
          <ProbBar
            label={`Vitória ${homeTeam}`}
            value={sim.p_home}
            accent={teamColor("home")}
          />
          <ProbBar
            label="Empate"
            value={sim.p_draw}
            accent="var(--color-ink-faint)"
          />
          <ProbBar
            label={`Vitória ${awayTeam}`}
            value={sim.p_away}
            accent={teamColor("away")}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 @md/card:grid-cols-2">
          <ProbBar
            label="Over 2.5"
            value={sim.p_over_25}
            accent="var(--color-depth)"
          />
          <ProbBar
            label="Ambos marcam (BTTS)"
            value={sim.p_btts}
            accent="var(--color-vermelho)"
          />
        </div>
      </section>

      {/* ── Aba/seção de stats: números EXATOS por time ── */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <h4 className="label text-[var(--color-ink-muted)]">
            Stats projetadas por time
          </h4>
          <InfoPopover label="como ler as stats projetadas">
            <p>
              Mediana (p50) das 10k iterações por time. Métricas sem split de
              tempo são marcadas <strong>total do jogo</strong>. Posse de bola
              não é simulada — por isso não aparece.
            </p>
          </InfoPopover>
        </div>
        <TeamLegend home={homeTeam} away={awayTeam} className="mb-1" />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="label py-1 font-normal text-[var(--color-ink-faint)]">
                Métrica
              </th>
              <th
                className="label py-1 text-right font-normal"
                style={{ color: teamColor("home") }}
              >
                {homeTeam}
              </th>
              <th
                className="label py-1 text-right font-normal"
                style={{ color: teamColor("away") }}
              >
                {awayTeam}
              </th>
            </tr>
          </thead>
          <tbody>
            {STAT_ROWS.map((r) => {
              const noSplit = r.totalOnly || !sim.per_half_available;
              return (
                <tr
                  key={r.key}
                  className="border-t border-[var(--color-line)]"
                  data-sim-stat={r.key}
                >
                  <td className="py-1.5 text-[var(--color-ink-display)]">
                    {r.label}
                    {noSplit ? (
                      <span className="label ml-2 text-[var(--color-ink-faint)]">
                        total do jogo
                      </span>
                    ) : null}
                  </td>
                  <td className="num py-1.5 text-right text-[var(--color-ink-display)]">
                    {statValue(homeStats, r.key)}
                  </td>
                  <td className="num py-1.5 text-right text-[var(--color-ink-display)]">
                    {statValue(awayStats, r.key)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="label text-[var(--color-ink-faint)]">
          Amostra do modelo: {homeTeam} {sampleSize.home ?? "—"} jogos ·{" "}
          {awayTeam} {sampleSize.away ?? "—"} jogos
        </p>
      </section>

      {/* ── Campo: provável escalação ── */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <h4 className="label text-[var(--color-ink-muted)]">
            Provável escalação
          </h4>
          <InfoPopover label="sobre a provável escalação">
            <p>
              Esta é a <strong>provável escalação</strong> projetada do
              histórico de minutos/titularidade — <strong>não</strong> é a
              escalação confirmada. A escalação real só sai ~1h antes do jogo.
            </p>
          </InfoPopover>
        </div>
        <p className="label text-[var(--color-ink-faint)]">
          projeção do histórico — provável escalação, sujeita a mudança
        </p>
        <div
          data-pitch
          className="grid grid-cols-2 gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-depth)_8%,transparent)] p-3 sm:grid-cols-3"
        >
          {xiToShow.map((p, idx) => (
            <PlayerChip key={`${p.name}-${idx}`} player={p} />
          ))}
        </div>
      </section>
    </PanelShell>
  );
}

function PlayerChip({ player }: { player: SimPlayerEvent }) {
  const likelyScorer = player.p_goal >= 0.25;
  const cardProne = player.p_card >= 0.25;
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-sm text-[var(--color-ink-display)]">
          {player.name}
        </span>
        <span className="flex items-center gap-1">
          {likelyScorer ? (
            <span
              data-player-icon="goal"
              aria-label="provável marcador"
              title="provável marcador"
            >
              ⚽
            </span>
          ) : null}
          {cardProne ? (
            <span
              data-player-icon="card"
              aria-label="propenso a cartão"
              title="propenso a cartão"
              className="inline-block h-3 w-2 rounded-[1px]"
              style={{ background: "var(--color-warning)" }}
            />
          ) : null}
        </span>
      </div>
      <span className="num label text-[var(--color-ink-faint)]">
        gol {pct(player.p_goal)} · cartão {pct(player.p_card)}
        {Number.isFinite(player.expected_goals)
          ? ` · xG ${Number(player.expected_goals.toFixed(2))}`
          : null}
      </span>
      {player.confidence ? (
        <span
          data-player-confidence={player.confidence}
          className="label text-[var(--color-ink-faint)]"
        >
          confiança {player.confidence}
        </span>
      ) : null}
    </div>
  );
}
