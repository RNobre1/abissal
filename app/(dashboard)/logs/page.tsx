import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchLogs,
  summarize,
  type LogRow,
  type LogsFilter,
} from "@/lib/llm-logs-repository";

// Always fetch fresh — the audit panel must reflect the very last request
// without waiting for ISR revalidation or page-level dataCache.
export const dynamic = "force-dynamic";

interface LogsPageProps {
  searchParams: Promise<{ route?: string; limit?: string }>;
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const raw = await searchParams;
  const filter = parseFilter(raw);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as { from: (t: string) => any };
  let rows: LogRow[] = [];
  let queryError: string | null = null;
  try {
    rows = await fetchLogs(admin, filter);
  } catch (err) {
    queryError = err instanceof Error ? err.message : "erro desconhecido";
  }
  const summary = summarize(rows);

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-8 flex items-end justify-between gap-6">
        <div>
          <span className="label">logs</span>
          <h2 className="mt-2">requests da IA</h2>
        </div>
        <FilterChips activeRoute={filter.route} />
      </header>

      <SummaryGrid summary={summary} sample={rows.length} />

      {queryError ? (
        <p
          className="card mt-8 p-4 text-sm"
          style={{ color: "var(--color-vermelho)" }}
          role="alert"
        >
          falha ao ler logs: {queryError}
        </p>
      ) : rows.length === 0 ? (
        <p className="card mt-8 p-8 text-center text-sm italic text-[var(--color-ink-muted)]">
          nenhum request ainda — gere uma análise ou pergunte algo ao copilot.
        </p>
      ) : (
        <LogsTable rows={rows} />
      )}
    </main>
  );
}

function parseFilter(raw: { route?: string; limit?: string }): LogsFilter {
  const route =
    raw.route === "analyze" || raw.route === "copilot" || raw.route === "fixture-copilot"
      ? raw.route
      : undefined;
  const limit = raw.limit ? Number.parseInt(raw.limit, 10) : undefined;
  return {
    route,
    limit: Number.isFinite(limit) ? limit : undefined,
  };
}

function FilterChips({ activeRoute }: { activeRoute?: string }) {
  const opts: Array<{ label: string; href: string; key: string | undefined }> =
    [
      { label: "todas", href: "/logs", key: undefined },
      { label: "analyze", href: "/logs?route=analyze", key: "analyze" },
      { label: "copilot", href: "/logs?route=copilot", key: "copilot" },
      { label: "fixture-copilot", href: "/logs?route=fixture-copilot", key: "fixture-copilot" },
    ];
  return (
    <nav className="flex gap-2" aria-label="Filtros">
      {opts.map((o) => {
        const active = o.key === activeRoute;
        return (
          <Link
            key={o.label}
            href={o.href}
            aria-current={active ? "page" : undefined}
            className="label rounded-[var(--radius-sm)] border px-2.5 py-1"
            style={{
              borderColor: active
                ? "var(--color-vermelho-low)"
                : "var(--color-line-subtle)",
              color: active
                ? "var(--color-vermelho)"
                : "var(--color-ink-muted)",
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SummaryGrid({
  summary,
  sample,
}: {
  summary: ReturnType<typeof summarize>;
  sample: number;
}) {
  // Estimated cost in USD using DeepSeek V3.2 pricing as a baseline. R1 is
  // ~2x — we don't split per-model yet, so this is an order-of-magnitude
  // figure, not an invoice.
  const costUsd =
    (summary.prompt_tokens / 1_000_000) * 0.27 +
    (summary.completion_tokens / 1_000_000) * 1.1;
  const items: Array<{ label: string; value: string }> = [
    { label: "amostra", value: `${sample} requests` },
    {
      label: "tokens (in / out)",
      value: `${summary.prompt_tokens.toLocaleString("pt-BR")} / ${summary.completion_tokens.toLocaleString("pt-BR")}`,
    },
    { label: "tokens totais", value: summary.total_tokens.toLocaleString("pt-BR") },
    {
      label: "custo estimado",
      value: `~ US$ ${costUsd.toFixed(4)}`,
    },
    {
      label: "latência média",
      value:
        summary.avg_latency_ms !== null
          ? `${summary.avg_latency_ms} ms`
          : "—",
    },
    {
      label: "erros",
      value:
        sample > 0
          ? `${summary.errors} (${((summary.errors / sample) * 100).toFixed(1)}%)`
          : "—",
    },
    {
      label: "cache hits",
      value:
        sample > 0
          ? `${Math.round(summary.cached_share * sample)} (${(summary.cached_share * 100).toFixed(0)}%)`
          : "—",
    },
    {
      label: "reasoner",
      value:
        sample > 0
          ? `${Math.round(summary.reasoner_share * sample)} (${(summary.reasoner_share * 100).toFixed(0)}%)`
          : "—",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="card flex flex-col gap-1 px-4 py-3"
        >
          <dt className="label text-[var(--color-ink-faint)]">{it.label}</dt>
          <dd className="num text-base tabular-nums text-[var(--color-ink)]">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LogsTable({ rows }: { rows: LogRow[] }) {
  return (
    <div className="mt-8 overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>quando</Th>
            <Th>rota</Th>
            <Th>modelo</Th>
            <Th className="num text-right">latência</Th>
            <Th className="num text-right">in</Th>
            <Th className="num text-right">out</Th>
            <Th>flags</Th>
            <Th>fixture</Th>
            <Th>status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-[var(--color-line-subtle)] last:border-0 hover:bg-[var(--color-surface-2)]"
            >
              <Td className="whitespace-nowrap text-[var(--color-ink-muted)]">
                {formatTime(r.created_at)}
              </Td>
              <Td>
                <span className="label">{r.route}</span>
              </Td>
              <Td className="text-[var(--color-ink-muted)]">
                {abbreviateModel(r.model)}
              </Td>
              <Td className="num text-right tabular-nums">
                {r.latency_ms != null ? `${r.latency_ms} ms` : "—"}
              </Td>
              <Td className="num text-right tabular-nums">
                {r.prompt_tokens ?? "—"}
              </Td>
              <Td className="num text-right tabular-nums">
                {r.completion_tokens ?? "—"}
              </Td>
              <Td>
                <FlagChips row={r} />
              </Td>
              <Td className="num tabular-nums">
                {r.fixture_id != null ? (
                  <Link
                    href={`/fixtures/${r.fixture_id}`}
                    className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  >
                    #{r.fixture_id}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                {r.error ? (
                  <span
                    title={r.error}
                    style={{ color: "var(--color-vermelho)" }}
                  >
                    erro
                  </span>
                ) : (
                  <span className="text-[var(--color-ink-faint)]">ok</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-[11px] font-normal uppercase tracking-[0.12em] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

function FlagChips({ row }: { row: LogRow }) {
  const flags: Array<{ label: string; key: string }> = [];
  if (row.cached) flags.push({ label: "cache", key: "c" });
  if (row.reasoner) flags.push({ label: "R1", key: "r" });
  if (row.follow_up) flags.push({ label: "follow-up", key: "f" });
  if (flags.length === 0) {
    return <span className="text-[var(--color-ink-faint)]">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f.key}
          className="label rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-muted)]"
        >
          {f.label}
        </span>
      ))}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function abbreviateModel(model: string): string {
  // "deepseek/deepseek-v3.2" → "v3.2"; "deepseek/deepseek-r1" → "r1".
  const parts = model.split("/");
  const last = parts[parts.length - 1] ?? model;
  return last
    .replace(/^deepseek-/, "")
    .replace(/-/g, " ");
}
