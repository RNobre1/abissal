/**
 * ChampionChallengerCard — Arena champion-challenger (ADR-011), display-only.
 *
 * Mostra o champion ativo, cada challenger em shadow com barra comparativa de
 * log-loss e badge de veredito. NÃO faz I/O — quem busca é a page.tsx.
 *
 * Server Component (sem "use client") — zero bundle client. Barras CSS puras.
 */

export interface ChampionSummary {
  modelVersion: string;
  /** Número de predições resolvidas. */
  n: number;
  /** Log-loss médio. */
  meanLogLoss: number;
}

export interface ChallengerSummary {
  modelVersion: string;
  n: number;
  meanLogLoss: number;
  /** meanDelta = ll_champion − ll_challenger (>0 ⇒ challenger melhor). */
  meanDelta: number;
  verdict: "challenger_better" | "champion_better" | "inconclusive";
  pDeflated: number;
}

export interface ChampionChallengerCardProps {
  champion: ChampionSummary | null;
  challengers: ChallengerSummary[];
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function fmtLL(v: number): string {
  return Number.isFinite(v) ? v.toFixed(4) : "—";
}

function fmtDelta(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(4);
}

function fmtP(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return p < 0.001 ? "<.001" : p.toFixed(3);
}

type BadgeColor = "green" | "vermelho" | "neutral";

interface VerdictBadgeProps {
  verdict: ChallengerSummary["verdict"];
}

function VerdictBadge({ verdict }: VerdictBadgeProps) {
  const map: Record<ChallengerSummary["verdict"], { label: string; color: BadgeColor }> = {
    challenger_better: { label: "challenger melhor", color: "green" },
    champion_better:   { label: "champion melhor",   color: "vermelho" },
    inconclusive:      { label: "inconclusivo",       color: "neutral" },
  };
  const { label, color } = map[verdict];
  const style =
    color === "green"
      ? "var(--color-green, #22c55e)"
      : color === "vermelho"
      ? "var(--color-vermelho)"
      : "var(--color-ink-faint)";
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]"
      style={{ color: style, background: "var(--color-line)", border: `1px solid ${style}` }}
    >
      {label}
    </span>
  );
}

interface LogLossBarProps {
  /** Valor a representar. */
  value: number;
  /** Valor de escala máxima da barra (usa o maior log-loss da página). */
  scale: number;
  /** Cor da barra. */
  color: string;
  /** Label à esquerda. */
  label: string;
  /** Valor formatado à direita. */
  valueLabel: string;
  emphasis?: boolean;
}

