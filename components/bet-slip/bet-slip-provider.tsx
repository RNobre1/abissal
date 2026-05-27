"use client";

/**
 * BetSlipProvider — Client Component container que:
 *  - Mantém o estado local do slip (legs, stake, drawer open)
 *  - Renderiza o FAB + Drawer em conjunto
 *  - Chama as server actions de forma otimista
 *
 * Recebe o draft slip inicial do SSR via props (para hidratação instantânea).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BetSlipFAB } from "./bet-slip-fab";
import { BetSlipDrawer } from "./bet-slip-drawer";
import { useTelemetry } from "@/lib/telemetry/use-telemetry";
import {
  computeOddCombined,
  computePotentialReturn,
  detectConflicts,
  type BetSlip,
  type SlipLeg,
} from "@/lib/bet-slip/compute";
import {
  removeLegFromSlip,
  updateSlipStake,
  commitSlip,
  cancelSlip,
} from "@/lib/bet-slip/actions";

interface HouseOption {
  id: string;
  name: string;
}

interface BetSlipProviderProps {
  initialSlip: BetSlip | null;
  houses: HouseOption[];
}

export function BetSlipProvider({ initialSlip, houses }: BetSlipProviderProps) {
  const router = useRouter();
  const track = useTelemetry();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [slip, setSlip] = useState<BetSlip | null>(initialSlip);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [committing, startCommitting] = useTransition();
  const [, startRefresh] = useTransition();

  const legs: SlipLeg[] = slip?.bet_slip_legs ?? [];
  const stakeTotal = slip?.stake_total ?? null;
  const oddCombined = computeOddCombined(legs);
  const potentialReturn =
    stakeTotal != null ? computePotentialReturn(stakeTotal, oddCombined) : null;
  const conflicts = detectConflicts(legs);

  async function handleRemoveLeg(legId: number) {
    setRemovingId(legId);
    // Optimistic remove
    if (slip) {
      setSlip({
        ...slip,
        bet_slip_legs: slip.bet_slip_legs.filter((l) => l.id !== legId),
      });
    }
    await removeLegFromSlip(legId);
    setRemovingId(null);
    startRefresh(() => {
      router.refresh();
    });
  }

  async function handleStakeChange(value: number | null) {
    if (!slip) return;
    setSlip({
      ...slip,
      stake_total: value,
      potential_return:
        value != null ? computePotentialReturn(value, oddCombined) : null,
    });
    if (value != null && value > 0) {
      await updateSlipStake(slip.id, value);
    }
  }

  function handleCommit(houseId: string) {
    if (!slip) return;
    startCommitting(async () => {
      const result = await commitSlip(slip.id, houseId);
      if (result.error) {
        alert(`Erro: ${result.error}`);
        return;
      }
      track("bilhete_slip_committed", {
        leg_count: legs.length,
        odd_combined: oddCombined,
        has_stake: stakeTotal != null,
      });
      setSlip(null);
      setDrawerOpen(false);
      router.push(`/bets/${result.betId}`);
    });
  }

  async function handleCancel() {
    if (!slip) return;
    await cancelSlip(slip.id);
    setSlip(null);
    setDrawerOpen(false);
    router.refresh();
  }

  function handleLegsAdded() {
    startRefresh(() => {
      router.refresh();
    });
  }

  if (legs.length === 0) return null;

  return (
    <>
      <BetSlipFAB
        legs={legs}
        oddCombined={oddCombined}
        stakeTotal={stakeTotal}
        onOpen={() => setDrawerOpen(true)}
      />
      {drawerOpen ? (
        <BetSlipDrawer
          legs={legs}
          oddCombined={oddCombined}
          stakeTotal={stakeTotal}
          potentialReturn={potentialReturn}
          conflicts={conflicts}
          removing={removingId}
          committing={committing}
          onRemoveLeg={handleRemoveLeg}
          onStakeChange={handleStakeChange}
          onClose={() => setDrawerOpen(false)}
          houses={houses}
          onCommit={handleCommit}
          onCancel={handleCancel}
          onLegsAdded={handleLegsAdded}
        />
      ) : null}
    </>
  );
}
