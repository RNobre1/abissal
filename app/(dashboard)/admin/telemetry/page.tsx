import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { authedUserId } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * /admin/telemetry — Dashboard de telemetria de UX.
 *
 * Server Component. Requer autenticação (redireciona pra /login se não
 * autenticado). Usa service_role para ler todos os eventos (bypass RLS).
 *
 * 3 cards:
 *   1. Funil apostei: apostei_modal_open → apostei_modal_confirm (rate %)
 *   2. Top 5 painéis mais vistos (panel_view por panel_id)
 *   3. Taxa de abandono do modal (cancel / (confirm + cancel) %)
 *
 * Se a migration 0028 ainda não foi aplicada, cada query retorna 0 resultados
 * e o dashboard mostra "sem dados" — não quebra.
 */

interface PanelCount {
  panel_id: string;
  count: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

async function fetchEventCounts(
  supabase: AnySupabase,
  eventTypes: string[],
  since: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const et of eventTypes) {
    try {
      const { count, error } = await supabase
        .from("ui_telemetry")
        .select("id", { count: "exact", head: true })
        .eq("event_type", et)
        .gte("created_at", since);
      if (!error) map.set(et, count ?? 0);
      else map.set(et, 0);
    } catch {
      map.set(et, 0);
    }
  }
  return map;
}

async function fetchTopPanels(
  supabase: AnySupabase,
  since: string,
): Promise<PanelCount[]> {
  try {
    const { data, error } = await supabase
      .from("ui_telemetry")
      .select("panel_id")
      .eq("event_type", "panel_view")
      .gte("created_at", since)
      .not("panel_id", "is", null);

    if (error || !data) return [];

    const counts = new Map<string, number>();
    for (const row of data as Array<{ panel_id: string | null }>) {
      if (row.panel_id) counts.set(row.panel_id, (counts.get(row.panel_id) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([panel_id, count]) => ({ panel_id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export default async function TelemetryDashboardPage() {
  // Auth guard
  const userClient = await createClient();
  const userId = await authedUserId(userClient);
  if (!userId) redirect("/login");

  const admin = createAdminClient();

  // Last 30 days window
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [eventCounts, topPanels] = await Promise.all([
    fetchEventCounts(
      admin,
      [
        "apostei_modal_open",
        "apostei_modal_confirm",
        "apostei_modal_cancel",
        "apostei_modal_stake_zero",
        "feedback_button_click",
        "ondemand_button_click",
        "ondemand_response_received",
      ],
      since,
    ),
    fetchTopPanels(admin, since),
  ]);

  const opens = eventCounts.get("apostei_modal_open") ?? 0;
  const confirms = eventCounts.get("apostei_modal_confirm") ?? 0;
  const cancels = eventCounts.get("apostei_modal_cancel") ?? 0;
  const stakeZeros = eventCounts.get("apostei_modal_stake_zero") ?? 0;
  const feedbackClicks = eventCounts.get("feedback_button_click") ?? 0;
  const ondemandClicks = eventCounts.get("ondemand_button_click") ?? 0;
  const ondemandResponses = eventCounts.get("ondemand_response_received") ?? 0;

  const confirmRate = pct(confirms, opens);
  const abandonRate = pct(cancels, confirms + cancels);

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 lg:px-12 lg:py-16"
    >
      <header className="mb-10">
        <span className="label">admin</span>
        <h2 className="mt-2">telemetria UX</h2>
        <p className="label mt-1 text-[var(--color-ink-muted)]">
          últimos 30 dias · apenas usuário autenticado pode visualizar
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Card 1 — Funil apostei */}
        <section
          className="card flex flex-col gap-3 p-5"
          aria-label="funil apostei"
        >
          <h3 className="label font-semibold text-[var(--color-ink)]">
            funil apostei
          </h3>
          <dl className="flex flex-col gap-2">
            <div className="flex justify-between">
              <dt className="label text-[var(--color-ink-muted)]">aberturas</dt>
              <dd className="num font-mono tabular-nums">{opens}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="label text-[var(--color-ink-muted)]">confirmações</dt>
              <dd className="num font-mono tabular-nums">{confirms}</dd>
            </div>
            <div className="flex justify-between border-t border-[var(--color-line)] pt-2">
              <dt className="label text-[var(--color-ink-muted)]">
                taxa de conversão
              </dt>
              <dd className="num font-mono tabular-nums font-semibold text-[var(--color-ink)]">
                {confirmRate}
              </dd>
            </div>
            {stakeZeros > 0 && (
              <div className="flex justify-between">
                <dt className="label text-[var(--color-vermelho)]">
                  ⚠ stake zero
                </dt>
                <dd className="num font-mono tabular-nums text-[var(--color-vermelho)]">
                  {stakeZeros}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Card 2 — Top painéis vistos */}
        <section
          className="card flex flex-col gap-3 p-5"
          aria-label="top painéis vistos"
        >
          <h3 className="label font-semibold text-[var(--color-ink)]">
            top 5 painéis
          </h3>
          {topPanels.length === 0 ? (
            <p className="label text-[var(--color-ink-faint)]">sem dados</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {topPanels.map(({ panel_id, count }, i) => (
                <li key={panel_id} className="flex items-center justify-between">
                  <span className="label text-[var(--color-ink-muted)]">
                    <span className="num font-mono">{i + 1}.</span> {panel_id}
                  </span>
                  <span className="num font-mono tabular-nums">{count}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Card 3 — Abandono do modal */}
        <section
          className="card flex flex-col gap-3 p-5"
          aria-label="abandono do modal"
        >
          <h3 className="label font-semibold text-[var(--color-ink)]">
            abandono do modal
          </h3>
          <dl className="flex flex-col gap-2">
            <div className="flex justify-between">
              <dt className="label text-[var(--color-ink-muted)]">cancelamentos</dt>
              <dd className="num font-mono tabular-nums">{cancels}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="label text-[var(--color-ink-muted)]">confirmações</dt>
              <dd className="num font-mono tabular-nums">{confirms}</dd>
            </div>
            <div className="flex justify-between border-t border-[var(--color-line)] pt-2">
              <dt className="label text-[var(--color-ink-muted)]">
                taxa de abandono
              </dt>
              <dd className="num font-mono tabular-nums font-semibold text-[var(--color-ink)]">
                {abandonRate}
              </dd>
            </div>
          </dl>

          <div className="mt-2 flex flex-col gap-1 border-t border-[var(--color-line)] pt-2">
            <h4 className="label text-[var(--color-ink-muted)]">outros eventos</h4>
            <div className="flex justify-between">
              <span className="label text-[var(--color-ink-muted)]">feedback clicks</span>
              <span className="num font-mono tabular-nums">{feedbackClicks}</span>
            </div>
            <div className="flex justify-between">
              <span className="label text-[var(--color-ink-muted)]">on-demand cliques</span>
              <span className="num font-mono tabular-nums">{ondemandClicks}</span>
            </div>
            <div className="flex justify-between">
              <span className="label text-[var(--color-ink-muted)]">on-demand respostas</span>
              <span className="num font-mono tabular-nums">{ondemandResponses}</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
