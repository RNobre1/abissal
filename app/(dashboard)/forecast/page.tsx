import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/format";
import { Sparkline } from "@/components/sparkline";
import { buildForecast } from "@/lib/banca/forecast";

const HORIZON_DAYS = 30;

export default async function ForecastPage() {
  const supabase = await createClient();
  // desc + limit pega os 365 snapshots MAIS RECENTES (asc pegava os mais
  // antigos e congelava a janela no passado); reverse restaura a ordem
  // cronológica que a regressão e o gráfico esperam.
  const { data } = await supabase
    .from("daily_pl_view")
    .select("snapshot_date, cumulative_pl")
    .order("snapshot_date", { ascending: false })
    .limit(365);

  const series = (data ?? [])
    .map((d) => ({
      date: d.snapshot_date as string,
      pl: Number(d.cumulative_pl ?? 0),
    }))
    .reverse();

  // Núcleo puro (lib/banca/forecast): regressão com x = dias CORRIDOS desde
  // o primeiro snapshot da janela — snapshots têm buracos de calendário e a
  // regressão por índice inflava o slope exibido como "BRL/dia".
  const forecast = series.length >= 14 ? buildForecast(series, HORIZON_DAYS) : null;

  if (forecast === null) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
        <header className="mb-10">
          <span className="label">previsão</span>
          <h2 className="mt-2">ainda cedo demais</h2>
        </header>
        <p className="card p-8 text-sm text-[var(--color-ink-muted)]">
          A previsão precisa de pelo menos 14 dias de histórico de P/L para
          gerar uma reta. Atualmente você tem{" "}
          <span className="num text-[var(--color-ink)]">
            {series.length}
          </span>{" "}
          {series.length === 1 ? "dia" : "dias"}. Continue jogando — e
          registrando.
        </p>
        <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
          dica: o snapshot diário é gerado pela função{" "}
          <code className="num">generate_balance_snapshots()</code>. Pode
          rodar manualmente no Supabase enquanto o cron não está em pé.
        </p>
        <Link
          href="/painel"
          className="label mt-8 inline-block hover:text-[var(--color-ink)]"
        >
          ← voltar
        </Link>
      </main>
    );
  }

  const { slopePerDay: slope, r2, dailyMean, dailyStd, projected } = forecast;

  const last = forecast.lastPl;

  const horizonEnd = projected[projected.length - 1];
  const fullSeries = [
    ...series.map((s) => s.pl),
    ...projected.map((p) => p.pl),
  ];

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-10">
        <span className="label">previsão · {HORIZON_DAYS}d</span>
        <h2 className="mt-2">se a curva continuar</h2>
      </header>

      <section className="mb-10 card p-6">
        <header className="mb-4 flex items-baseline justify-between">
          <span className="label">P/L acumulado · histórico + projeção</span>
          <span className="num text-xs text-[var(--color-ink-muted)]">
            R² = {r2.toFixed(3)}
          </span>
        </header>
        <Sparkline
          data={fullSeries}
          stroke={
            slope >= 0 ? "var(--color-depth-hi)" : "var(--color-vermelho-hi)"
          }
          fill={
            slope >= 0
              ? "color-mix(in srgb, var(--color-depth) 18%, transparent)"
              : "color-mix(in srgb, var(--color-vermelho) 14%, transparent)"
          }
          height={120}
        />
        <div className="mt-3 flex items-baseline justify-between text-xs text-[var(--color-ink-muted)]">
          <span className="num">{fmt.date(series[0].date)}</span>
          <span className="num">hoje</span>
          <span className="num">+{HORIZON_DAYS}d</span>
        </div>
      </section>

      <section className="mb-10 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-4">
        <Stat
          label="P/L hoje"
          value={fmt.signed(last)}
          tone={last >= 0 ? "depth" : "vermelho"}
        />
        <Stat
          label="tendência diária"
          value={fmt.signed(slope)}
          hint="BRL/dia"
          tone={slope >= 0 ? "depth" : "vermelho"}
        />
        <Stat
          label="volatilidade σ"
          value={fmt.bare(dailyStd)}
          hint="BRL/dia"
        />
        <Stat
          label="média diária"
          value={fmt.signed(dailyMean)}
          tone={dailyMean >= 0 ? "depth" : "vermelho"}
        />
      </section>

      <section className="card p-6">
        <span className="label">cenário em {HORIZON_DAYS} dias</span>
        <ul className="mt-4 flex flex-col gap-2">
          <Row
            label="pessimista (−95%)"
            value={fmt.signed(horizonEnd.lo)}
            tone="vermelho"
          />
          <Row
            label="esperado (tendência)"
            value={fmt.signed(horizonEnd.pl)}
            tone={horizonEnd.pl >= 0 ? "depth" : "vermelho"}
          />
          <Row
            label="otimista (+95%)"
            value={fmt.signed(horizonEnd.hi)}
            tone="depth"
          />
        </ul>
        <p className="mt-4 text-xs italic text-[var(--color-ink-muted)]">
          banda de 95% calculada a partir do desvio-padrão histórico de P/L
          diário. tendência = regressão linear sobre P/L acumulado. não é
          aconselhamento financeiro — é um espelho da curva passada.
        </p>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "depth" | "vermelho";
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2 bg-[var(--color-surface-2)] p-5">
      <span className="label">{label}</span>
      <span
        className="num text-xl"
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
      {hint && (
        <span className="num text-[10px] text-[var(--color-ink-faint)]">
          {hint}
        </span>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "depth" | "vermelho";
}) {
  return (
    <li className="flex items-baseline justify-between">
      <span className="label">{label}</span>
      <span
        className="num text-base"
        style={{
          color:
            tone === "depth"
              ? "var(--color-depth-hi)"
              : "var(--color-vermelho-hi)",
        }}
      >
        {value}
      </span>
    </li>
  );
}
