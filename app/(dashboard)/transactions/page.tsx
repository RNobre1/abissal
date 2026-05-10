import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/format";
import { Button } from "@/components/ui/button";

const KIND_LABEL: Record<string, string> = {
  deposit: "depósito",
  withdrawal: "saque",
  bet_stake: "stake",
  bet_return: "retorno",
  bonus_credit: "bônus",
  bonus_rollover: "rollover",
  fee: "taxa",
  adjustment_credit: "ajuste +",
  adjustment_debit: "ajuste −",
  transfer_in: "transf. ←",
  transfer_out: "transf. →",
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ house?: string }>;
}) {
  const { house: houseFilter } = await searchParams;
  const supabase = await createClient();

  const housesQuery = await supabase
    .from("houses")
    .select("id, name, slug")
    .order("name");
  const houses = housesQuery.data ?? [];
  const houseId = houseFilter
    ? houses.find((h) => h.slug === houseFilter)?.id
    : undefined;

  let query = supabase
    .from("transactions")
    .select(
      "id, kind, direction, amount, currency, occurred_at, note, house_id",
    )
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (houseId) query = query.eq("house_id", houseId);

  const { data: txs } = await query;

  const houseById = new Map(houses.map((h) => [h.id, h.name]));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-10 flex items-end justify-between">
        <div>
          <span className="label">transações</span>
          <h2 className="mt-2">o livro-razão</h2>
        </div>
        <Button asChild>
          <Link href="/transactions/new">+ transação</Link>
        </Button>
      </header>

      {houseFilter && (
        <p className="mb-6 text-sm text-[var(--color-ink-muted)]">
          filtrando por casa: <span className="num">{houseFilter}</span> ·{" "}
          <Link
            href="/transactions"
            className="underline hover:text-[var(--color-ink)]"
          >
            limpar
          </Link>
        </p>
      )}

      {(txs ?? []).length === 0 ? (
        <EmptyState hasHouses={houses.length > 0} />
      ) : (
        <ol className="flex flex-col gap-[2px] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-line)]">
          {(txs ?? []).map((t) => {
            const isIn = t.direction === "in";
            return (
              <li
                key={t.id}
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 bg-[var(--color-surface-2)] px-4 py-3 md:grid-cols-[auto_1fr_auto_auto_auto]"
              >
                <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                  {fmt.date(t.occurred_at)}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm text-[var(--color-ink)]">
                    {houseById.get(t.house_id) ?? "—"}
                  </span>
                  {t.note && (
                    <span className="truncate text-xs text-[var(--color-ink-muted)]">
                      {t.note}
                    </span>
                  )}
                </div>
                <span
                  className="hidden text-[10px] uppercase tracking-[0.18em] md:inline"
                  style={{
                    color: isIn
                      ? "var(--color-depth-hi)"
                      : "var(--color-ink-muted)",
                  }}
                >
                  {KIND_LABEL[t.kind] ?? t.kind}
                </span>
                <span
                  className="num text-base"
                  style={{
                    color: isIn
                      ? "var(--color-ink-display)"
                      : "var(--color-ink)",
                  }}
                >
                  {isIn ? "+" : "−"}
                  {fmt.currency(Number(t.amount)).replace(/^.*?\$\s?/, "")}
                </span>
                <span className="num text-[10px] text-[var(--color-ink-faint)]">
                  {t.currency}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

function EmptyState({ hasHouses }: { hasHouses: boolean }) {
  return (
    <div className="card flex flex-col items-start gap-4 p-8">
      <span
        className="font-[var(--font-display)] text-2xl italic"
        style={{ color: "var(--color-ink-muted)" }}
      >
        nada se moveu ainda.
      </span>
      <p className="max-w-prose text-sm text-[var(--color-ink-muted)]">
        {hasHouses
          ? "Registre a primeira transação — depósito, saque, ajuste."
          : "Cadastre uma casa primeiro, depois registre transações."}
      </p>
      <Button asChild>
        <Link href={hasHouses ? "/transactions/new" : "/houses/new"}>
          {hasHouses ? "+ transação" : "+ casa"}
        </Link>
      </Button>
    </div>
  );
}
