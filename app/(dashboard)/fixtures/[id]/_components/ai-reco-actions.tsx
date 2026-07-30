"use client";

/**
 * AiRecoActions — Client Component que orquestra o "loop de feedback"
 * (4 botões antigos) + modal "Apostei" (A2) + estado "linked" pós-bet.
 *
 * Renderizado dentro do AiRecoPanel (Server Component) para isolar a
 * interatividade. 3 estados visuais:
 *
 *  A. linked  (bet vinculada já existe ou foi criada nesta sessão) →
 *             mostra "✓ Apostou: R$ 21,00 @ 2.10 (Bet365) — bet #X [ver]"
 *             e omite os 4 botões.
 *  B. modal   (Pilot clicou "Apostei" mas ainda não confirmou) →
 *             botões + drawer ApostaiModal embaixo.
 *  C. default (nenhuma bet ainda) → 4 botões padrão.
 *
 * Após Confirmar no modal, o panel transita pra estado linked otimisticamente
 * com o `betId` devolvido pelo endpoint, mantendo coerência da UI sem
 * full re-fetch. router.refresh() garante que SSR pegue o estado correto
 * em navegações futuras.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FeedbackButtons } from "./feedback-buttons";
import type { ApostaiHouseOption } from "./apostei-modal";
import { AposteiBottomSheet } from "./apostei-bottom-sheet";
import { AddToSlipButton } from "@/components/bet-slip/add-to-slip-button";
import { applyStakeJitter } from "@/lib/ai-reco/stake-jitter";

export interface LinkedBetSummary {
  id: string;
  total_stake: number | string;
  total_odds: number | string;
  house_name: string | null;
  status: string;
}

type UserDecision = "agree" | "disagree" | "bet" | "no_bet";

interface AiRecoActionsProps {
  aiRecommendationId: number;
  /** Decisions já registradas em ai_reco_feedback (loop antigo). */
  existingDecisions: UserDecision[];
  /** Lista de casas pro dropdown — passada do SSR. */
  houses: ApostaiHouseOption[];
  /** Default odd pré-preenchido (= ai_recommendations.odd_captured). */
  defaultOdd: number | null;
  /**
   * Stake default em BRL — caller computa `units_final × unit_value` no
   * SSR. Cai pra 0 quando units_final é null (Pilot precisa digitar).
   */
  defaultStake: number;
  /** Market locked no modal (vem da reco). */
  market: string | null;
  /** Side locked no modal (vem da reco). */
  side: string | null;
  /**
   * Bet já vinculada a essa reco (preenchido pelo SSR quando existe).
   * Quando null, mostramos os 4 botões; quando preenchido, mostramos o
   * estado "✓ Apostou …".
   */
  linkedBet: LinkedBetSummary | null;
  /** Wave M: dados da fixture para o botão "+ bilhete" */
  fixtureId?: number | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  league?: string | null;
  kickoffUtc?: string | null;
}

function fmtBrl(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2).replace(".", ",");
}

function fmtOdd(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function AiRecoActions({
  aiRecommendationId,
  existingDecisions,
  houses,
  defaultOdd,
  defaultStake,
  market,
  side,
  linkedBet,
  fixtureId,
  homeTeam,
  awayTeam,
  league,
  kickoffUtc,
}: AiRecoActionsProps) {
  const router = useRouter();
  const [_pending, startTransition] = useTransition();
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  // Stake com jitter ±10% calculada uma vez ao abrir o modal (seed = recoId +
  // timestamp truncado ao minuto → diferente por sessão mas estável durante
  // a interação). Salvo em state para não mudar ao re-render.
  const [jitteredStake, setJitteredStake] = useState<number>(defaultStake);
  const [optimisticLinked, setOptimisticLinked] =
    useState<LinkedBetSummary | null>(null);

  void _pending;

  const effectiveLinked = optimisticLinked ?? linkedBet;

  if (effectiveLinked) {
    return (
      <div
        data-apostei-linked
        aria-live="polite"
        aria-atomic="true"
        className="label flex flex-wrap items-baseline gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-[var(--color-ink)]"
      >
        <span className="font-semibold text-[var(--color-vermelho)]">
          ✓ Apostou
        </span>
        <span>
          R$ {fmtBrl(effectiveLinked.total_stake)} @{" "}
          {fmtOdd(effectiveLinked.total_odds)}{" "}
          {effectiveLinked.house_name
            ? `(${effectiveLinked.house_name})`
            : ""}
        </span>
        <span className="text-[var(--color-ink-faint)]">
          — bet #{effectiveLinked.id.slice(0, 8)} · {effectiveLinked.status}
        </span>
        <a
          href={`/bets/${effectiveLinked.id}`}
          className="ml-auto text-[var(--color-vermelho)] underline-offset-2 hover:underline"
          data-apostei-linked-link
        >
          ver
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <FeedbackButtons
        aiRecommendationId={aiRecommendationId}
        existingDecisions={existingDecisions}
        onOpenApostei={() => {
          // Aplica jitter ±10% na stake ao abrir o modal.
          // Seed = recoId XOR minuto-atual → diferente por sessão mas
          // estável enquanto o modal fica aberto.
          if (defaultStake > 0) {
            const minuteSeed = Math.floor(Date.now() / 60000);
            setJitteredStake(
              applyStakeJitter(defaultStake, aiRecommendationId ^ minuteSeed),
            );
          }
          setModalOpen(true);
        }}
      />
      {/* Wave M — "+ bilhete" button alongside "Apostei agora" */}
      {fixtureId != null && market && side && defaultOdd && defaultOdd > 1 ? (
        <AddToSlipButton
          input={{
            ai_recommendation_id: aiRecommendationId,
            fixture_id: fixtureId,
            home_team: homeTeam ?? "—",
            away_team: awayTeam ?? "—",
            market: market,
            side: side,
            odd_taken: defaultOdd,
            league: league ?? null,
            kickoff_utc: kickoffUtc ?? null,
          }}
          ariaLabel={`${homeTeam} × ${awayTeam} — ${market}/${side}`}
        />
      ) : null}

      {/* Wave U — bottom sheet (substitui o ApostaiModal legacy);
          Wave B jitter aplicado no stake antes de abrir o sheet. */}
      <AposteiBottomSheet
        aiRecommendationId={aiRecommendationId}
        houses={houses}
        defaultOdd={defaultOdd}
        defaultStake={jitteredStake}
        market={market}
        side={side}
        open={modalOpen}
        onOpenChange={(v) => setModalOpen(v)}
        onCancel={() => setModalOpen(false)}
        onSuccess={(betId) => {
          setOptimisticLinked({
            id: betId,
            total_stake: 0, // Vai ser substituído no refresh()
            total_odds: defaultOdd ?? 0,
            house_name:
              houses.find((h) => h.id === houses[0]?.id)?.name ?? null,
            status: "pending",
          });
          setModalOpen(false);
          startTransition(() => {
            router.refresh();
          });
        }}
      />
    </div>
  );
}
