import type {
  FixtureSimulationDTO,
  SimPlayerEvent,
} from "@/lib/fixtures/simulation-repository";
import {
  playerMarketHints,
  type PlayerOdds,
  type PlayerOddsMap,
} from "@/lib/fixtures/stats/player-market-value";
import { scorelineDisplay } from "@/lib/fixtures/scoreline-display";
import { InfoPopover } from "@/components/fixtures/stats/_primitives/info-popover";
import { PanelShell } from "@/components/fixtures/stats/panels/_shell";
import {
  countTotalMean,
  marketCall,
  MARKET_LINES,
  STRONG_THRESHOLD,
  type CountMarket,
} from "@/lib/calibracao/market-accuracy";
import type { DistKMap } from "@/lib/ai-reco/dist-k-repository";
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
  /** odds de jogador (detail_json.player_extra.outcome_odds_by_player), nome→odds.
   *  Esparso (~10% dos fixtures). Quando presente, vira caça-valor manual. */
  playerOdds?: PlayerOddsMap;
  /**
   * "shell" (default): renderiza o conteúdo dentro do PanelShell padrão.
   * "bare": entrega só o body — o pai (SimulationDisclosure) fornece a casca.
   * Permite reusar este componente sob a casca da disclosure no desktop sem
   * cair em card-in-card.
   */
  chrome?: "shell" | "bare";
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
function UnavailableBody({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8">
      <p className="text-[var(--color-ink-muted)]">simulação indisponível</p>
      <p className="label text-[var(--color-ink-faint)]">{reason}</p>
    </div>
  );
}

