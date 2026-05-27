/**
 * /llm-observability — painel obsessivo de custo/latência/qualidade do IA-2.
 *
 * 4 painéis:
 *   1. cost-volume    custo + count em 24h/7d/30d, breakdown por modelo (30d).
 *   2. latency        p50/p90/p99 em 30d, error rate sobre o total.
 *   3. prompt-versions agrupa por prompt_version (30d) e tenta enriquecer com
 *                     ROI hipotético via join com `ai_recommendations` resolvidas.
 *   4. recent-logs    top 10 logs mais recentes (escalares apenas — sem modal).
 *
 * Leitura escalar-only de `llm_request_logs` e `ai_recommendations`
 * (jamais detail_json — Lição B12). Degrada graciosamente em qualquer falha:
 * cada painel renderiza com sua mensagem de erro se o read correspondente falhar.
 *
 * Spec: docs/superpowers/specs/2026-05-24-ai-recomendador-design.md §8
 */
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ── tipos escalares ──────────────────────────────────────────────────────────

interface LogRowLite {
  id: number;
  created_at: string; // ISO UTC
  route: string;
  model: string;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error: string | null;
  cost_usd: number | null;
  prompt_version: string | null;
}

interface AiRecoRowLite {
  id: number;
  status: "pending" | "resolved" | "unresolvable";
  verdict: "bet" | "skip";
  prompt_version: string | null;
  pl_units: number | null;
  bet_won: boolean | null;
  units_final: number | null;
}

// Janela em ms — 30 dias é o universo da query. Tudo dentro disso é
// filtrado/agregado em memória para os recortes de 24h/7d.
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

// ── page ─────────────────────────────────────────────────────────────────────

