import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/supabase/types";
import { buildBetsFilter, STATUS_FILTERS } from "./filter-helpers";

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
  searchParams: Promise<{ status?: string; house?: string; league?: string; market?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const betsFilter = buildBetsFilter(sp);

  const [housesResult, marketsResult, leaguesResult] = await Promise.all([
    supabase.from("houses").select("id, name, slug, color_hex").order("name"),
    supabase.from("markets").select("id, name").order("name"),
    supabase
      .from("bet_selections")
      .select("league")
      .not("league", "is", null)
      .order("league"),
  ]);

  const houses = housesResult.data ?? [];
  const houseBySlug = new Map(houses.map((h) => [h.slug, h]));
  const houseById = new Map(houses.map((h) => [h.id, h]));
  const houseFilter = betsFilter.houseSlug
    ? houseBySlug.get(betsFilter.houseSlug)
    : undefined;

  const availableMarkets = marketsResult.data ?? [];

  const leagueSet = new Set<string>();
  for (const row of leaguesResult.data ?? []) {
    if (row.league) leagueSet.add(row.league);
  }
  const availableLeagues = Array.from(leagueSet).sort();

  // Build bets query
  // When league or market filter is active, join through bet_selections
  let betsQuery;
  if (betsFilter.league || betsFilter.marketId) {
    betsQuery = supabase
      .from("bets")
      .select(
        "id, house_id, kind, status, total_stake, total_odds, expected_return, actual_return, placed_at, resolved_at, note, bet_selections!inner(league, market_id)",
      )
      .order("placed_at", { ascending: false })
      .limit(200);

    if (betsFilter.league) {
      betsQuery = betsQuery.eq("bet_selections.league", betsFilter.league);
    }
    if (betsFilter.marketId) {
      betsQuery = betsQuery.eq("bet_selections.market_id", betsFilter.marketId);
    }
  } else {
    betsQuery = supabase
      .from("bets")
      .select(
        "id, house_id, kind, status, total_stake, total_odds, expected_return, actual_return, placed_at, resolved_at, note",
      )
      .order("placed_at", { ascending: false })
      .limit(200);
  }

  if (betsFilter.statusValues.length > 0)
    betsQuery = betsQuery.in("status", betsFilter.statusValues);
  if (houseFilter) betsQuery = betsQuery.eq("house_id", houseFilter.id);

  const { data: bets } = await betsQuery;
  const rows = bets ?? [];

  const summaryQuery = await supabase
    .from("bet_summary_view")
    .select("*")
    .maybeSingle();
  const summary = summaryQuery.data;

  const noHouses = houses.length === 0;

  function buildHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = {
      status: betsFilter.statusKey !== "all" ? betsFilter.statusKey : undefined,
      house: betsFilter.houseSlug,
      league: betsFilter.league,
      market: betsFilter.marketId,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/bets?${qs}` : "/bets";
  }

  const selectedMarket = availableMarkets.find((m) => m.id === betsFilter.marketId);

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

      {/* Status filter nav */}
      <nav className="mb-4 flex flex-wrap gap-1">
        {STATUS_FILTERS.map((f) => {
          const active = f.key === betsFilter.statusKey;
          return (
            <Link
              key={f.key}
              href={buildHref({ status: f.key !== "all" ? f.key : undefined })}
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

      {/* League + Market filters */}
      {(availableLeagues.length > 0 || availableMarkets.length > 0) && (
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
                value={betsFilter.league ?? ""}
                onChange={(e) => {
                  // client-side redirect via form GET
                }}
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
                value={betsFilter.marketId ?? ""}
                onChange={() => {}}
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
      )}

      {/* Active filter chips */}
      {(houseFilter || betsFilter.league || selectedMarket) && (
        <p className="mb-6 flex flex-wrap items-center gap-3 text-sm text-[var(--color-ink-muted)]">
          {houseFilter && (
            <span>
              casa: <span className="num">{houseFilter.name}</span> ·{" "}
              <Link
                href={buildHref({ house: undefined })}
                className="underline hover:text-[var(--color-ink)]"
              >
                limpar
              </Link>
            </span>
          )}
          {betsFilter.league && (
            <span>
              liga: <span className="num">{betsFilter.league}</span> ·{" "}
              <Link
                href={buildHref({ league: undefined })}
                className="underline hover:text-[var(--color-ink)]"
              >
                limpar
              </Link>
            </span>
          )}
          {selectedMarket && (
            <span>
              mercado: <span className="num">{selectedMarket.name}</span> ·{" "}
              <Link
                href={buildHref({ market: undefined })}
                className="underline hover:text-[var(--color-ink)]"
              >
                limpar
              </Link>
            </span>
          )}
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
