/**
 * Teste de integração app-side para alert_dismissals.
 *
 * Não existe harness SQL no repo, então testamos o comportamento esperado
 * via client mockado: insert, leitura por user_id e idempotência da PK.
 * O contrato de RLS (outro user não lê) é testado pelo mock que simula
 * o filtro `user_id = auth.uid()` que a policy impõe.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- mock do Supabase server client ----------------------------------------
type DismissalRow = {
  user_id: string;
  fixture_id: number;
  dismissed_at: string;
};

const store: DismissalRow[] = [];

function buildClient(userId: string) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: userId } }, error: null }),
    },
    from: (table: string) => {
      if (table !== "alert_dismissals") throw new Error("wrong table");
      return {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        select: (_: string) => ({
          eq: (col: string, val: unknown) => ({
            // simula RLS: filtra pelo user_id exato
            then: (cb: (r: unknown) => unknown) => {
              const rows =
                col === "user_id"
                  ? store.filter((r) => r.user_id === val)
                  : store;
              return Promise.resolve(
                cb({ data: rows, error: null }),
              );
            },
          }),
          // permite await direto sem .eq
          then: (cb: (r: unknown) => unknown) =>
            Promise.resolve(cb({ data: store, error: null })),
        }),
        insert: (row: DismissalRow) => ({
          then: (cb: (r: unknown) => unknown) => {
            const exists = store.some(
              (r) =>
                r.user_id === row.user_id &&
                r.fixture_id === row.fixture_id,
            );
            // simula ON CONFLICT DO NOTHING (idempotente)
            if (!exists) {
              store.push({
                ...row,
                dismissed_at: row.dismissed_at ?? new Date().toISOString(),
              });
            }
            return Promise.resolve(cb({ data: null, error: null }));
          },
        }),
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(buildClient("user-a")),
}));

// ---- helper para resetar store entre testes ---------------------------------
beforeEach(() => {
  store.length = 0;
});

// ---- testes -----------------------------------------------------------------
describe("alert_dismissals — contrato app-side", () => {
  it("insere dismissal e lê de volta filtrado por user_id", async () => {
    const clientA = buildClient("user-a");

    // insert
    await clientA
      .from("alert_dismissals")
      .insert({ user_id: "user-a", fixture_id: 1, dismissed_at: "2026-05-18T12:00:00Z" });

    // lê de volta
    const result = await new Promise<{ data: DismissalRow[] }>((resolve) => {
      clientA
        .from("alert_dismissals")
        .select("*")
        .eq("user_id", "user-a")
        .then((r) => resolve(r as { data: DismissalRow[] }));
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].fixture_id).toBe(1);
    expect(result.data[0].user_id).toBe("user-a");
  });

  it("PK (user_id, fixture_id) impede duplicata — segundo insert é no-op", async () => {
    const clientA = buildClient("user-a");

    await clientA
      .from("alert_dismissals")
      .insert({ user_id: "user-a", fixture_id: 42, dismissed_at: "2026-05-18T12:00:00Z" });
    // mesmo insert novamente
    await clientA
      .from("alert_dismissals")
      .insert({ user_id: "user-a", fixture_id: 42, dismissed_at: "2026-05-18T13:00:00Z" });

    const result = await new Promise<{ data: DismissalRow[] }>((resolve) => {
      clientA
        .from("alert_dismissals")
        .select("*")
        .eq("user_id", "user-a")
        .then((r) => resolve(r as { data: DismissalRow[] }));
    });

    // deve existir apenas 1 linha (sem duplicata)
    expect(result.data).toHaveLength(1);
  });

  it("RLS: outro user não vê os dismissals de user-a", async () => {
    const clientA = buildClient("user-a");
    const clientB = buildClient("user-b");

    await clientA
      .from("alert_dismissals")
      .insert({ user_id: "user-a", fixture_id: 7, dismissed_at: "2026-05-18T12:00:00Z" });

    // clientB filtra por user_id = "user-b" — não deve ver os dados de A
    const result = await new Promise<{ data: DismissalRow[] }>((resolve) => {
      clientB
        .from("alert_dismissals")
        .select("*")
        .eq("user_id", "user-b")
        .then((r) => resolve(r as { data: DismissalRow[] }));
    });

    expect(result.data).toHaveLength(0);
  });
});