export default async function LlmObservabilityPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as { from: (t: string) => any };

  // eslint-disable-next-line react-hooks/purity
  const since30d = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();

  // Logs (janela 30d) — escalares apenas, sem prompt_snapshot/response_raw.
  let logs: LogRowLite[] = [];
  let logsError: string | null = null;
  try {
    const { data, error } = await admin
      .from("llm_request_logs")
      .select(
        "id, created_at, route, model, latency_ms, prompt_tokens, completion_tokens, total_tokens, error, cost_usd, prompt_version",
      )
      .gte("created_at", since30d)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error) throw new Error(error.message ?? "failed to fetch llm_request_logs");
    logs = (data ?? []) as LogRowLite[];
  } catch (err) {
    logsError = err instanceof Error ? err.message : "erro desconhecido";
  }

  // Recos resolvidas (todas) — para enriquecer ROI por prompt_version.
  let recos: AiRecoRowLite[] = [];
  let recosError: string | null = null;
  try {
    const { data, error } = await admin
      .from("ai_recommendations")
      .select("id, status, verdict, prompt_version, pl_units, bet_won, units_final")
      .eq("status", "resolved")
      .limit(10000);
    if (error)
      throw new Error(error.message ?? "failed to fetch ai_recommendations");
    recos = (data ?? []) as AiRecoRowLite[];
  } catch (err) {
    recosError = err instanceof Error ? err.message : "erro desconhecido";
  }

  // ── agregações ──────────────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const cost1d = aggregateCostVolume(logs, now - 1 * DAY_MS);
  const cost7d = aggregateCostVolume(logs, now - 7 * DAY_MS);
  const cost30d = aggregateCostVolume(logs, now - 30 * DAY_MS);
  const byModel = aggregateByModel(logs);
  const latency = aggregateLatency(logs);
  const promptStats = aggregatePromptVersions(logs, recos);
  const recent = logs.slice(0, 10);

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-8">
        <span className="label">observabilidade IA</span>
        <h2 className="mt-2">llm observability</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          custo, latência, qualidade dos prompts (IA-2 Recomendador). Janela 30 dias.
        </p>
      </header>

      {logsError && (
        <p
          className="card mb-8 p-4 text-sm"
          style={{ color: "var(--color-vermelho)" }}
          role="alert"
        >
          falha ao ler llm_request_logs: {logsError}
        </p>
      )}

      <section
        className="mt-4"
        data-section="cost-volume"
        aria-labelledby="cost-volume-h"
      >
        <h3 id="cost-volume-h" className="mb-4 text-base font-semibold">
          custo & volume
        </h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <KV label="24h custo (USD)" value={fmtUsd(cost1d.cost)} />
          <KV label="24h requests" value={`${cost1d.count}`} />
          <KV label="7d custo (USD)" value={fmtUsd(cost7d.cost)} />
          <KV label="7d requests" value={`${cost7d.count}`} />
          <KV label="30d custo (USD)" value={fmtUsd(cost30d.cost)} />
          <KV label="30d requests" value={`${cost30d.count}`} />
        </dl>
        {byModel.length > 0 ? (
          <div className="mt-6 overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
            <table className="w-full text-left text-sm">
              <caption className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                por modelo (30 dias)
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
                  <Th>modelo</Th>
                  <Th className="num text-right">requests</Th>
                  <Th className="num text-right">custo (USD)</Th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((m) => (
                  <tr
                    key={m.model}
                    className="border-b border-[var(--color-line-subtle)] last:border-0"
                  >
                    <Td className="text-[var(--color-ink-muted)]">
                      {abbreviateModel(m.model)}
                    </Td>
                    <Td className="num text-right tabular-nums">{m.count}</Td>
                    <Td className="num text-right tabular-nums">
                      {fmtUsd(m.cost)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="card mt-6 p-4 text-center text-sm italic text-[var(--color-ink-muted)]">
            sem requests nos últimos 30 dias.
          </p>
        )}
      </section>

      <section
        className="mt-12 border-t border-[var(--color-line-subtle)] pt-8"
        data-section="latency"
        aria-labelledby="latency-h"
      >
        <h3 id="latency-h" className="mb-4 text-base font-semibold">
          latência (30 dias)
        </h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KV
            label="p50"
            value={latency.p50 != null ? `${latency.p50} ms` : "—"}
          />
          <KV
            label="p90"
            value={latency.p90 != null ? `${latency.p90} ms` : "—"}
          />
          <KV
            label="p99"
            value={latency.p99 != null ? `${latency.p99} ms` : "—"}
          />
          <KV
            label="error rate"
            value={
              latency.totalCount > 0
                ? `${latency.errorCount}/${latency.totalCount} (${Math.round(
                    (latency.errorCount / latency.totalCount) * 100,
                  )}%)`
                : "—"
            }
          />
        </dl>
      </section>

      <section
        className="mt-12 border-t border-[var(--color-line-subtle)] pt-8"
        data-section="prompt-versions"
        aria-labelledby="prompt-versions-h"
      >
        <h3 id="prompt-versions-h" className="mb-4 text-base font-semibold">
          prompt versions ativos (30 dias)
        </h3>
        {recosError && (
          <p
            className="card mb-4 p-3 text-xs"
            style={{ color: "var(--color-vermelho)" }}
            role="alert"
          >
            ROI por prompt indisponível (ai_recommendations): {recosError}
          </p>
        )}
        {promptStats.length === 0 ? (
          <p className="card p-4 text-center text-sm italic text-[var(--color-ink-muted)]">
            nenhum prompt_version registrado ainda (logs novos do IA-2 incluem
            esse campo).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
                  <Th>prompt_version</Th>
                  <Th className="num text-right">requests</Th>
                  <Th className="num text-right">custo (USD)</Th>
                  <Th className="num text-right">recos resolvidas</Th>
                  <Th className="num text-right">P/L (u)</Th>
                  <Th className="num text-right">win rate</Th>
                </tr>
              </thead>
              <tbody>
                {promptStats.map((p) => (
                  <tr
                    key={p.promptVersion}
                    className="border-b border-[var(--color-line-subtle)] last:border-0"
                  >
                    <Td>{p.promptVersion}</Td>
                    <Td className="num text-right tabular-nums">{p.count}</Td>
                    <Td className="num text-right tabular-nums">
                      {fmtUsd(p.cost)}
                    </Td>
                    <Td className="num text-right tabular-nums">
                      {p.recoResolved}
                    </Td>
                    <Td className="num text-right tabular-nums">
                      {p.recoResolved > 0 ? p.totalPl.toFixed(2) : "—"}
                    </Td>
                    <Td className="num text-right tabular-nums">
                      {p.recoBets > 0
                        ? `${Math.round((p.recoWon / p.recoBets) * 100)}%`
                        : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="mt-12 border-t border-[var(--color-line-subtle)] pt-8"
        data-section="recent-logs"
        aria-labelledby="recent-logs-h"
      >
        <h3 id="recent-logs-h" className="mb-4 text-base font-semibold">
          top 10 logs recentes
        </h3>
        {recent.length === 0 ? (
          <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
            sem logs no período — nenhum request ainda.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
                  <Th>quando</Th>
                  <Th>rota</Th>
                  <Th>modelo</Th>
                  <Th className="num text-right">latência</Th>
                  <Th className="num text-right">tokens</Th>
                  <Th className="num text-right">custo (USD)</Th>
                  <Th>status</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
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
                      {r.total_tokens ?? "—"}
                    </Td>
                    <Td className="num text-right tabular-nums">
                      {fmtUsd(r.cost_usd ?? 0)}
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
        )}
      </section>
    </main>
  );
}

// ── agregações puras (testáveis isoladamente, embora cobertas via página) ────

interface CostVolume {
  cost: number;
  count: number;
}

function aggregateCostVolume(rows: LogRowLite[], sinceMs: number): CostVolume {
  let cost = 0;
  let count = 0;
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    if (Number.isFinite(t) && t >= sinceMs) {
      cost += Number(r.cost_usd ?? 0);
      count += 1;
    }
  }
  return { cost, count };
}

interface ByModelRow {
  model: string;
  count: number;
  cost: number;
}

function aggregateByModel(rows: LogRowLite[]): ByModelRow[] {
  const map = new Map<string, ByModelRow>();
  for (const r of rows) {
    const key = r.model || "(desconhecido)";
    const entry = map.get(key) ?? { model: key, count: 0, cost: 0 };
    entry.count += 1;
    entry.cost += Number(r.cost_usd ?? 0);
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

interface LatencySummary {
  p50: number | null;
  p90: number | null;
  p99: number | null;
  errorCount: number;
  totalCount: number;
}

function aggregateLatency(rows: LogRowLite[]): LatencySummary {
  const latencies: number[] = [];
  let errors = 0;
  for (const r of rows) {
    if (typeof r.latency_ms === "number" && Number.isFinite(r.latency_ms)) {
      latencies.push(r.latency_ms);
    }
    if (r.error) errors += 1;
  }
  latencies.sort((a, b) => a - b);
  return {
    p50: percentile(latencies, 0.5),
    p90: percentile(latencies, 0.9),
    p99: percentile(latencies, 0.99),
    errorCount: errors,
    totalCount: rows.length,
  };
}

/**
 * Percentil tipo continuous (similar a percentile_cont). Retorna null se
 * o array estiver vazio. Faz interpolação linear entre vizinhos.
 */
function percentile(sortedAsc: number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return Math.round(sortedAsc[0]);
  const pos = q * (sortedAsc.length - 1);
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  if (low === high) return Math.round(sortedAsc[low]);
  const frac = pos - low;
  return Math.round(sortedAsc[low] * (1 - frac) + sortedAsc[high] * frac);
}

interface PromptVersionStats {
  promptVersion: string;
  count: number;
  cost: number;
  recoResolved: number;
  recoBets: number;
  recoWon: number;
  totalPl: number;
}

function aggregatePromptVersions(
  logs: LogRowLite[],
  recos: AiRecoRowLite[],
): PromptVersionStats[] {
  const map = new Map<string, PromptVersionStats>();
  for (const r of logs) {
    if (!r.prompt_version) continue;
    const key = r.prompt_version;
    const entry =
      map.get(key) ?? {
        promptVersion: key,
        count: 0,
        cost: 0,
        recoResolved: 0,
        recoBets: 0,
        recoWon: 0,
        totalPl: 0,
      };
    entry.count += 1;
    entry.cost += Number(r.cost_usd ?? 0);
    map.set(key, entry);
  }
  for (const rc of recos) {
    if (!rc.prompt_version) continue;
    const entry = map.get(rc.prompt_version);
    if (!entry) continue; // só enriquece prompts que aparecem nos logs
    entry.recoResolved += 1;
    if (rc.verdict === "bet") {
      entry.recoBets += 1;
      if (rc.bet_won === true) entry.recoWon += 1;
      entry.totalPl += Number(rc.pl_units ?? 0);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// ── componentes auxiliares ───────────────────────────────────────────────────

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex flex-col gap-1 px-4 py-3">
      <dt className="label text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="num text-base tabular-nums text-[var(--color-ink)]">
        {value}
      </dd>
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

// ── formatters ───────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  // 4 casas pra capturar custos << 1 cent comum em DeepSeek; ainda legível.
  return v.toFixed(4);
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
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
  return last.replace(/^deepseek-/, "").replace(/-/g, " ");
}
