import type { AiRecommendationDTO } from "@/lib/ai-reco/reco-repository";
import { OnDemandButton } from "./on-demand-button";

/**
 * AiRecoPanel — inline IA recommendation surface on /fixtures/[id] (spec §7.1).
 *
 * Server Component. Reads the AiRecommendationDTO returned by
 * `getRecommendationForFixture` server-side and renders one of three states:
 *
 *  A. verdict='bet'  — full card with summary line, edge/kelly/units math,
 *                      reasoning, red flags and a model+cost footer.
 *  B. verdict='skip' — minimal card with "IA não vê valor" + reasoning.
 *  C. reco === null  — call-to-action that mounts the client OnDemandButton.
 *
 * B17 NOTE: this panel renders its own `<section>` with the `card` chrome
 * directly — the buildPanels caller wraps it WITHOUT a PanelShell so the
 * eyebrow/title we render here aren't duplicated. The section sits in the
 * body of the layout grid (the AI_RECO slot), never in an eyebrow.
 */

interface AiRecoPanelProps {
  reco: AiRecommendationDTO | null;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
}

function fmtNumber(v: number | null, digits = 1): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  return v.toFixed(digits);
}

function fmtCost(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "$—";
  return `$${v.toFixed(4)}`;
}

export function AiRecoPanel({
  reco,
  fixtureId,
  homeTeam,
  awayTeam,
}: AiRecoPanelProps) {
  if (reco === null) {
    return (
      <section
        data-section="ai-reco"
        data-ai-reco-verdict="none"
        className="card flex flex-col gap-3 p-4 lg:p-5"
      >
        <header className="flex items-baseline justify-between gap-2">
          <span className="label">recomendação IA</span>
          <span className="label text-[var(--color-ink-faint)]">
            sob demanda
          </span>
        </header>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Nenhuma análise IA salva para esta fixture. Peça uma agora.
        </p>
        <OnDemandButton
          fixtureId={fixtureId}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
        />
      </section>
    );
  }

  if (reco.verdict === "skip") {
    return (
      <section
        data-section="ai-reco"
        data-ai-reco-verdict="skip"
        className="card flex flex-col gap-2 p-4 lg:p-5"
      >
        <header className="flex items-baseline justify-between gap-2">
          <span className="label">recomendação IA</span>
          <span className="label text-[var(--color-ink-faint)]">skip</span>
        </header>
        <span className="font-display text-lg text-[var(--color-ink-display)]">
          IA não vê valor
        </span>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {reco.reasoning_full ?? "Nenhum mercado com edge >= 5%."}
        </p>
      </section>
    );
  }

  // State A — verdict='bet'
  const edge = fmtNumber(reco.edge_pct, 1);
  const kelly = fmtNumber(reco.kelly_pre, 1);
  const units = fmtNumber(reco.units_final, 1);
  const confidence = reco.confidence ?? "—";
  const calibrationLabel = reco.league_calibrated
    ? "liga calibrada"
    : "liga não-calibrada";

  return (
    <section
      data-section="ai-reco"
      data-ai-reco-verdict="bet"
      className="card flex flex-col gap-3 p-4 lg:p-5"
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className="label">
          recomendação IA · confiança {confidence}
        </span>
        <span className="label text-[var(--color-ink-faint)]">bet</span>
      </header>

      <div>
        <span className="num text-2xl font-bold text-[var(--color-ink-display)]">
          {reco.summary_line ?? "(sem summary)"}
        </span>
      </div>

      <div className="label text-[var(--color-ink-muted)]">
        <div>
          Edge {edge ?? "—"}% · Kelly {kelly ?? "—"}u → IA {units ?? "—"}u
        </div>
        {reco.reduction_reason ? (
          <div>Motivo redução: {reco.reduction_reason}</div>
        ) : null}
      </div>

      {reco.reasoning_full ? (
        <p className="text-sm text-[var(--color-ink)]">{reco.reasoning_full}</p>
      ) : null}

      {reco.red_flags.length > 0 ? (
        <ul className="label flex flex-col gap-1 text-[var(--color-ink-muted)]">
          <li className="font-semibold text-[var(--color-ink)]">Red flags:</li>
          {reco.red_flags.map((flag) => (
            <li key={flag}>• {flag}</li>
          ))}
        </ul>
      ) : null}

      <footer className="label text-[var(--color-ink-faint)]">
        Modelo: {reco.llm_model ?? "—"} · prompt {reco.prompt_version ?? "—"} ·{" "}
        {fmtCost(reco.cost_usd)} · {calibrationLabel}
      </footer>
    </section>
  );
}
