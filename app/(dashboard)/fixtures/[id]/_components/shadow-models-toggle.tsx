import type { CardsShadowRow } from "@/lib/fixtures/shadow-card-predictions";

/**
 * Toggle EXPERIMENTAL no detalhe do jogo: mostra, pra ESTE jogo, o que cada
 * modelo da arena (ADR-011) preveria pros cartões — champion (NB) vs challenger
 * (CMP), com a mesma média da sim, isolando a FORMA da distribuição.
 *
 * É a representação INTERNA da arena (comparação de modelos), NÃO as probs
 * calibradas de aposta (essas usam isotônica/k e estão no painel principal).
 * Componente SÍNCRONO (os dados são buscados/computados na página, async) —
 * <details> puro (sem JS). Renderiza null quando não há linhas.
 */

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

interface Props {
  rows: CardsShadowRow[];
  /** ν do CMP challenger e r do NB champion ativos (rótulo). */
  nu: number | null;
  r: number | null;
}

export function ShadowModelsToggle({ rows, nu, r }: Props) {
  if (!rows || rows.length === 0) return null;

  return (
    <details
      data-section="shadow-models"
      className="mt-4 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2,transparent)]"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-[var(--color-ink-muted)]">
        Modelos em teste (shadow) — cartões ⚗️
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <p className="text-[10px] text-[var(--color-ink-faint)]">
          Comparação INTERNA da arena (ADR-011): o que cada modelo preveria pros
          cartões deste jogo, mesma média, formas diferentes. <strong>Não</strong>{" "}
          são as probs calibradas de aposta (painel acima) — é experimental,
          não-apostável.
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-[var(--color-ink-faint)]">
              <th className="text-left font-normal">cartões</th>
              <th className="text-right font-normal">Poisson</th>
              <th className="text-right font-normal">NB (champion)</th>
              <th className="text-right font-normal">CMP (challenger)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.line} className="num tabular-nums">
                <td className="text-left text-[var(--color-ink-muted)]">over {row.line}</td>
                <td className="text-right text-[var(--color-ink-faint)]">{pct(row.poissonOver)}</td>
                <td className="text-right text-[var(--color-ink)]">{pct(row.nbOver)}</td>
                <td className="text-right text-[var(--color-ink)]">{pct(row.cmpOver)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {nu != null && r != null ? (
          <p className="text-[10px] text-[var(--color-ink-faint)]">
            champion = NB (r={r}) · challenger = CMP (ν={nu}). Veredito agregado +
            as 2 semanas de baking em <code>/calibracao</code> (Champion vs Challengers).
          </p>
        ) : null}
      </div>
    </details>
  );
}
