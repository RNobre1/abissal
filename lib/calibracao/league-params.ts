/**
 * MoM (method of moments) estimators sobre simulações resolvidas
 * agrupadas por liga. Pure / determinístico.
 *
 * Estimação:
 *   - avg_goals_home   = média de actual_home_goals (apenas)
 *   - avg_goals_away   = média de actual_away_goals (apenas)
 *   - avg_goals_for/ag = (sum_home + sum_away) / (2n)  — simetria
 *   - rho              = cov(home, away) / (sd_h * sd_a), clampado em
 *                        [-0.3, 0.05]; DEFAULT_RHO (-0.10) quando insuficiente
 *
 * NÃO calibra `K` (shrinkage) — fica como follow-up F4c (precisa optimização
 * real, não MoM).
 *
 * Liga com n < minSamples (30 por padrão) é pulada silenciosamente.
 * `priorityLeagues` permite override por liga (threshold mais brando) — ligas
 * que passam pelo override mas estão abaixo de STRICT_THRESHOLD recebem
 * `low_confidence = true` para a UI sinalizar.
 */

export interface ResolvedSample {
  league: string;
  home_goals: number;
  away_goals: number;
}

export interface LeagueParams {
  league: string;
  n: number;
  avg_goals_for: number;
  avg_goals_ag: number;
  avg_goals_home: number;
  avg_goals_away: number;
  rho: number;
  /**
   * `true` quando n < STRICT_THRESHOLD (30) — calibração rodou só porque a
   * liga estava no `priorityLeagues` override. UI usa pra mostrar badge
   * "baixa confiança".
   */
  low_confidence: boolean;
}

export interface FitOptions {
  /**
   * Map liga → minSamples customizado (mais brando que o default global).
   * Liga não-mapeada usa o `minSamples` global do call.
   */
  priorityLeagues?: ReadonlyMap<string, number>;
}

const RHO_MIN = -0.3;
const RHO_MAX = 0.05;
const DEFAULT_RHO = -0.1;
const STRICT_THRESHOLD = 30;

export function fitLeagueParams(
  samples: ResolvedSample[],
  minSamples = 30,
  options: FitOptions = {},
): LeagueParams[] {
  const priority = options.priorityLeagues;
  const byLeague = new Map<string, ResolvedSample[]>();
  for (const s of samples) {
    if (!s.league) continue;
    if (!Number.isFinite(s.home_goals) || !Number.isFinite(s.away_goals))
      continue;
    const list = byLeague.get(s.league) ?? [];
    list.push(s);
    byLeague.set(s.league, list);
  }

  const out: LeagueParams[] = [];
  for (const [league, list] of byLeague.entries()) {
    const effectiveMin = priority?.get(league) ?? minSamples;
    if (list.length < effectiveMin) continue;
    const n = list.length;
    const sumH = list.reduce((a, s) => a + s.home_goals, 0);
    const sumA = list.reduce((a, s) => a + s.away_goals, 0);
    const meanH = sumH / n;
    const meanA = sumA / n;

    let cov = 0;
    let varH = 0;
    let varA = 0;
    for (const s of list) {
      const dh = s.home_goals - meanH;
      const da = s.away_goals - meanA;
      cov += dh * da;
      varH += dh * dh;
      varA += da * da;
    }
    cov /= n;
    varH /= n;
    varA /= n;
    const sdH = Math.sqrt(varH);
    const sdA = Math.sqrt(varA);
    let rho = sdH > 0 && sdA > 0 ? cov / (sdH * sdA) : DEFAULT_RHO;
    if (!Number.isFinite(rho)) rho = DEFAULT_RHO;
    rho = Math.max(RHO_MIN, Math.min(RHO_MAX, rho));

    const totalGoals = sumH + sumA;
    const meanFor = totalGoals / (2 * n);

    out.push({
      league,
      n,
      avg_goals_for: meanFor,
      avg_goals_ag: meanFor,
      avg_goals_home: meanH,
      avg_goals_away: meanA,
      rho,
      low_confidence: n < STRICT_THRESHOLD,
    });
  }
  return out.sort((a, b) => b.n - a.n);
}
