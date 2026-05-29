import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/format";
import { computeStreaks, carryForwardSeries } from "@/lib/banca/metrics";
import { BankrollChart, type BankrollPoint } from "@/components/banca/bankroll-chart";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos das views
// ──────────────────────────────────────────────────────────────────────────────

type RoiByHouseRow = {
  house_id: string;
  house_name: string | null;
  resolved_staked: number;
  resolved_returned: number;
  pl: number;
  yield: number | null;
  roi: number | null;
  win_rate: number | null;
  bet_count: number;
  pending_stake: number;
};

type RoiByPeriodRow = {
  period: string;
  period_type: string;
  resolved_staked: number;
  resolved_returned: number;
  pl: number;
  yield: number | null;
  win_rate: number | null;
  won_count: number;
  lost_count: number;
  bet_count: number;
};

type BetKindRow = {
  kind: string;
  total_stake: number;
  actual_return: number | null;
  status: string;
  resolved_at: string | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function tone(value: number | null): React.CSSProperties {
  if (value === null) return { color: "var(--color-ink-muted)" };
  return {
    color:
      value >= 0
        ? "var(--color-depth-hi)"
        : "var(--color-vermelho-hi)",
  };
}

function fmtPct(value: number | null): string {
  if (value === null) return "—";
  return fmt.signedPercent(value);
}

function fmtPl(value: number): string {
  return fmt.signed(value);
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────

export default async function BancaPage() {
  const supabase = await createClient();

  // As views roi_by_house_view e roi_by_period_view serão tipadas após
  // `supabase db pull && supabase gen types`. Por ora usamos o client
  // com `as any` apenas nestas duas queries para evitar erro TS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;

  const [houseViewQuery, periodViewQuery, betsQuery] = await Promise.all([
    sbAny
      .from("roi_by_house_view")
      .select("*")
      .order("resolved_staked", { ascending: false }),
    sbAny
      .from("roi_by_period_view")
      .select("*")
      .order("period_type", { ascending: false })
      .order("period", { ascending: false }),
    supabase
      .from("bets")
      .select("kind, total_stake, actual_return, status, resolved_at")
      .neq("status", "pending")
      .order("resolved_at", { ascending: false }),
  ]);

  // Bankroll snapshots — optional, degrades gracefully when table absent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snapshotsQuery: { data: any[] | null; error: unknown } = { data: null, error: null };
  try {
    const from90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const snapshotChain = sbAny
      .from("banca_snapshots")
      .select("snapshot_date, balance");
    if (typeof snapshotChain.gte === "function") {
      snapshotsQuery = await snapshotChain
        .gte("snapshot_date", from90)
        .order("snapshot_date", { ascending: true })
        .limit(90);
    }
  } catch {
    // banca_snapshots not available in this environment — skip chart
  }

  const houses = (houseViewQuery.data ?? []) as RoiByHouseRow[];
  const periods = (periodViewQuery.data ?? []) as RoiByPeriodRow[];
  const bets = (betsQuery.data ?? []) as BetKindRow[];

  // Bankroll chart data
  type SnapshotRow = { snapshot_date: string; balance: number };
  const rawSnapshots = (snapshotsQuery?.data ?? []) as SnapshotRow[];
  const snapshotPoints = rawSnapshots.map((s) => ({
    date: s.snapshot_date,
    balance: Number(s.balance),
  }));
  const today = new Date().toISOString().slice(0, 10);
  const chartFrom90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const filledSnapshots = carryForwardSeries(snapshotPoints, chartFrom90, today);
  // Compute drawdown
  let peak = -Infinity;
  const bankrollChartData: BankrollPoint[] = filledSnapshots.map((p) => {
    if (p.balance > peak) peak = p.balance;
    const drawdown = peak > -Infinity ? Math.max(0, peak - p.balance) : 0;
    return { date: p.date, balance: p.balance, drawdown };
  });

  const isEmpty = houses.length === 0 && bets.length === 0;

  // Rolling 30d e meses
  const rolling30d = periods.find((p) => p.period_type === "rolling-30d");
  const monthly = periods.filter((p) => p.period_type === "monthly");

  // Yield por tipo de aposta (single / multiple / system)
  const kindMap = new Map<string, { staked: number; returned: number; won: number; lost: number }>();
  for (const bet of bets) {
    const entry = kindMap.get(bet.kind) ?? { staked: 0, returned: 0, won: 0, lost: 0 };
    entry.staked += Number(bet.total_stake ?? 0);
    entry.returned += Number(bet.actual_return ?? 0);
    if (bet.status === "won") entry.won++;
    if (bet.status === "lost") entry.lost++;
    kindMap.set(bet.kind, entry);
  }

  // Streaks de vitória/derrota (resultados ordenados mais recente primeiro)
  const results = bets
    .filter((b) => b.status === "won" || b.status === "lost")
    .map((b) => (b.status === "won" ? "W" : "L") as "W" | "L");

  const streaks = computeStreaks(results);

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-12 flex items-baseline justify-between">
        <span className="label">banca · relatórios</span>
        <Link href="/painel" className="label hover:text-[var(--color-ink)]">← overview</Link>
      </header>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {/* Bankroll ao longo do tempo */}
          {bankrollChartData.length > 1 && (
            <section className="mb-16">
              <h2 className="label mb-4">bankroll ao longo do tempo (90d)</h2>
              <div className="card p-4">
                <BankrollChart
                  data={bankrollChartData}
                  showDrawdown
                  height={260}
                />
              </div>
            </section>
          )}

          {/* P/L por casa */}
          <section className="mb-16">
            <h2 className="label mb-6">P/L por casa</h2>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-2 lg:grid-cols-3">
              {houses.map((h) => (
                <div key={h.house_id} className="flex flex-col gap-3 bg-[var(--color-surface-2)] p-5">
                  <span className="text-sm text-[var(--color-ink)]">{h.house_name ?? "—"}</span>
                  <div className="flex items-baseline justify-between">
                    <span className="label">P/L</span>
                    <span className="num text-xl" style={tone(h.pl)}>
                      {fmtPl(Number(h.pl))}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-[var(--color-ink-muted)]">
                    <span>yield <span className="num" style={tone(h.yield)}>{fmtPct(h.yield !== null ? Number(h.yield) : null)}</span></span>
                    <span>ROI <span className="num" style={tone(h.roi)}>{fmtPct(h.roi !== null ? Number(h.roi) : null)}</span></span>
                    <span>win rate <span className="num">{h.win_rate !== null ? fmt.percent(Number(h.win_rate)) : "—"}</span></span>
                  </div>
                  <div className="text-xs text-[var(--color-ink-muted)]">
                    {h.bet_count} apostas · pendente <span className="num">{fmt.currency(Number(h.pending_stake))}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Yield por tipo de aposta */}
          {kindMap.size > 0 && (
            <section className="mb-16">
              <h2 className="label mb-6">yield por tipo de aposta</h2>
              <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-3">
                {Array.from(kindMap.entries()).map(([kind, data]) => {
                  const yieldVal = data.staked > 0 ? (data.returned - data.staked) / data.staked : null;
                  return (
                    <div key={kind} className="flex flex-col gap-3 bg-[var(--color-surface-2)] p-5">
                      <span className="label">{kind}</span>
                      <span className="num text-2xl" style={tone(yieldVal)}>
                        {fmtPct(yieldVal)}
                      </span>
                      <div className="text-xs text-[var(--color-ink-muted)]">
                        apostado <span className="num">{fmt.currency(data.staked)}</span> ·
                        retorno <span className="num">{fmt.currency(data.returned)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Streaks */}
          {results.length > 0 && (
            <section className="mb-16">
              <h2 className="label mb-6">sequências</h2>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-4">
                <StatTile label="vitórias seguidas (atual)" value={String(streaks.currentWinStreak)} />
                <StatTile label="derrotas seguidas (atual)" value={String(streaks.currentLoseStreak)} />
                <StatTile label="maior sequência de vitórias" value={String(streaks.maxWinStreak)} />
                <StatTile label="maior sequência de derrotas" value={String(streaks.maxLoseStreak)} />
              </div>
            </section>
          )}

          {/* ROI rolling 30d */}
          {rolling30d && (
            <section className="mb-16 card p-6">
              <header className="mb-4 flex items-baseline justify-between">
                <span className="label">ROI rolling-30d</span>
                <span className="num text-2xl" style={tone(rolling30d.yield !== null ? Number(rolling30d.yield) : null)}>
                  {fmtPct(rolling30d.yield !== null ? Number(rolling30d.yield) : null)}
                </span>
              </header>
              <div className="flex justify-between text-xs text-[var(--color-ink-muted)]">
                <span>apostado <span className="num">{fmt.currency(Number(rolling30d.resolved_staked))}</span></span>
                <span>P/L <span className="num" style={tone(Number(rolling30d.pl))}>{fmtPl(Number(rolling30d.pl))}</span></span>
                <span>win rate <span className="num">{rolling30d.win_rate !== null ? fmt.percent(Number(rolling30d.win_rate)) : "—"}</span></span>
              </div>
            </section>
          )}

          {/* Breakdown mensal */}
          {monthly.length > 0 && (
            <section className="mb-16">
              <h2 className="label mb-6">breakdown mensal</h2>
              <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)]">
                      <th className="label px-4 py-3 text-left">mês</th>
                      <th className="label px-4 py-3 text-right">apostas</th>
                      <th className="label px-4 py-3 text-right">P/L</th>
                      <th className="label px-4 py-3 text-right">yield</th>
                      <th className="label px-4 py-3 text-right">win rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((m) => (
                      <tr
                        key={m.period}
                        className="border-b border-[var(--color-line)] bg-[var(--color-surface-1)] last:border-0"
                      >
                        <td className="num px-4 py-3">{m.period}</td>
                        <td className="num px-4 py-3 text-right">{m.bet_count}</td>
                        <td className="num px-4 py-3 text-right" style={tone(Number(m.pl))}>
                          {fmtPl(Number(m.pl))}
                        </td>
                        <td className="num px-4 py-3 text-right" style={tone(m.yield !== null ? Number(m.yield) : null)}>
                          {fmtPct(m.yield !== null ? Number(m.yield) : null)}
                        </td>
                        <td className="num px-4 py-3 text-right">
                          {m.win_rate !== null ? fmt.percent(Number(m.win_rate)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ──────────────────────────────────────────────────────────────────────────────

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-3 bg-[var(--color-surface-2)] p-6">
      <span className="label">{label}</span>
      <span className="num text-3xl" style={{ color: "var(--color-ink-display)" }}>
        {value}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="mt-12">
      <p className="text-lg text-[var(--color-ink-muted)]">
        sem apostas resolvidas ainda — os relatórios aparecem depois da primeira resolução.
      </p>
    </section>
  );
}
