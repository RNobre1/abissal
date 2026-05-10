import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { archiveHouseAction, restoreHouseAction } from "./actions";

export default async function HousesPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("house_balance_view")
    .select("*")
    .order("name");

  const houses = rows ?? [];
  const active = houses.filter((h) => !h.archived_at);
  const archived = houses.filter((h) => h.archived_at);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-12 flex items-end justify-between">
        <div>
          <span className="label">casas</span>
          <h2 className="mt-2">onde habitas</h2>
        </div>
        <Button asChild>
          <Link href="/houses/new">+ casa</Link>
        </Button>
      </header>

      {active.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {active.map((h) => (
            <HouseCard
              key={h.house_id}
              row={h}
              action={archiveHouseAction}
              actionLabel="arquivar"
            />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section className="mt-16">
          <span className="label">arquivadas</span>
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {archived.map((h) => (
              <HouseCard
                key={h.house_id}
                row={h}
                action={restoreHouseAction}
                actionLabel="restaurar"
                muted
              />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

type HouseRow = {
  house_id: string | null;
  name: string | null;
  slug: string | null;
  color_hex: string | null;
  archived_at: string | null;
  balance: number | null;
  pending_stake: number | null;
  bet_count: number | null;
};

function HouseCard({
  row,
  action,
  actionLabel,
  muted,
}: {
  row: HouseRow;
  action: (fd: FormData) => Promise<void>;
  actionLabel: string;
  muted?: boolean;
}) {
  const accent =
    row.color_hex && /^#?[0-9a-fA-F]{6}$/.test(row.color_hex)
      ? row.color_hex.startsWith("#")
        ? row.color_hex
        : `#${row.color_hex}`
      : "var(--color-depth)";

  return (
    <li
      className={`card card-hover flex flex-col gap-4 p-5 ${muted ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <span
            className="block h-1 w-8 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          <h3 className="mt-3 text-lg leading-tight">{row.name}</h3>
        </div>
        <span className="num text-xs text-[var(--color-ink-muted)]">
          {row.bet_count ?? 0} apostas
        </span>
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <span className="label">saldo</span>
        <span
          className="num text-2xl"
          style={{ color: "var(--color-ink-display)" }}
        >
          {fmt.currency(Number(row.balance ?? 0))}
        </span>
      </div>

      {Number(row.pending_stake ?? 0) > 0 && (
        <div className="flex items-baseline justify-between border-t border-[var(--color-line-subtle)] pt-2">
          <span className="label">em jogo</span>
          <span
            className="num text-sm"
            style={{ color: "var(--color-depth-hi)" }}
          >
            {fmt.currency(Number(row.pending_stake))}
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <Link
          href={`/transactions?house=${row.slug ?? ""}`}
          className="label hover:text-[var(--color-ink)]"
        >
          ver transações
        </Link>
        <form action={action}>
          <input type="hidden" name="id" value={row.house_id ?? ""} />
          <Button variant="ghost" size="sm" type="submit">
            {actionLabel}
          </Button>
        </form>
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="card flex flex-col items-start gap-4 p-8">
      <span
        className="font-[var(--font-display)] text-2xl italic"
        style={{ color: "var(--color-ink-muted)" }}
      >
        nenhuma casa ainda.
      </span>
      <p className="max-w-prose text-sm text-[var(--color-ink-muted)]">
        Comece registrando uma das casas em que você joga. Depois você
        pode depositar, sacar e registrar apostas. Tudo será rastreado.
      </p>
      <Button asChild>
        <Link href="/houses/new">cadastrar primeira casa</Link>
      </Button>
    </div>
  );
}
