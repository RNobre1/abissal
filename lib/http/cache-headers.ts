/**
 * Cache-Control para assets estáticos versionados por hash na URL.
 *
 * Lição B21 (revisão de perf 2026-05-29): o favicon do app-dir era servido com
 * `cache-control: public, max-age=0, must-revalidate`, forçando o browser a
 * revalidar em TODA navegação — 74 refetches numa sessão de ~12 min (8,6 s
 * acumulados, picos de 1,45 s). A `<link rel="icon">` do Next já carrega um hash
 * de versão na query (`/favicon.ico?<hash>`), então cache imutável de 1 ano é
 * seguro: muda a URL quando o ícone muda.
 */

/** `public, max-age=31536000, immutable` — 1 ano, sem revalidação. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/**
 * Regras para `headers()` do next.config — força Cache-Control imutável em
 * assets estáticos cujo default do Next é fraco (`max-age=0`). Consumido por
 * `next.config.ts`. Mantido como módulo puro para ser testável sem importar o
 * next.config inteiro (que tem side-effect de bootstrap do OpenNext em dev).
 */
export function staticAssetHeaders(): HeaderRule[] {
  return [
    {
      source: "/favicon.ico",
      headers: [{ key: "Cache-Control", value: IMMUTABLE_CACHE_CONTROL }],
    },
  ];
}
