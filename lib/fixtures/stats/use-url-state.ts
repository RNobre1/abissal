"use client";

/**
 * Helpers de URL-state compartilhados pelos painéis interativos
 * (`streaks-heatmap`, `players`).
 *
 * Idéia: cada filtro tem uma chave querystring (`streaks`, `min_perc`,
 * `player_rank`) e queremos `router.replace(...)` com merge + comparação
 * contra default para evitar params redundantes na URL.
 *
 * `commitUrlState` é puro (recebe `currentParams` + patch + `defaults`,
 * devolve `nextSearch`); o hook `useUrlPatcher` injeta `router`/`pathname`/
 * `searchParams` e expõe um callback ergonômico.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

/**
 * Aplica um patch ({ key: value | null }) sobre `current`, removendo
 * entradas iguais ao default — mantém a URL enxuta (deep-link compartilhável
 * sem ruído).
 *
 * - `null` (ou string vazia) → remove a chave
 * - valor igual ao default → remove a chave
 * - caso contrário, atualiza/insere
 */
export function commitUrlState(
  current: URLSearchParams,
  patch: Record<string, string | null>,
  defaults: Record<string, string>,
): string {
  const params = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "" || value === defaults[key]) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  return params.toString();
}

/**
 * Hook ergonômico para os painéis Client: devolve uma função
 * `patch({ key: value })` que faz `router.replace` sem scroll.
 *
 * `defaults` é o mapa de chaves → valor default canônico — útil pra
 * limpar parâmetros redundantes da URL (ex.: `player_rank=goals` é o
 * padrão e some quando o user volta pra esse critério).
 *
 * ⚠️ Passe `defaults` como objeto **referencialmente estável** — module-level
 * `const` ou `useMemo(() => …, [])`. O `useCallback` interno inclui `defaults`
 * nas deps, então um objeto inline (`{ min_perc: "60" }` dentro do render)
 * invalida o callback a cada render e dispara `router.replace` em loop nos
 * handlers que dependem dele.
 */
export function useUrlPatcher(defaults: Record<string, string>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (patch: Record<string, string | null>) => {
      const qs = commitUrlState(searchParams, patch, defaults);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, defaults],
  );
}
