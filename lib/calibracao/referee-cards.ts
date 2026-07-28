/**
 * Predição de CARTÕES usando o perfil do árbitro.
 *
 * O ACHADO que motiva isto (medido em 28/07 sobre 118 fixtures com perfil
 * rico): **a dispersão dos cartões não é uma propriedade global do esporte —
 * varia por árbitro**. Na amostra: 45 árbitros over-dispersos, 42
 * sub-dispersos, 31 ≈Poisson, com mediana 1.02.
 *
 * Isso reinterpreta o debate das lições B34-B37. A pesquisa Big-5 dizia
 * sub-dispersão (ν 1.11–1.46); a nossa data global disse over-dispersão
 * (ν≈0.65); e o challenger CMP com ν GLOBAL ficou inconclusivo. Todos podiam
 * estar certos: fitar um ν único é fitar a média de duas populações opostas,
 * o que dá ≈Poisson — exatamente o resultado nulo observado.
 *
 * Aqui o ν é derivado da dispersão DAQUELE árbitro, e a média mistura a
 * simulação com o histórico dele — em CARTÕES, não em booking points. O F6 do
 * gerador usa `avg_total_booking_points` (amarelo=10, vermelho=25), uma
 * unidade composta que não é a do mercado; o perfil novo traz a contagem real.
 *
 * Puro, sem I/O. Consumido pelo challenger da arena (shadow) — não toca
 * produção. Promoção segue humana e gated (ADR-011).
 */

import { cmpVariance } from "./cmp";

/**
 * Peso do árbitro no blend da média. Mantido igual ao do F6 (0.4) de
 * propósito: o challenger testa a UNIDADE (cartões vs booking points) e a
 * FORMA (ν por árbitro), não o peso. Mudar duas coisas de uma vez torna o
 * veredito da arena inútil.
 */
export const REFEREE_WEIGHT = 0.4;

/** Faixa de ν varrida. Cobre over-dispersão forte (0.2) a sub-dispersão (4). */
const NU_MIN = 0.2;
const NU_MAX = 4;
const NU_STEP = 0.05;

function usable(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

/**
 * Média de cartões do jogo: mistura a média da simulação com o histórico do
 * árbitro. Sem dado de árbitro, devolve a média da sim intacta.
 */
export function blendCardMean(
  simMean: number,
  refereeMean: number | null | undefined,
): number {
  const base = Number.isFinite(simMean) && simMean > 0 ? simMean : 0.01;
  if (!usable(refereeMean)) return base;
  const blended = (1 - REFEREE_WEIGHT) * base + REFEREE_WEIGHT * refereeMean;
  return blended > 0 ? blended : 0.01;
}

/**
 * Acha o ν da Conway-Maxwell-Poisson cuja razão variância/média mais se
 * aproxima da dispersão observada do árbitro.
 *
 * Convenção do CMP: ν = 1 é Poisson, ν < 1 é over-disperso, ν > 1 é
 * sub-disperso. Como não há forma fechada para var/média em função de ν,
 * varremos a grade e ficamos com o melhor — barato o suficiente (uma vez por
 * fixture) e sem depender de aproximação assintótica, que erra feio para
 * médias pequenas como as de cartões.
 *
 * Sem dispersão utilizável devolve 1 (Poisson) — degradação graciosa, mesmo
 * contrato tri-state do resto do projeto.
 */
export function nuForDispersion(
  mean: number,
  dispersion: number | null | undefined,
): number {
  if (!usable(mean) || !usable(dispersion)) return 1;

  let bestNu = 1;
  let bestErr = Number.POSITIVE_INFINITY;

  for (let nu = NU_MIN; nu <= NU_MAX + 1e-9; nu += NU_STEP) {
    const v = cmpVariance(mean, nu);
    if (!Number.isFinite(v) || v <= 0) continue;
    const err = Math.abs(v / mean - dispersion);
    if (err < bestErr) {
      bestErr = err;
      bestNu = Number(nu.toFixed(2));
    }
  }
  return bestNu;
}
