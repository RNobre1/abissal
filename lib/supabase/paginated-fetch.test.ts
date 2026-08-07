import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, POSTGREST_MAX_ROWS } from "./paginated-fetch";

/**
 * Dublê fiel ao PostgREST: ele NUNCA devolve mais que `POSTGREST_MAX_ROWS`
 * numa resposta, por mais alto que seja o `.limit()`. Um mock que devolvesse
 * 5.000 de uma vez seria mais generoso que a produção — e foi exatamente essa
 * diferença que deixou o `.limit(5000)` do `fit-isotonic.ts` truncar em
 * silêncio por meses.
 */
function fakeTable(totalRows: number, pageCap = POSTGREST_MAX_ROWS) {
  const todas = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  return vi.fn(async (from: number, to: number) => {
    const fatia = todas.slice(from, Math.min(to + 1, from + pageCap));
    return { data: fatia, error: null };
  });
}

describe("fetchAllPages", () => {
  it("junta todas as páginas quando a tabela excede o teto do PostgREST", async () => {
    const query = fakeTable(2350);
    const linhas = await fetchAllPages(query);
    expect(linhas).toHaveLength(2350);
    expect(linhas[0]).toEqual({ id: 0 });
    expect(linhas[2349]).toEqual({ id: 2349 });
  });

  it("para na primeira página parcial, sem chamada extra", async () => {
    const query = fakeTable(1500);
    await fetchAllPages(query);
    // 1000 (cheia) + 500 (parcial) = 2 chamadas. Uma terceira seria desperdício.
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("pede faixas contíguas e sem sobreposição", async () => {
    const query = fakeTable(2100);
    await fetchAllPages(query);
    expect(query.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("devolve vazio para tabela vazia, numa única chamada", async () => {
    const query = fakeTable(0);
    expect(await fetchAllPages(query)).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("faz exatamente uma chamada quando o total é múltiplo exato da página", async () => {
    const query = fakeTable(2000);
    const linhas = await fetchAllPages(query);
    expect(linhas).toHaveLength(2000);
    // 1000 + 1000 + 0 → a terceira é necessária para saber que acabou.
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("propaga o erro do PostgREST em vez de devolver dado parcial", async () => {
    const query = vi.fn(async (from: number) =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
        : { data: null, error: { message: "boom" } },
    );
    await expect(fetchAllPages(query)).rejects.toThrow(/boom/);
  });

  it("respeita maxRows e não busca além do necessário", async () => {
    const query = fakeTable(10_000);
    const linhas = await fetchAllPages(query, { maxRows: 1500 });
    expect(linhas).toHaveLength(1500);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("aceita pageSize menor para consultas de payload pesado", async () => {
    const query = fakeTable(450, 200);
    const linhas = await fetchAllPages(query, { pageSize: 200 });
    expect(linhas).toHaveLength(450);
    expect(query.mock.calls).toEqual([
      [0, 199],
      [200, 399],
      [400, 599],
    ]);
  });

  it("nunca aceita pageSize acima do teto do PostgREST — seria mentira", () => {
    expect(() => fetchAllPages(fakeTable(10), { pageSize: 5000 })).toThrow(
      /pageSize/i,
    );
  });
});
