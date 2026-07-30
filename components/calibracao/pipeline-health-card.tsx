/**
 * PipelineHealthCard — status do pipeline de dados no topo de /calibracao.
 *
 * Server Component (RSC) — zero JS no client. Dados pré-computados no caller
 * (CalibracaoPage) via Supabase admin client.
 *
 * Semáforos:
 *   scrape: verde ≤26h · amarelo 26-36h · vermelho >36h / null
 *   sims:   verde ≥50 · amarelo 10-50 · vermelho <10
 *   reconciler: verde <24h · amarelo 24-48h · vermelho >48h / null
 *   pending: verde 0 · amarelo 1-20 · vermelho >20
 */

export interface TopLeague {
  league: string;
  count: number;
}

export interface PipelineHealthData {
  /** ISO timestamp do último scrape (max fixtures.scraped_at) */
  lastScrapeAt: string | null;
  /** count(*) de fixture_simulations criadas hoje BRT */
  simsToday: number;
  /** ISO timestamp do último reconcile (max ai_recommendations.resolved_at) */
  lastReconciledAt: string | null;
  /** recos pending com kickoff_utc < now()-3h */
  recoPendingPastKickoff: number;
  /** top 5 ligas por volume de recos resolvidas */
  topLeagues: TopLeague[];
}

type SemaforoStatus = "verde" | "amarelo" | "vermelho";

function scrapeStatus(lastScrapeAt: string | null): SemaforoStatus {
  if (!lastScrapeAt) return "vermelho";
  const hoursAgo = (Date.now() - new Date(lastScrapeAt).getTime()) / (1000 * 60 * 60);
  if (hoursAgo <= 26) return "verde";
  if (hoursAgo <= 36) return "amarelo";
  return "vermelho";
}

function simsStatus(count: number): SemaforoStatus {
  if (count >= 50) return "verde";
  if (count >= 10) return "amarelo";
  return "vermelho";
}

function reconcilerStatus(lastReconciledAt: string | null): SemaforoStatus {
  if (!lastReconciledAt) return "vermelho";
  const hoursAgo = (Date.now() - new Date(lastReconciledAt).getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 24) return "verde";
  if (hoursAgo < 48) return "amarelo";
  return "vermelho";
}

function pendingStatus(count: number): SemaforoStatus {
  if (count === 0) return "verde";
  if (count <= 20) return "amarelo";
  return "vermelho";
}

const STATUS_COLORS: Record<SemaforoStatus, string> = {
  verde: "text-[var(--color-success)]",
  amarelo: "text-[var(--color-warning)]",
  vermelho: "text-[var(--color-vermelho)]",
};

const STATUS_BG: Record<SemaforoStatus, string> = {
  verde: "border-[color-mix(in_srgb,var(--color-success)_20%,transparent)]",
  amarelo: "border-[color-mix(in_srgb,var(--color-warning)_20%,transparent)]",
  vermelho: "border-[color-mix(in_srgb,var(--color-vermelho)_20%,transparent)]",
};

const STATUS_DOT: Record<SemaforoStatus, string> = {
  verde: "bg-[var(--color-success)]",
  amarelo: "bg-[var(--color-warning)]",
  vermelho: "bg-[var(--color-vermelho)]",
};

const STATUS_LABEL: Record<SemaforoStatus, string> = {
  verde: "ok",
  amarelo: "atenção",
  vermelho: "falha",
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.round(hrs / 24)}d atrás`;
}

interface MiniCardProps {
  id: "scrape" | "sims" | "reconciler" | "pending";
  label: string;
  value: string;
  timestamp?: string;
  status: SemaforoStatus;
}

function MiniCard({ id, label, value, timestamp, status }: MiniCardProps) {
  return (
    <div
      data-semaforo={id}
      data-status={status}
      className={`card flex flex-col gap-2 border px-4 py-3 ${STATUS_BG[status]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label text-[var(--color-ink-muted)]">{label}</span>
        <span
          aria-label={STATUS_LABEL[status]}
          className={`inline-flex items-center gap-1 text-[10px] font-medium ${STATUS_COLORS[status]}`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`}
          />
          {STATUS_LABEL[status]}
        </span>
      </div>
      <span className={`num text-xl font-semibold tabular-nums ${STATUS_COLORS[status]}`}>
        {value}
      </span>
      {timestamp && (
        <span className="text-[10px] text-[var(--color-ink-faint)]">{timestamp}</span>
      )}
    </div>
  );
}

export function PipelineHealthCard({ data }: { data: PipelineHealthData }) {
  const sScrape = scrapeStatus(data.lastScrapeAt);
  const sSims = simsStatus(data.simsToday);
  const sReconciler = reconcilerStatus(data.lastReconciledAt);
  const sPending = pendingStatus(data.recoPendingPastKickoff);

  return (
    <section
      aria-label="saúde do pipeline"
      className="mb-10 rounded-[var(--radius)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-1)] p-5"
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="label text-[var(--color-ink-faint)]">pipeline</span>
        <span className="label text-[var(--color-ink-faint)]">·</span>
        <span className="text-xs text-[var(--color-ink-muted)]">
          dados em tempo real
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniCard
          id="scrape"
          label="último scrape"
          value={fmtRelative(data.lastScrapeAt)}
          timestamp={
            data.lastScrapeAt
              ? new Date(data.lastScrapeAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
              : undefined
          }
          status={sScrape}
        />
        <MiniCard
          id="sims"
          label="sims hoje"
          value={`${data.simsToday}`}
          timestamp="target ≥ 50"
          status={sSims}
        />
        <MiniCard
          id="reconciler"
          label="reconciler"
          value={fmtRelative(data.lastReconciledAt)}
          timestamp={
            data.lastReconciledAt
              ? new Date(data.lastReconciledAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
              : undefined
          }
          status={sReconciler}
        />
        <MiniCard
          id="pending"
          label="recos pendentes (pós-KO)"
          value={`${data.recoPendingPastKickoff}`}
          timestamp="alvo: 0"
          status={sPending}
        />
      </div>

      {data.topLeagues.length > 0 && (
        <div className="mt-4 border-t border-[var(--color-line-subtle)] pt-4">
          <span className="label mb-2 block text-[var(--color-ink-faint)]">
            top ligas (recos resolvidas)
          </span>
          <div className="flex flex-wrap gap-2">
            {data.topLeagues.map((l) => {
              const max = data.topLeagues[0]?.count ?? 1;
              const pct = Math.round((l.count / max) * 100);
              return (
                <div
                  key={l.league}
                  className="flex items-center gap-2 rounded bg-[var(--color-surface-2)] px-3 py-1.5"
                >
                  <span className="text-xs text-[var(--color-ink-muted)]">{l.league}</span>
                  <span
                    aria-label={`${l.count} recos`}
                    className="num text-xs font-semibold tabular-nums text-[var(--color-ink)]"
                  >
                    {l.count}
                  </span>
                  {/* sparkbar */}
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 rounded-full bg-[var(--color-vermelho)]"
                    style={{ width: `${Math.max(pct, 8)}px`, opacity: 0.6 }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
