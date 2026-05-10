import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/supabase/types";

type BetStatus = Database["public"]["Enums"]["bet_status"];
type BetKind = Database["public"]["Enums"]["bet_kind"];

const STATUS_LABEL: Record<BetStatus, string> = {
  pending: "pendente",
  won: "ganha",
  lost: "perdida",
  void: "anulada",
  cashed_out: "cash-out",
  half_won: "meia ganha",
  half_lost: "meia perdida",
  partially_void: "parcial anulada",
};

const KIND_LABEL: Record<BetKind, string> = {
  single: "simples",
  multiple: "múltipla",
  system: "sistema",
};

const STATUS_FILTERS: Array<{ key: string; label: string; values: BetStatus[] }> = [
  { key: "all", label: "todas", values: [] },
  { key: "pending", label: "pendentes", values: ["pending"] },
  { key: "won", label: "ganhas", values: ["won", "half_won"] },
  { key: "lost", label: "perdidas", values: ["lost", "half_lost"] },
  { key: "other", label: "outras", values: ["void", "cashed_out", "partially_void"] },
];

function statusTone(s: BetStatus): "ink" | "depth" | "vermelho" | "muted" {
  if (s === "won" || s === "half_won" || s === "cashed_out") return "depth";
  if (s === "lost" || s === "half_lost") return "vermelho";
  if (s === "void" || s === "partially_void") return "muted";
  return "ink";
}

function toneColor(tone: "ink" | "depth" | "vermelho" | "muted"): string {
  switch (tone) {
    case "depth":
      return "var(--color-depth-hi)";
    case "vermelho":
      return "var(--color-vermelho-hi)";
    case "muted":
      return "var(--color-ink-muted)";
    default:
      return "var(--color-ink)";
  }
}