function LogLossBar({ value, scale, color, label, valueLabel, emphasis }: LogLossBarProps) {
  const widthPct = Number.isFinite(value) && scale > 0
    ? Math.max(0, Math.min(100, (value / scale) * 100))
    : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-[var(--color-ink-faint)]">{label}</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-[var(--color-line)]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{ width: `${widthPct}%`, background: color }}
        />
      </div>
      <span
        className="num w-14 shrink-0 text-right text-xs tabular-nums"
        style={{
          color: emphasis ? "var(--color-ink)" : "var(--color-ink-muted)",
          fontWeight: emphasis ? 600 : 400,
        }}
      >
        {valueLabel}
      </span>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ChampionChallengerCard({ champion, challengers }: ChampionChallengerCardProps) {
  return (
    <div
      data-section="champion-challenger"
      className="card flex flex-col gap-5 p-5 lg:p-6"
    >
      {/* Cabeçalho */}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="label text-[var(--color-ink-muted)]">
            Champion vs Challengers (shadow)
          </span>
          {champion && (
            <span className="label text-[10px] text-[var(--color-ink-faint)]">
              champion n={champion.n}
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--color-ink-faint)]">
          Modelos em shadow rodam em paralelo sem afetar apostas. Comparação por
          log-loss + bootstrap pareado deflacionado (Bonferroni). Promoção de
          challenger a champion é decisão humana — ADR-011.
        </p>
      </div>

      {/* Champion */}
      {champion == null ? (
        <p className="text-sm text-[var(--color-ink-faint)]">
          Nenhum champion registrado ainda — aplique a migration 0049 para ativar a arena.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="label text-[11px] text-[var(--color-ink-muted)]">Champion ativo</span>
          <div className="flex items-center gap-3">
            <span className="rounded bg-[var(--color-line)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink)]">
              {champion.modelVersion}
            </span>
            <span className="num text-xs tabular-nums text-[var(--color-ink-muted)]">
              log-loss {fmtLL(champion.meanLogLoss)}
            </span>
            <span className="num text-xs tabular-nums text-[var(--color-ink-faint)]">
              n={champion.n}
            </span>
          </div>
        </div>
      )}

      {/* Challengers */}
      {champion != null && challengers.length === 0 ? (
        <div className="border-t border-[var(--color-line-subtle)] pt-4">
          <p className="text-sm text-[var(--color-ink-faint)]">
            Nenhum challenger registrado ainda — a arena está pronta; challengers
            entram em shadow na próxima onda.
          </p>
        </div>
      ) : challengers.length > 0 ? (
        <div className="flex flex-col gap-6 border-t border-[var(--color-line-subtle)] pt-4">
          <span className="label text-[11px] text-[var(--color-ink-muted)]">Challengers</span>
          {challengers.map((chal) => {
            // Escala para a barra: o maior log-loss entre champion e challenger + 10% de folga.
            const scale =
              Math.max(
                Number.isFinite(champion?.meanLogLoss ?? NaN) ? (champion!.meanLogLoss) : 0,
                Number.isFinite(chal.meanLogLoss) ? chal.meanLogLoss : 0,
              ) * 1.1 || 1;

            return (
              <div key={chal.modelVersion} className="flex flex-col gap-2">
                {/* Linha de identidade + veredito */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-[var(--color-line)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink)]">
                    {chal.modelVersion}
                  </span>
                  <span className="num text-xs tabular-nums text-[var(--color-ink-faint)]">n={chal.n}</span>
                  <VerdictBadge verdict={chal.verdict} />
                </div>

                {/* Barras comparativas de log-loss */}
                {champion && (
                  <>
                    <LogLossBar
                      label="champion"
                      value={champion.meanLogLoss}
                      scale={scale}
                      color="var(--color-ink-faint)"
                      valueLabel={fmtLL(champion.meanLogLoss)}
                    />
                    <LogLossBar
                      label="challenger"
                      value={chal.meanLogLoss}
                      scale={scale}
                      color={
                        chal.verdict === "challenger_better"
                          ? "var(--color-green, #22c55e)"
                          : chal.verdict === "champion_better"
                          ? "var(--color-vermelho)"
                          : "var(--color-ink-muted)"
                      }
                      valueLabel={fmtLL(chal.meanLogLoss)}
                      emphasis={chal.verdict === "challenger_better"}
                    />
                  </>
                )}

                {/* Linha de estatísticas */}
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-0.5">
                  <span className="text-[10px] text-[var(--color-ink-faint)]">
                    Δ médio: <span className="num tabular-nums">{fmtDelta(chal.meanDelta)}</span>
                    {" "}<span className="text-[var(--color-ink-faint)]">(+ ⇒ challenger melhor)</span>
                  </span>
                  <span className="text-[10px] text-[var(--color-ink-faint)]">
                    p deflacionado: <span className="num tabular-nums">{fmtP(chal.pDeflated)}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Nota rodapé */}
      <p className="text-[10px] text-[var(--color-ink-faint)]">
        Paired bootstrap 2000 amostras · correção Bonferroni (k challengers) · alpha 5% ·
        log-loss convencional (menor = melhor). Refit do champion = decisão manual por evidência (B24).
      </p>
    </div>
  );
}
