"use client";

/**
 * BetsSelectFilters — Client Component com os selects de liga/mercado da
 * página /bets. Extrai a lógica de navegação (router.push) para um
 * componente isolado, pois o `<select onChange>` requer interatividade
 * client-side (Wave B fix #5).
 *
 * O bug pré-existente: os selects no Server Component tinham `onChange={() => {}}`
 * vazios — mudança de valor não navegava para nenhuma URL.
 *
 * Fix: cada select chama `router.push(newUrl)` no onChange, preservando
 * os filtros ativos (status, house, mercado/liga).
 */

import { useRouter } from "next/navigation";

export interface BetsSelectFiltersProps {
  availableLeagues: string[];
  availableMarkets: Array<{ id: string; name: string }>;
  currentLeague: string | undefined;
  currentMarketId: string | undefined;
  /**
   * URL base com query string de outros filtros ativos (status, house).
   * Ex: `/bets?status=pending&house=bet365`.
   * Os filtros de liga/mercado serão adicionados/substituídos aqui.
   */
  baseHref: string;
}

/**
 * Constrói a nova URL preservando todos os params ativos exceto
 * `league` e `market`, que são substituídos pelos novos valores.
 */
function buildUrl(
  baseHref: string,
  newLeague: string | undefined,
  newMarket: string | undefined,
): string {
  // Extrai base + params existentes
  const [basePath, baseQuery = ""] = baseHref.split("?");
  const params = new URLSearchParams(baseQuery);

  // Remove os filtros que serão substituídos
  params.delete("league");
  params.delete("market");

  if (newLeague) params.set("league", newLeague);
  if (newMarket) params.set("market", newMarket);

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : (basePath ?? "/bets");
}

export function BetsSelectFilters({
  availableLeagues,
  availableMarkets,
  currentLeague,
  currentMarketId,
  baseHref,
}: BetsSelectFiltersProps) {
  const router = useRouter();

  if (availableLeagues.length === 0 && availableMarkets.length === 0) {
    return null;
  }

  function handleLeagueChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value || undefined;
    router.push(buildUrl(baseHref, value, currentMarketId));
  }

  function handleMarketChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value || undefined;
    router.push(buildUrl(baseHref, currentLeague, value));
  }

  return (
    <div className="mb-6 flex flex-wrap gap-3">
      {availableLeagues.length > 0 && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="league-filter"
            className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]"
          >
            liga
          </label>
          <select
            id="league-filter"
            value={currentLeague ?? ""}
            onChange={handleLeagueChange}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-vermelho)]"
          >
            <option value="">todas</option>
            {availableLeagues.map((lg) => (
              <option key={lg} value={lg}>
                {lg}
              </option>
            ))}
          </select>
        </div>
      )}
      {availableMarkets.length > 0 && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="market-filter"
            className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]"
          >
            mercado
          </label>
          <select
            id="market-filter"
            value={currentMarketId ?? ""}
            onChange={handleMarketChange}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-vermelho)]"
          >
            <option value="">todos</option>
            {availableMarkets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
