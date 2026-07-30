import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchTopOpportunities,
  type AiRecommendationDTO,
} from "@/lib/ai-reco/reco-repository";
import { OportunidadeIaCard } from "@/components/oportunidades/oportunidade-ia-card";
import {
  DAILY_BRIEFING_KEY,
  parseBriefingValue,
  isBriefingFresh,
  brtDateIso,
  type DailyBriefingValue,
} from "@/lib/briefing/compose";

/**
 * BriefingDoDia (F4 — "Abissal Daily") — card no topo do /painel com o
 * parágrafo diário gerado por LLM (cron ai-reco → scripts/briefing/
 * generate-daily.ts → app_settings.daily_briefing). Substitui a lista
 * <OportunidadesIa /> por decisão do Pilot; a ação "+ bilhete" não se perde:
 * as top 3 oportunidades do dia aparecem compactas abaixo do texto, reusando
 * o OportunidadeIaCard.
 *
 * Regras de exibição:
 * - briefing ausente, malformado ou stale (date ≠ hoje BRT) ⇒ null, sem
 *   placeholder — o painel simplesmente não tem a seção;
 * - quiet mode: gating é da PÁGINA (mesmo branch de DestaquesDoDia) — o
 *   briefing contém sugestão de aposta, então quiet mode ativo o esconde;
 * - leitura via client autenticado (app_settings tem authenticated SELECT);
 *   as oportunidades usam o admin client como a OportunidadesIa original
 *   (ai_recommendations é dado compartilhado, não user-scoped).
 */
export async function BriefingDoDia() {
  const briefing = await fetchBriefing();
  if (!briefing || !isBriefingFresh(briefing, brtDateIso())) return null;

  let tops: AiRecommendationDTO[] = [];
  try {
    tops = await fetchTopOpportunities(createAdminClient(), 3);
  } catch {
    tops = [];
  }

  const [y, m, d] = briefing.date.split("-");

  return (
    <section
      data-section="briefing-do-dia"
      className="card mb-8 flex flex-col gap-3 p-4 lg:p-5"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-xl">briefing do dia</h2>
        <span className="num label">{`${d}/${m}/${y}`}</span>
      </header>
      <p className="max-w-prose text-sm leading-relaxed text-[var(--color-ink)]">
        {briefing.text}
      </p>
      {tops.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-[var(--color-line)] pt-3">
          <span className="label">
            top {tops.length} do dia · verdict=bet
          </span>
          <ul className="flex flex-col gap-2">
            {tops.map((r) => (
              <OportunidadeIaCard key={r.id} reco={r} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Forma mínima do client — `app_settings` está fora dos types gerados de
 * `Database` até o próximo regen (mesmo workaround de lib/settings/ai-toggle).
 */
type SettingsReader = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: { value: unknown } | null;
          error: unknown;
        }>;
      };
    };
  };
};

/** Lê e valida `app_settings.daily_briefing`. Qualquer falha ⇒ null. */
async function fetchBriefing(): Promise<DailyBriefingValue | null> {
  try {
    const supabase = (await createClient()) as unknown as SettingsReader;
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", DAILY_BRIEFING_KEY)
      .maybeSingle();
    if (error || !data) return null;
    return parseBriefingValue(data.value);
  } catch {
    return null;
  }
}
