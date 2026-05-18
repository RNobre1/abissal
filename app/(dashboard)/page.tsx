import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/sparkline";
import { DestaquesDoDia } from "./_components/destaques-do-dia";

export default async function OverviewPage() {
  const supabase = await createClient();

  const [housesQuery, summaryQuery, recentTxQuery, dailyPlQuery] =
    await Promise.all([
      supabase
        .from("house_balance_view")
        .select("*")
        .is("archived_at", null)
        .order("balance", { ascending: false }),
      supabase.from("bet_summary_view").select("*").maybeSingle(),
      supabase
        .from("transactions")
        .select("id, kind, direction, amount, occurred_at, house_id, note")
        .order("occurred_at", { ascending: false })
        .limit(6),
      supabase
        .from("daily_pl_view")
        .select("snapshot_date, cumulative_pl")
        .order("snapshot_date", { ascending: true })
        .limit(180),
    ]);

  const houses = housesQuery.data ?? [];
  const summary = summaryQuery.data;

  const totalBalance = houses.reduce(
    (acc, h) => acc + Number(h.balance ?? 0),
    0,
  );
  const totalDeposits = houses.reduce(
    (acc, h) => acc + Number(h.deposits ?? 0),
    0,
  );
  const totalWithdrawals = houses.reduce(
    (acc, h) => acc + Number(h.withdrawals ?? 0),
    0,
  );
  const netCapital = totalDeposits - totalWithdrawals;
  const cumulativePl = totalBalance - netCapital;
  const totalPending = houses.reduce(
    (acc, h) => acc + Number(h.pending_stake ?? 0),
    0,
  );

  // ROI = lucro acumulado / capital líquido depositado
  const roi = netCapital > 0 ? cumulativePl / netCapital : 0;

  // Yield = lucro / total apostado (resolvido)
  const resolvedStaked = Number(summary?.resolved_staked ?? 0);
  const resolvedReturned = Number(summary?.resolved_returned ?? 0);
  const yieldPct =
    resolvedStaked > 0
      ? (resolvedReturned - resolvedStaked) / resolvedStaked
      : 0;

  const totalBets = Number(summary?.total_bets ?? 0);
  const wonCount = Number(summary?.won_count ?? 0);
  const lostCount = Number(summary?.lost_count ?? 0);
  const winRate =
    wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0;

  const dailyPl = (dailyPlQuery.data ?? []).map((d) => ({
    date: d.snapshot_date as string,
    pl: Number(d.cumulative_pl ?? 0),
  }));

  // Max drawdown from cumulative P&L: largest peak-to-trough drop in BRL.
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const point of dailyPl) {
    if (point.pl > peak) peak = point.pl;
    const dd = peak - point.pl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const isEmpty = houses.length === 0;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-12 flex items-baseline justify-between">
        <span className="label">visão geral</span>
        <span className="label">{fmt.date(new Date())}</span>
      </header>

      <DestaquesDoDia />

      {isEmpty ? <FirstRun /> : (
        <>
          <section className="mb-16">
            <span className="label">saldo total · todas as casas</span>
            <div className="mt-4 flex items-baseline gap-3">
              <span
                className="num text-[clamp(3.5rem,10vw,9rem)] leading-[0.92] tracking-[-0.04em]"
                style={{ color: "var(--color-ink-display)" }}
              >
                {fmt.bare(totalBalance)}
              </span>
              <span className="num text-sm text-[var(--color-ink-muted)]">
                BRL
              </span>
            </div>
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
              capital líquido depositado:{" "}
              <span className="num">{fmt.currency(netCapital)}</span> · P/L
              acumulado:{" "}
              <span
                className="num"
                style={{
                  color:
                    cumulativePl >= 0
                      ? "var(--color-depth-hi)"
                      : "var(--color-vermelho-hi)",
                }}
              >
                {fmt.signed(cumulativePl)}
              </span>
            </p>
          </section>

          <section className="mb-16 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-4">
            <Metric
              label="ROI"
              value={fmt.signedPercent(roi)}
              tone={roi >= 0 ? "depth" : "vermelho"}
            />
            <Metric
              label="yield"
              value={fmt.signedPercent(yieldPct)}
              tone={yieldPct >= 0 ? "depth" : "vermelho"}
            />
            <Metric
              label="win rate"
              value={fmt.percent(winRate)}
              tone="ink"
            />
            <Metric
              label="apostas pendentes"
              value={fmt.currency(totalPending)}
              tone="depth"
              compact
            />
          </section>

          {totalBets === 0 && (
            <p className="mb-12 text-sm italic text-[var(--color-ink-muted)]">
              ainda sem apostas registradas — métricas de yield e win rate
              aparecerão depois da primeira aposta resolvida.
            </p>
          )}

          {dailyPl.length >= 2 && (
            <section className="mb-16 card p-6">
              <header className="mb-4 flex items-baseline justify-between">
                <span className="label">P/L acumulado · {dailyPl.length}d</span>
                <span className="num text-xs text-[var(--color-ink-muted)]">
                  drawdown máx:{" "}
                  <span style={{ color: "var(--color-vermelho-hi)" }}>
                    −{fmt.bare(maxDrawdown)}
                  </span>
                </span>
              </header>
              <Sparkline
                data={dailyPl.map((d) => d.pl)}
                stroke={
                  cumulativePl >= 0
                    ? "var(--color-depth-hi)"
                    : "var(--color-vermelho-hi)"
                }
                fill={
                  cumulativePl >= 0
                    ? "color-mix(in srgb, var(--color-depth) 18%, transparent)"
                    : "color-mix(in srgb, var(--color-vermelho) 14%, transparent)"
                }
                height={96}
              />
              <div className="mt-3 flex items-baseline justify-between text-xs text-[var(--color-ink-muted)]">
                <span className="num">{fmt.date(dailyPl[0].date)}</span>
                <span className="num">
                  {fmt.date(dailyPl[dailyPl.length - 1].date)}
                </span>
              </div>
            </section>
          )}

          <section className="mb-16">
            <header className="mb-4 flex items-baseline justify-between">
              <span className="label">casas · saldo</span>
              <Link
                href="/houses"
                className="label hover:text-[var(--color-ink)]"
              >
                todas →
              </Link>
            </header>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {houses.slice(0, 6).map((h) => (
                <li key={h.house_id} className="card p-5">
                  <span
                    className="block h-1 w-8 rounded-full"
                    style={{
                      backgroundColor: h.color_hex ?? "var(--color-depth)",
                    }}
                  />
                  <h3 className="mt-3 text-base">{h.name}</h3>
                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="label">saldo</span>
                    <span
                      className="num text-xl"
                      style={{ color: "var(--color-ink-display)" }}
                    >
                      {fmt.currency(Number(h.balance ?? 0))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {(recentTxQuery.data ?? []).length > 0 && (
            <section>
              <header className="mb-4 flex items-baseline justify-between">
                <span className="label">últimos lançamentos</span>
                <Link
                  href="/transactions"
                  className="label hover:text-[var(--color-ink)]"
                >
                  todos →
                </Link>
              </header>
              <ol className="flex flex-col gap-[2px] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-line)]">
                {(recentTxQuery.data ?? []).map((t) => {
                  const isIn = t.direction === "in";
                  return (
                    <li
                      key={t.id}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 bg-[var(--color-surface-2)] px-4 py-2.5"
                    >
                      <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                        {fmt.date(t.occurred_at)}
                      </span>
                      <span className="truncate text-sm text-[var(--color-ink)]">
                        {t.note ?? t.kind.replace(/_/g, " ")}
                      </span>
                      <span
                        className="num text-sm"
                        style={{
                          color: isIn
                            ? "var(--color-depth-hi)"
                            : "var(--color-ink)",
                        }}
                      >
                        {isIn ? "+" : "−"}
                        {fmt.bare(Number(t.amount))}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
  compact,
}: {
  label: string;
  value: string;
  tone: "ink" | "depth" | "vermelho";
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 bg-[var(--color-surface-2)] p-6">
      <span className="label">{label}</span>
      <span
        className={`num ${compact ? "text-2xl" : "text-3xl md:text-4xl"}`}
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

function FirstRun() {
  return (
    <section className="mt-12">
      <h1>
        banca,
        <br />
        <span
          className="italic font-[400]"
          style={{ color: "var(--color-vermelho)" }}
        >
          habitada.
        </span>
      </h1>

      <p className="mt-12 max-w-2xl text-lg leading-relaxed text-[var(--color-ink)] md:text-xl">
        Comece cadastrando uma casa. Depois lance um depósito. A banca aparece.
      </p>

      <div className="mt-12 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/houses/new">+ primeira casa</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/houses">ver casas</Link>
        </Button>
      </div>
    </section>
  );
}
