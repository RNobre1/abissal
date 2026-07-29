/**
 * "O modelo acerta o quê, nesta liga?" — a ponte entre /calibracao (tela de
 * analista) e o momento da decisão.
 *
 * Regra de honestidade: o acerto NUNCA aparece sozinho. Vem sempre com a
 * taxa-base (acerto de chutar o lado majoritário) e o lift. Sem isso, 71% num
 * mercado enviesado pro under parece competência sem ser — a armadilha
 * documentada em docs/pesquisas/tendencia-recente-poder-preditivo.md.
 *
 * Sem Brier, sem log-loss, sem curva de calibração: isso continua em /calibracao.
 */
import type { LeaguePerformance } from "@/lib/calibracao/league-accuracy-repository";
import type { MarketAccuracy } from "@/lib/calibracao/market-accuracy";

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Pontos percentuais, com o menos tipográfico do design system. */
function pp(x: number): string {
  const v = Math.round(x * 100);
  if (v === 0) return "0pp";
  return `${v > 0 ? "+" : "−"}${Math.abs(v)}pp`;
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/** Barra de 10 blocos — leitura rápida sem arrastar lib de chart pro bundle. */
function Bar({ rate }: { rate: number }) {
  const filled = Math.max(0, Math.min(10, Math.round(rate * 10)));
  return (
    <span aria-hidden className="ml-2 text-[var(--color-ink-faint)]">
      {"▓".repeat(filled)}
      {"░".repeat(10 - filled)}
    </span>
  );
}

/** Uma frase que resume onde confiar e onde não. */
function headline(markets: MarketAccuracy[]): string {
  const ranked = [...markets].sort((a, b) => b.lift - a.lift);
  const bom = ranked[0];
  const ruim = ranked[ranked.length - 1];
  if (!bom) return "";
  const partes: string[] = [];
  if (bom.lift > 0.02) partes.push(`vai bem em ${bom.shortLabel}`);
  if (ruim !== bom && ruim.lift < -0.02) partes.push(`fraco em ${ruim.shortLabel}`);
  return partes.join(" · ") || "sem destaque claro nesta liga";
}

export function ModelPerformancePanel({ perf }: { perf: LeaguePerformance | null }) {
  if (!perf || perf.markets.length === 0) return null;

  const from = shortDate(perf.window.from);
  const to = shortDate(perf.window.to);
  const escopo =
    perf.tier === "liga"
      ? `${perf.league} · ${perf.leagueCalls} apostas medidas`
      : "todas as ligas";

  return (
    <details
      data-testid="model-performance"
      className="rounded-lg border border-[var(--color-line)] p-4"
    >
      <summary className="cursor-pointer list-none">
        <span className="label text-[var(--color-ink-muted)]">
          desempenho do modelo nesta liga ({escopo})
        </span>
        <p className="mt-1 text-sm">{headline(perf.markets)}</p>
      </summary>

      {perf.tier === "global" ? (
        <p className="label mt-3 text-[var(--color-ink-faint)]">
          poucos jogos em {perf.league} ({perf.leagueCalls}) — mostrando o geral de
          todas as ligas
        </p>
      ) : null}

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="label text-[var(--color-ink-faint)]">
            <th className="py-1 text-left font-normal">mercado</th>
            <th className="py-1 text-right font-normal">chamou</th>
            <th className="py-1 text-right font-normal">acertou</th>
            <th className="py-1 text-right font-normal">vs chutar</th>
          </tr>
        </thead>
        <tbody>
          {perf.markets.map((m) => (
            <tr
              key={`${m.market}-${m.line ?? "x"}`}
              title={`IC95 ${pct(m.ci95.lo)}–${pct(m.ci95.hi)} · chutar sempre o lado mais comum acerta ${pct(m.baseRate)}`}
            >
              <td className="py-1">{m.label}</td>
              <td className="num py-1 text-right">{m.calls}</td>
              <td className="num py-1 text-right whitespace-nowrap">
                {pct(m.rate)}
                <Bar rate={m.rate} />
              </td>
              <td
                className={`num py-1 text-right ${
                  m.lift < 0 ? "text-[var(--color-vermelho)]" : ""
                }`}
              >
                {pp(m.lift)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="label mt-2 text-[var(--color-ink-faint)]">
        &ldquo;vs chutar&rdquo; compara com apostar sempre no lado mais comum da liga.
        Perto de zero significa que o modelo não sabe nada ali.
        {from && to ? ` Medido de ${from} a ${to}.` : ""}
      </p>
    </details>
  );
}
