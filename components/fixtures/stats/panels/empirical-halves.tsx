/**
 * Painel — frequência empírica por tempo (últimos jogos), por time.
 *
 * Complementa o painel de MÉDIAS (`Splits1h2h`) com a FREQUÊNCIA real:
 * "em quantos dos últimos jogos o time fez 2+ gols/escanteios em cada tempo".
 * Display-only — base-rate de conferência, fora de modelo/calibração.
 *
 * Honestidade de cobertura: gols por tempo (HT) vêm ~100% preenchidos;
 * escanteios por tempo só em ~53% dos jogos — por isso cada célula mostra
 * "feitos/elegíveis" (não finge denominador cheio) e os escanteios levam (*).
 */

import { PanelShell } from "@/components/fixtures/stats/panels/_shell";
import type { NormalizedRecentMatch } from "@/lib/fixtures/stats/detail-json-types";
import {
  type RateOverEligible,
  goals2PlusInHalfRate,
  corners2PlusInHalfRate,
  corners2PlusBothHalvesRate,
  blewHalftime2LeadRate,
} from "@/lib/fixtures/stats/empirical-halves";

interface Props {
  homeTeam: string;
  awayTeam: string;
  home: NormalizedRecentMatch[];
  away: NormalizedRecentMatch[];
}

interface RowDef {
  label: string;
  /** escanteios dependem do split por-tempo (~53% fill) → marca (*). */
  partial?: boolean;
  of: (m: NormalizedRecentMatch[]) => RateOverEligible;
}

const ROWS: RowDef[] = [
  { label: "Gol 2+ 1ºT", of: (m) => goals2PlusInHalfRate(m, "1h") },
  { label: "Gol 2+ 2ºT", of: (m) => goals2PlusInHalfRate(m, "2h") },
  { label: "Escanteio 2+ 1ºT", partial: true, of: (m) => corners2PlusInHalfRate(m, "1h") },
  { label: "Escanteio 2+ 2ºT", partial: true, of: (m) => corners2PlusInHalfRate(m, "2h") },
  { label: "Cantos 2+/2+", partial: true, of: corners2PlusBothHalvesRate },
  { label: "Abriu 2 no HT, não venceu", of: blewHalftime2LeadRate },
];

function cell(r: RateOverEligible): string {
  if (r.rate === null) return "—";
  return `${r.made}/${r.eligible} · ${Math.round(r.rate * 100)}%`;
}

export function EmpiricalHalves({ homeTeam, awayTeam, home, away }: Props) {
  return (
    <PanelShell title="por tempo — empírico" eyebrow="últimos jogos">
      <table className="w-full text-sm" data-empirical-halves>
        <thead>
          <tr className="text-[var(--color-ink-faint)]">
            <th className="label text-left font-normal"> </th>
            <th className="label text-right font-normal">{homeTeam}</th>
            <th className="label text-right font-normal">{awayTeam}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label} data-metric={row.label}>
              <td className="label py-1 text-[var(--color-ink-faint)]">
                {row.label}
                {row.partial ? <span title="dado por tempo em ~metade dos jogos">*</span> : null}
              </td>
              <td className="num py-1 text-right text-[var(--color-ink-display)]" data-side="home">
                {cell(row.of(home))}
              </td>
              <td className="num py-1 text-right text-[var(--color-ink-display)]" data-side="away">
                {cell(row.of(away))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
        * escanteios por tempo só em ~metade dos jogos (mostrado feitos/elegíveis).
        “Abriu 2 no HT” é parcial (não pega vantagem aberta no 2º tempo).
      </p>
    </PanelShell>
  );
}
