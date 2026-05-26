import { createClient } from "@/lib/supabase/server";
import { buildBetsCsv, type BetCsvRow } from "@/lib/bets/csv-export";

/**
 * GET /api/bets/export
 *
 * Exports bets as CSV download. Respects the same filter set as the /bets
 * page (status, house slug, league, market, date range).
 *
 * Query params:
 *   from    — ISO date string, inclusive lower bound for placed_at
 *   to      — ISO date string, inclusive upper bound for placed_at
 *   status  — "pending" | "won" | "lost" | "other" | "all" (default: all)
 *   house   — house slug
 *   league  — exact league name
 *   market  — market id
 *   format  — "csv" (default, only supported value)
 *   bom     — "1" to include UTF-8 BOM (useful for Excel)
 *
 * Response headers:
 *   Content-Type: text/csv; charset=utf-8
 *   Content-Disposition: attachment; filename="apostas-<date>.csv"
 *
 * Auth: requires valid Supabase session.
 */

export const runtime = "edge";
export const maxDuration = 30;

// Loose any for supabase (no generated types for all views yet)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function resolveStatusValues(
  status: string | null,
): string[] {
  switch (status) {
    case "pending":
      return ["pending"];
    case "won":
      return ["won", "half_won"];
    case "lost":
      return ["lost", "half_lost"];
    case "other":
      return ["void", "cashed_out", "partially_void"];
    default:
      return []; // all
  }
}

export async function GET(request: Request): Promise<Response> {
  const supabase = (await createClient()) as AnySupabase;

  // Auth gate
  const { data: { user } = { user: null } } = await supabase.auth.getUser();
  if (!user?.id) {
    return new Response(JSON.stringify({ error: "sessão expirada" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const statusKey = url.searchParams.get("status");
  const houseSlug = url.searchParams.get("house");
  const league = url.searchParams.get("league");
  const marketId = url.searchParams.get("market");
  const bom = url.searchParams.get("bom") === "1";

  const statusValues = resolveStatusValues(statusKey);

  // Build query — join houses for name; join bet_selections for league/market
  let query = supabase
    .from("bets")
    .select(
      `id, placed_at, resolved_at, house_id, kind, status,
       total_stake, total_odds, expected_return, actual_return,
       note,
       houses!inner(name, slug),
       bet_selections(league, market_id, markets(name))`,
    )
    .order("placed_at", { ascending: false })
    .limit(5000); // hard cap to avoid memory issues

  if (statusValues.length > 0) {
    query = query.in("status", statusValues);
  }
  if (from) {
    query = query.gte("placed_at", from);
  }
  if (to) {
    query = query.lte("placed_at", `${to}T23:59:59Z`);
  }
  if (houseSlug) {
    query = query.eq("houses.slug", houseSlug);
  }
  if (league) {
    query = query.eq("bet_selections.league", league);
  }
  if (marketId) {
    query = query.eq("bet_selections.market_id", marketId);
  }

  const { data, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // Normalize rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: BetCsvRow[] = (data ?? []).map((b: any) => {
    const sel = Array.isArray(b.bet_selections) ? b.bet_selections[0] : null;
    const pl =
      b.actual_return != null && b.total_stake != null
        ? Number(b.actual_return) - Number(b.total_stake)
        : null;

    return {
      id: String(b.id),
      placed_at: b.placed_at ?? "",
      resolved_at: b.resolved_at ?? null,
      house_name: b.houses?.name ?? null,
      kind: b.kind,
      status: b.status,
      total_stake: Number(b.total_stake),
      total_odds: Number(b.total_odds),
      expected_return: b.expected_return != null ? Number(b.expected_return) : null,
      actual_return: b.actual_return != null ? Number(b.actual_return) : null,
      pl,
      note: b.note ?? null,
      league: sel?.league ?? null,
      market: sel?.markets?.name ?? null,
      sport: "Futebol", // single sport for now; extend when multi-sport lands
    };
  });

  const date = new Date().toISOString().slice(0, 10);
  const csv = buildBetsCsv(rows, { bom });
  const filename = `apostas-${date}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