function Unavailable({ reason, chrome }: { reason: string; chrome: "shell" | "bare" }) {
  if (chrome === "bare") return <UnavailableBody reason={reason} />;
  return (
    <PanelShell title="Simulação pré-jogo" eyebrow="Monte Carlo">
      <UnavailableBody reason={reason} />
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
  // F12 — derivadas da série recent_matches (sem split de tempo: dados
  // intra-jogo não existem por tempo). Omitidas em sim_stats quando a
  // série não tem ≥2 valores; statValue() já degrada esses casos pra "—".
  { key: "fouls", label: "Faltas", totalOnly: true },
  { key: "offsides", label: "Impedimentos", totalOnly: true },
  { key: "tackles", label: "Desarmes", totalOnly: true },
];

/** Métricas que têm linha de mercado — só elas recebem sinal de lado. */
const SIGNAL_METRICS = new Set<string>(["corners", "cards", "sot"]);

/**
 * Traduz a projeção da simulação no LADO que ela apostaria, na linha padrão de
 * mercado. É a mesma conta do painel de desempenho por liga: o `−` que aparece
 * aqui é exatamente o `−` cujo acerto histórico aquele painel mede.
 *
 * Ancora na linha canônica mais próxima da média projetada — a que a casa de
 * fato ofereceria pro jogo. Métrica sem linha (faltas, impedimentos, desarmes)
 * não recebe símbolo.
 */
export function signalFor(
  simStats: unknown,
  metric: CountMarket,
  distK?: DistKMap,
): { symbol: string; text: string } | null {
  const lines = MARKET_LINES[metric];
  if (!lines) return null;
  const mean = countTotalMean(simStats, metric);
  if (mean === null) return null;

  const line = lines.reduce((best, l) =>
    Math.abs(l - mean) < Math.abs(best - mean) ? l : best,
  );
  const { side, prob } = marketCall(simStats, metric, line, distK);
  if (prob === null) return null;

  if (side === null) {
    return { symbol: "≈", text: `sem chamada · ${Math.round(prob * 100)}%` };
  }
  const conf = side === "over" ? prob : 1 - prob;
  const strong = conf >= STRONG_THRESHOLD;
  const symbol = side === "over" ? (strong ? "++" : "+") : strong ? "−−" : "−";
  const rotulo = side === "over" ? "mais de" : "menos de";
  return { symbol, text: `${rotulo} ${line} · ${Math.round(conf * 100)}%` };
}

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

interface SimulationBodyProps {
  sim: FixtureSimulationDTO;
  homeTeam: string;
  awayTeam: string;
  sampleSize: { home: number | null; away: number | null };
  playerOdds?: PlayerOddsMap;
}

function SimulationBody({
  sim,
  homeTeam,
  awayTeam,
  sampleSize,
  playerOdds,
}: SimulationBodyProps) {
  const score = scorelineDisplay(sim.top_scorelines);
  const top = score.top;
  const homeStats = sim.sim_stats?.home as
    | Record<string, Record<string, number>>
    | undefined;
  const awayStats = sim.sim_stats?.away as
    | Record<string, Record<string, number>>
    | undefined;

  const xi = sim.player_events.filter((p) => p.provavel_titular);
  const xiToShow = xi.length > 0 ? xi : sim.player_events;

  return (
    <>
      {/* F3-prod: badge inline quando probs foram pós-processadas pela curva
          isotônica. Renderizado no início do body (não no eyebrow) porque
          o panel é chamado com chrome="bare" e o eyebrow vive no
          SimulationDisclosure, que não recebe sim como prop. */}
      {sim.calibrated_via_isotonic ? <CalibrationBadge n={sim.calibration_n} /> : null}

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

        {/* Outros placares mais simulados — comunica a incerteza real
            (o placar exato mais provável tem só ~10%). Empates realçados. */}
        {score.rest.length > 0 ? (
          <div className="flex flex-col gap-1.5" data-section="top-scorelines">
            <span className="label text-[10px] text-[var(--color-ink-faint)]">
              outros placares prováveis
            </span>
            <ul className="flex flex-col gap-1">
              {score.rest.map((s) => (
                <li
                  key={s.score}
                  className="flex items-center gap-2"
                  data-scoreline={s.score}
                >
                  <span
                    className="num w-10 shrink-0 text-sm tabular-nums"
                    style={{
                      color: s.isDraw ? "var(--color-ink-muted)" : "var(--color-ink)",
                    }}
                  >
                    {s.score}
                  </span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-[var(--color-line)]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm"
                      style={{
                        width: `${s.barPct}%`,
                        background: s.isDraw
                          ? "var(--color-ink-faint)"
                          : "var(--color-ink-muted)",
                      }}
                    />
                  </div>
                  <span className="num w-9 shrink-0 text-right text-xs text-[var(--color-ink-faint)] tabular-nums">
                    {pct(s.prob)}
                  </span>
                </li>
              ))}
            </ul>
            <span className="text-[10px] text-[var(--color-ink-faint)]">
              top {score.rest.length + 1} cobre ~{pct(score.coverage)} das simulações —
              placar exato é incerto
            </span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 @md/card:grid-cols-3">
          <ProbBar
            label={`Vitória ${homeTeam}`}
            value={sim.p_home}
            accent={teamColor("home")}
          />
          <ProbBar label="Empate" value={sim.p_draw} accent="var(--color-ink-faint)" />
          <ProbBar
            label={`Vitória ${awayTeam}`}
            value={sim.p_away}
            accent={teamColor("away")}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 @md/card:grid-cols-2">
          <ProbBar label="Over 2.5" value={sim.p_over_25} accent="var(--color-depth)" />
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
              Mediana (p50) das 10k iterações por time. Métricas sem split de tempo são
              marcadas <strong>total do jogo</strong>. Posse de bola não é simulada —
              por isso não aparece.
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
              {/*
                Coluna "lado" só a partir de `sm`. Em 412px (Galaxy S23 FE) uma
                4ª coluna colide com o nome do time no cabeçalho e o símbolo é
                cortado na borda — no mobile o sinal vai colado à métrica.
              */}
              <th className="label hidden py-1 text-right font-normal text-[var(--color-ink-faint)] sm:table-cell">
                lado
              </th>
            </tr>
          </thead>
          <tbody>
            {STAT_ROWS.map((r) => {
              const noSplit = r.totalOnly || !sim.per_half_available;
              const signal = SIGNAL_METRICS.has(r.key)
                ? signalFor(sim.sim_stats, r.key as CountMarket)
                : null;
              return (
                <tr
                  key={r.key}
                  className="border-t border-[var(--color-line)]"
                  data-sim-stat={r.key}
                >
                  <td className="py-1.5 text-[var(--color-ink-display)]">
                    {r.label}
                    {signal ? (
                      <span
                        className="num ml-1.5 sm:hidden"
                        title={signal.text}
                        data-sim-signal-inline={r.key}
                      >
                        {signal.symbol}
                      </span>
                    ) : null}
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
                  <td
                    className="num hidden py-1.5 text-right text-[var(--color-ink-display)] sm:table-cell"
                    data-sim-signal={r.key}
                  >
                    {signal ? (
                      <span title={signal.text}>
                        <span aria-hidden>{signal.symbol}</span>
                        <span className="sr-only">{signal.text}</span>
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="label text-[var(--color-ink-faint)]">
          &ldquo;lado&rdquo;: o que a simulação apostaria na linha padrão da casa.{" "}
          <span className="num">+</span> mais / <span className="num">−</span> menos ·
          dobrado = convicção alta · <span className="num">≈</span> em cima do muro.
        </p>
        <p className="label text-[var(--color-ink-faint)]">
          Amostra do modelo: {homeTeam} {sampleSize.home ?? "—"} jogos · {awayTeam}{" "}
          {sampleSize.away ?? "—"} jogos
        </p>
      </section>

      {/* ── Campo: provável escalação ── */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <h4 className="label text-[var(--color-ink-muted)]">Provável escalação</h4>
          <InfoPopover label="sobre a provável escalação">
            <p>
              Esta é a <strong>provável escalação</strong> projetada do histórico de
              minutos/titularidade — <strong>não</strong> é a escalação confirmada. A
              escalação real só sai ~1h antes do jogo.
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
            <PlayerChip
              key={`${p.name}-${idx}`}
              player={p}
              odds={playerOdds?.[p.name]}
            />
          ))}
        </div>
      </section>
    </>
  );
}

export function SimulationPanel({
  sim,
  homeTeam,
  awayTeam,
  sampleSize,
  playerOdds,
  chrome = "shell",
}: SimulationPanelProps) {
  if (!sim) {
    return (
      <Unavailable reason="scraper ainda não computou esta partida" chrome={chrome} />
    );
  }
  if (sim.status === "unsimulable") {
    return <Unavailable reason="dados insuficientes para simular" chrome={chrome} />;
  }

  const body = (
    <SimulationBody
      sim={sim}
      homeTeam={homeTeam}
      awayTeam={awayTeam}
      sampleSize={sampleSize}
      playerOdds={playerOdds}
    />
  );

  if (chrome === "bare") return body;

  return (
    <PanelShell
      title="Simulação pré-jogo"
      gap={4}
      eyebrow={
        <span className="inline-flex items-center gap-1.5">
          Monte Carlo
          <InfoPopover label="o que é a simulação pré-jogo">
            <p>
              Resultado de uma simulação Monte Carlo (10k iterações) computada no
              scraper a partir das médias de temporada. Mostra o placar mais provável,
              probabilidades de mercado e a alocação de eventos por jogador. Não é
              palpite do mercado nem opinião — é a distribuição do modelo.
            </p>
          </InfoPopover>
        </span>
      }
    >
      {body}
    </PanelShell>
  );
}

/**
 * Badge sutil (F3-prod) — sinaliza que as probs 1X2 exibidas foram pós-
 * processadas pela curva isotônica ativa em `model_calibration`. Visual
 * deliberadamente discreto (cinza/muted, mesmo tipo do `BadgeChip` do
 * fixture-card), só pra dar honestidade ao número.
 */
function CalibrationBadge({ n }: { n: number | null }) {
  const label = n != null ? `calibrado (isotônica, n=${n})` : "calibrado (isotônica)";
  return (
    <span
      data-calibrated-via="isotonic"
      title="Probabilidades 1X2 ajustadas pela curva isotônica ativa para este model_version."
      className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] tracking-[0.12em] text-[var(--color-ink-muted)] uppercase"
    >
      {label}
    </span>
  );
}

function PlayerChip({ player, odds }: { player: SimPlayerEvent; odds?: PlayerOdds }) {
  const likelyScorer = player.p_goal >= 0.25;
  const cardProne = player.p_card >= 0.25;
  // Caça-valor manual (sim vs odd da casa) — só quando há odds. Não é
  // recomendação da IA, não é calibrado, não usa histórico. Ver player-market-value.ts.
  const hints = playerMarketHints(
    { p_goal: player.p_goal, p_card: player.p_card, p_sot: player.p_sot },
    odds,
  );
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
        gol {pct(player.p_goal)} · chute {pct(player.p_sot)} · cartão{" "}
        {pct(player.p_card)}
        {Number.isFinite(player.expected_goals)
          ? ` · xG ${Number(player.expected_goals.toFixed(2))}`
          : null}
      </span>
      {hints.length > 0 ? (
        <div data-player-value className="flex flex-col gap-0.5 pt-0.5">
          {hints.map((h) => (
            <span
              key={h.market}
              data-market={h.market}
              data-value={h.value ? "true" : "false"}
              className="num label flex items-center gap-1"
              title="prob do simulador vs prob implícita da odd (inclui margem da casa). Não é recomendação."
            >
              <span className="text-[var(--color-ink-faint)]">{h.market}</span>
              <span className="text-[var(--color-ink-muted)]">
                sim {pct(h.simProb)} · @{Number(h.odd.toFixed(2))} (impl{" "}
                {pct(h.implied)})
              </span>
              {h.value ? (
                <span
                  aria-label="sim vê valor"
                  title="sim acima do implícito (com folga sobre a margem)"
                  style={{ color: "var(--color-positive, #4ade80)" }}
                >
                  ▲
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
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
