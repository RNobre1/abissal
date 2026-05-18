/**
 * dismissAlert() deve ser idempotente no nível do PostgREST: o plano pede
 * "on conflict do nothing". Um `.insert()` cru retorna erro 23505 quando o
 * usuário dispensa o mesmo destaque duas vezes (ex.: clique duplo, replay de
 * Server Action). Exigimos `.upsert(..., { onConflict: 'user_id,fixture_id',
 * ignoreDuplicates: true })` — equivalente PostgREST de ON CONFLICT DO NOTHING.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertSpy = vi.fn(() => Promise.resolve({ data: null, error: null }));
const insertSpy = vi.fn(() => Promise.resolve({ data: null, error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: "user-a" } }, error: null }),
      },
      from: (table: string) => {
        if (table !== "alert_dismissals") throw new Error("wrong table");
        return { upsert: upsertSpy, insert: insertSpy };
      },
    }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  upsertSpy.mockClear();
  insertSpy.mockClear();
});

describe("dismissAlert — idempotente (on conflict do nothing)", () => {
  it("usa upsert com onConflict (user_id,fixture_id) + ignoreDuplicates, NÃO insert cru", async () => {
    const { dismissAlert } = await import(
      "@/app/(dashboard)/_components/actions"
    );

    await dismissAlert(123);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    const [row, opts] = upsertSpy.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(row).toMatchObject({ user_id: "user-a", fixture_id: 123 });
    expect(opts).toMatchObject({
      onConflict: "user_id,fixture_id",
      ignoreDuplicates: true,
    });
  });

  it("chamar duas vezes o mesmo fixture não lança (idempotente)", async () => {
    const { dismissAlert } = await import(
      "@/app/(dashboard)/_components/actions"
    );
    await expect(dismissAlert(7)).resolves.toBeUndefined();
    await expect(dismissAlert(7)).resolves.toBeUndefined();
    expect(upsertSpy).toHaveBeenCalledTimes(2);
  });
});
