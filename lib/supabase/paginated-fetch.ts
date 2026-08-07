/**
 * POR QUE EXISTE (medido 07/08/2026): o PostgREST corta toda resposta em
 * `POSTGREST_MAX_ROWS` linhas, independentemente do `.limit()` pedido. Havia 15+
 * chamadas no repositório com `.limit(2000)`…`.limit(50000)` acreditando estar
 * lendo tudo. Efeito concreto: `fit-isotonic.ts` calibra sobre 1.000 das 4.895
 * simulações resolvidas — e o veredito do gate out-of-sample MUDA com o tamanho
 * da amostra (com 1.000 o v8 aprovava `over25`; com 4.895 ele rejeita).
 *
 * Truncar em silêncio é pior que falhar: a query devolve dado plausível.
 */

/** Teto de linhas por resposta do PostgREST (`db-max-rows`, default do Supabase). */
export const POSTGREST_MAX_ROWS = 1000;

export interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

/** Constrói e executa UMA página. `from`/`to` são inclusivos, como `.range()`. */
export type PageQuery<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

export interface FetchAllPagesOptions {
  /** Linhas por página. Não pode exceder `POSTGREST_MAX_ROWS`. */
  pageSize?: number;
  /** Corta a leitura ao atingir este total. Ausente = lê até esgotar. */
  maxRows?: number;
}

export function fetchAllPages<T>(
  query: PageQuery<T>,
  options?: FetchAllPagesOptions,
): Promise<T[]> {
  const pageSize = options?.pageSize ?? POSTGREST_MAX_ROWS;
  if (pageSize > POSTGREST_MAX_ROWS) {
    throw new Error(
      `fetchAllPages: pageSize (${pageSize}) não pode exceder POSTGREST_MAX_ROWS (${POSTGREST_MAX_ROWS}) — o PostgREST truncaria em silêncio.`,
    );
  }
  const maxRows = options?.maxRows;

  return (async () => {
    const rows: T[] = [];
    let from = 0;

    for (;;) {
      const to = from + pageSize - 1;
      const { data, error } = await query(from, to);

      if (error) {
        throw error instanceof Error
          ? error
          : new Error(String((error as { message?: unknown } | null)?.message ?? error));
      }

      const page = data ?? [];
      rows.push(...page);

      if (maxRows !== undefined && rows.length >= maxRows) {
        return rows.slice(0, maxRows);
      }

      if (page.length < pageSize) {
        return rows;
      }

      from += pageSize;
    }
  })();
}