export default async function BetsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; house?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const housesQuery = await supabase
    .from("houses")
    .select("id, name, slug, color_hex")
    .order("name");
  const houses = housesQuery.data ?? [];
  const houseBySlug = new Map(houses.map((h) => [h.slug, h]));
  const houseById = new Map(houses.map((h) => [h.id, h]));
  const houseFilter = sp.house ? houseBySlug.get(sp.house) : undefined;

  const statusKey = sp.status ?? "all";
  const filter = STATUS_FILTERS.find((f) => f.key === statusKey) ?? STATUS_FILTERS[0];

  let query = supabase
    .from("bets")
    .select(
      "id, house_id, kind, status, total_stake, total_odds, expected_return, actual_return, placed_at, resolved_at, note",
    )
    .order("placed_at", { ascending: false })
    .limit(200);

  if (filter.values.length > 0) query = query.in("status", filter.values);
  if (houseFilter) query = query.eq("house_id", houseFilter.id);

  const { data: bets } = await query;
  const rows = bets ?? [];

  const summaryQuery = await supabase
    .from("bet_summary_view")
    .select("*")
    .maybeSingle();
  const summary = summaryQuery.data;

  const noHouses = houses.length === 0;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-10 flex items-end justify-between">
        <div>
          <span className="label">apostas</span>
          <h2 className="mt-2">o caderno de apostas</h2>
        </div>
        {!noHouses && (
          <Button asChild>
            <Link href="/bets/new">+ aposta</Link>
          </Button>
        )}
      </header>

      {summary && Number(summary.total_bets ?? 0) > 0 && (
        <section className="mb-10 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-4">
          <Stat label="pendentes" value={String(summary.pending_count ?? 0)} />
          <Stat
            label="em jogo"
            value={fmt.currency(Number(summary.pending_stake ?? 0))}
            tone="depth"
            mono
          />
          <Stat
            label="apostado (resolvido)"
            value={fmt.currency(Number(summary.resolved_staked ?? 0))}
            mono
          />
          <Stat
            label="retornado (resolvido)"
            value={fmt.currency(Number(summary.resolved_returned ?? 0))}
            tone={
              Number(summary.resolved_returned ?? 0) >=
              Number(summary.resolved_staked ?? 0)
                ? "depth"
                : "vermelho"
            }
            mono
          />
        </section>
      )}

      <nav className="mb-6 flex flex-wrap gap-1">
        {STATUS_FILTERS.map((f) => {
          const active = f.key === filter.key;
          const href = new URLSearchParams();
          if (f.key !== "all") href.set("status", f.key);
          if (sp.house) href.set("house", sp.house);
          const qs = href.toString();
          return (
            <Link
              key={f.key}
              href={qs ? `/bets?${qs}` : "/bets"}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition-colors"
              style={{
                color: active
                  ? "var(--color-ink-display)"
                  : "var(--color-ink-muted)",
                backgroundColor: active
                  ? "var(--color-surface-2)"
                  : "transparent",
              }}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {houseFilter && (
        <p className="mb-6 text-sm text-[var(--color-ink-muted)]">
          casa: <span className="num">{houseFilter.name}</span> ·{" "}
          <Link
            href={
              filter.key === "all" ? "/bets" : `/bets?status=${filter.key}`
            }
            className="underline hover:text-[var(--color-ink)]"
          >
            limpar
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState noHouses={noHouses} />
      ) : (
        <ol className="flex flex-col gap-[2px] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-line)]">
          {rows.map((b) => {
            const tone = statusTone(b.status);
            const house = houseById.get(b.house_id);
            return (
              <li
                key={b.id}
                className="bg-[var(--color-surface-2)] transition-colors hover:bg-[var(--color-surface-3,var(--color-surface-2))]"
              >
                <Link
                  href={`/bets/${b.id}`}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-4 py-3 md:grid-cols-[auto_1fr_auto_auto_auto]"
                >
                  <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                    {fmt.date(b.placed_at)}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-center gap-2">
                      {house?.color_hex && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: house.color_hex }}
                          aria-hidden
                        />
                      )}
                      <span className="truncate text-sm text-[var(--color-ink)]">
                        {house?.name ?? "—"}
                      </span>
                      <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
                        {KIND_LABEL[b.kind]}
                      </span>
                    </div>
                    {b.note && (
                      <span className="truncate text-xs text-[var(--color-ink-muted)]">
                        {b.note}
                      </span>
                    )}
                  </div>
                  <span
                    className="num text-[10px] uppercase tracking-[0.18em]"
                    style={{ color: toneColor(tone) }}
                  >
                    {STATUS_LABEL[b.status]}
                  </span>
                  <span
                    className="num text-sm"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    @ {fmt.number(Number(b.total_odds))}
                  </span>
                  <span
                    className="num text-base"
                    style={{
                      color:
                        b.status === "pending"
                          ? "var(--color-ink-display)"
                          : tone === "depth"
                            ? "var(--color-depth-hi)"
                            : tone === "vermelho"
                              ? "var(--color-ink-muted)"
                              : "var(--color-ink)",
                    }}
                  >
                    {b.status === "pending"
                      ? fmt.currency(Number(b.total_stake))
                      : fmt.signed(
                          Number(b.actual_return ?? 0) - Number(b.total_stake),
                        )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: "ink" | "depth" | "vermelho";
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 bg-[var(--color-surface-2)] p-5">
      <span className="label">{label}</span>
      <span
        className={`${mono ? "num" : ""} text-xl`}
        style={{
          color:
            tone === "depth"
              ? "var(--color-depth-hi)"
              : tone === "vermelho"
                ? "var(--color-vermelho-hi)"
                : "var(--color-ink-display)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function EmptyState({ noHouses }: { noHouses: boolean }) {
  return (
    <div className="card flex flex-col items-start gap-4 p-8">
      <span
        className="font-[var(--font-display)] text-2xl italic"
        style={{ color: "var(--color-ink-muted)" }}
      >
        nenhuma aposta ainda.
      </span>
      <p className="max-w-prose text-sm text-[var(--color-ink-muted)]">
        {noHouses
          ? "Cadastre uma casa primeiro — aposta sem casa não tem lar."
          : "Registre a primeira aposta — stake, odd, evento. O caderno se preenche."}
      </p>
      <Button asChild>
        <Link href={noHouses ? "/houses/new" : "/bets/new"}>
          {noHouses ? "+ casa" : "+ aposta"}
        </Link>
      </Button>
    </div>
  );
}
