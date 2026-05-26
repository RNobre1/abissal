import type { AiRecommendationDTO } from "@/lib/ai-reco/reco-repository";
import type {
  AiRecoFeedbackDTO,
  UserDecision,
} from "@/lib/ai-reco/feedback-repository";
import { OnDemandButton } from "./on-demand-button";
import {
  AiRecoActions,
  type LinkedBetSummary,
} from "./ai-reco-actions";
import type { ApostaiHouseOption } from "./apostei-modal";

/**
 * AiRecoPanel — inline IA recommendation surface on /fixtures/[id] (spec §7.1).
 *
 * Server Component. Reads the AiRecommendationDTO returned by
 * `getRecommendationForFixture` server-side and renders one of three states:
 *
 *  A. verdict='bet'  — full card with summary line, edge/kelly/units math,
 *                      reasoning, red flags, model+cost footer e os 4 botões
 *                      de feedback humano (loop concordo/discordo/apostei/não).
 *  B. verdict='skip' — minimal card with "IA não vê valor" + reasoning + idem
 *                      4 botões de feedback humano.
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
  /**
   * Linhas existentes em `ai_reco_feedback` para este reco. Vazio se ainda
   * não houve feedback ou se a leitura degradou (tabela ausente, etc.).
   */
  feedback?: AiRecoFeedbackDTO[];
  /**
   * A2 — Casas disponíveis para o dropdown do modal "Apostei". Quando
   * vazio/ausente, o modal mostra "(nenhuma casa cadastrada)" e o Pilot
   * precisa criar uma em /houses/new antes.
   */
  houses?: ApostaiHouseOption[];
  /**
   * A2 — Bet já vinculada a esta reco (via bets.ai_recommendation_id,
   * migration 0025). Quando preenchida, substitui os 4 botões de feedback
   * por um summary "✓ Apostou …". Null em todos os outros casos.
   */
  linkedBet?: LinkedBetSummary | null;
  /**
   * A2 — Stake default em BRL já calculada pelo caller (SSR) via
   * `computeDefaultStake(units_final, bankrollSettings)`. Default 0 →
   * o Pilot digita o valor manualmente.
   *
   * Substitui o `unitValue` placeholder anterior (fix #1: defaultStake=0 bug).
   */
  defaultStake?: number;
}

function fmtNumber(v: number | null, digits = 1): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  return v.toFixed(digits);
}

function fmtCost(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "$—";
  return `$${v.toFixed(4)}`;
}

function existingDecisions(
  feedback: AiRecoFeedbackDTO[] | undefined,
): UserDecision[] {
  if (!feedback || feedback.length === 0) return [];
  return feedback.map((f) => f.user_decision);
}

function feedbackFooter(feedback: AiRecoFeedbackDTO[] | undefined) {
  if (!feedback || feedback.length === 0) return null;
  const latestComment = feedback.find(
    (f) => typeof f.comment === "string" && f.comment.trim().length > 0,
  )?.comment;
  return (
    <div
      data-feedback-summary
      className="label flex flex-col gap-1 text-[var(--color-ink-muted)]"
    >
      <div className="font-semibold text-[var(--color-ink)]">
        Feedback humano registrado:
      </div>
      <ul className="flex flex-col gap-0.5">
        {feedback.map((f) => (
          <li key={f.id} data-feedback-saved-row={f.user_decision}>
            • {decisionLabel(f.user_decision)}
            {f.comment ? ` — "${f.comment}"` : ""}
          </li>
        ))}
      </ul>
      {/* surface most recent comment outside the list as well for screen-readers */}
      <span className="sr-only">{latestComment ?? ""}</span>
    </div>
  );
}

function decisionLabel(d: UserDecision): string {
  switch (d) {
    case "agree":
      return "Concordo";
    case "disagree":
      return "Discordo";
    case "bet":
      return "Apostei";
    case "no_bet":
      return "Não apostei";
  }
}

export function AiRecoPanel({
  reco,
  fixtureId,
  homeTeam,
  awayTeam,
  feedback,
  houses = [],
  linkedBet = null,
  defaultStake = 0,
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
        {feedbackFooter(feedback)}
        <AiRecoActions
          aiRecommendationId={reco.id}
          existingDecisions={existingDecisions(feedback)}
          houses={houses}
          defaultOdd={reco.odd_captured ?? null}
          defaultStake={defaultStake}
          market={reco.market}
          side={reco.side}
          linkedBet={linkedBet}
        />
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
        Modelo:{" "}
        <span data-ai-reco-model={reco.llm_model ?? ""}>
          {reco.llm_model ?? "—"}
        </span>{" "}
        · prompt {reco.prompt_version ?? "—"} · {fmtCost(reco.cost_usd)} ·{" "}
        {calibrationLabel}
      </footer>

      {feedbackFooter(feedback)}
      <AiRecoActions
        aiRecommendationId={reco.id}
        existingDecisions={existingDecisions(feedback)}
        houses={houses}
        defaultOdd={reco.odd_captured ?? null}
        defaultStake={defaultStake}
        market={reco.market}
        side={reco.side}
        linkedBet={linkedBet}
      />
    </section>
  );
}
