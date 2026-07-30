/**
 * TDD — F2 "Advogado do diabo do bilhete": UI.
 *
 *  - <BilheteCriticPanel> renderiza veredicto por perna (cor por classe) +
 *    resumo geral + flags de correlação.
 *  - <BilheteCriticSection> = botão "Criticar bilhete" + estados
 *    (loading com timer, erro acionável, kill switch off → botão some) +
 *    telemetria (bilhete_critic_click / bilhete_critic_result c/ elapsed_ms).
 *  - Integração: o botão aparece no BetSlipDrawer e na página /bilhete.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Mock useTelemetry ───────────────────────────────────────────────────────
const mockTrack = vi.fn();
vi.mock("@/lib/telemetry/use-telemetry", () => ({
  useTelemetry: () => mockTrack,
}));

// ── Mock next/navigation (drawer/page usam) ────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// ── Mock bet-slip actions (page client importa) ────────────────────────────
vi.mock("@/lib/bet-slip/actions", () => ({
  addLegToSlip: vi.fn(),
  commitSlip: vi.fn(),
  cancelSlip: vi.fn(),
  removeLegFromSlip: vi.fn(),
  updateSlipStake: vi.fn(),
}));

// ── Mock OCR import (NÃO tocar o componente real — outro agente) ───────────
vi.mock("@/components/bet-slip/bet-slip-photo-import", () => ({
  BetSlipPhotoImport: () => null,
}));

import type { SlipLeg, BetSlip } from "@/lib/bet-slip/compute";

function makeLeg(id: number, oddTaken = 2.0): SlipLeg {
  return {
    id,
    slip_id: 1,
    fixture_id: 100 + id,
    home_team: "HomeFC",
    away_team: "AwayFC",
    market: "1x2",
    side: "home",
    odd_taken: oddTaken,
    league: "Premier League",
    kickoff_utc: null,
    created_at: "2026-07-30T10:00:00Z",
    ai_recommendation_id: null,
    sport_id: null,
    market_id: null,
  };
}

function makeSlip(legs: SlipLeg[]): BetSlip {
  return {
    id: 1,
    user_id: "u1",
    status: "draft",
    stake_total: 50,
    odd_combined: null,
    potential_return: null,
    bet_id: null,
    thesis: null,
    created_at: "2026-07-30T10:00:00Z",
    updated_at: "2026-07-30T10:00:00Z",
    bet_slip_legs: legs,
  };
}

const CRITIC_RESULT = {
  legs: [
    {
      verdict: "ok",
      why: "Edge positivo.",
      home: "HomeFC",
      away: "AwayFC",
      market: "1x2",
      side: "home",
      odd: 2.0,
      has_model_data: true,
      prob_calibrated: 0.55,
      edge_pct: 10,
    },
    {
      verdict: "fuga",
      why: "Empate mora aqui.",
      home: "HomeFC",
      away: "AwayFC",
      market: "1x2",
      side: "home",
      odd: 1.8,
      has_model_data: false,
      prob_calibrated: null,
      edge_pct: null,
    },
  ],
  overall: {
    summary: "Bilhete arriscado.",
    correlation_flags: ["duas pernas 1x2"],
    ev_comment: "EV marginal.",
  },
  latencyMs: 1234,
};

function okFetch(body: unknown = CRITIC_RESULT) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ── BilheteCriticPanel ──────────────────────────────────────────────────────

describe("<BilheteCriticPanel>", () => {
  it("renderiza veredicto por perna com data-critic-verdict e o porquê", async () => {
    const { BilheteCriticPanel } = await import(
      "@/components/bet-slip/bilhete-critic-panel"
    );
    const { container } = render(
      <BilheteCriticPanel
        legs={CRITIC_RESULT.legs}
        overall={CRITIC_RESULT.overall}
      />,
    );

    const rows = container.querySelectorAll("[data-critic-verdict]");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-critic-verdict")).toBe("ok");
    expect(rows[1].getAttribute("data-critic-verdict")).toBe("fuga");
    expect(screen.getByText("Edge positivo.")).toBeInTheDocument();
    expect(screen.getByText("Empate mora aqui.")).toBeInTheDocument();
  });

  it("mostra resumo geral, flags de correlação e comentário de EV", async () => {
    const { BilheteCriticPanel } = await import(
      "@/components/bet-slip/bilhete-critic-panel"
    );
    render(
      <BilheteCriticPanel
        legs={CRITIC_RESULT.legs}
        overall={CRITIC_RESULT.overall}
      />,
    );
    expect(screen.getByText("Bilhete arriscado.")).toBeInTheDocument();
    expect(screen.getByText(/duas pernas 1x2/)).toBeInTheDocument();
    expect(screen.getByText(/EV marginal/)).toBeInTheDocument();
  });

  it("marca a perna sem dados do modelo", async () => {
    const { BilheteCriticPanel } = await import(
      "@/components/bet-slip/bilhete-critic-panel"
    );
    render(
      <BilheteCriticPanel
        legs={CRITIC_RESULT.legs}
        overall={CRITIC_RESULT.overall}
      />,
    );
    expect(screen.getByText(/sem dados do modelo/i)).toBeInTheDocument();
  });
});

// ── BilheteCriticSection ────────────────────────────────────────────────────

describe("<BilheteCriticSection>", () => {
  const legs = [makeLeg(1, 2.0), makeLeg(2, 1.8)];

  it("kill switch off (aiEnabled=false) → botão some", async () => {
    const { BilheteCriticSection } = await import(
      "@/components/bet-slip/bilhete-critic-panel"
    );
    render(
      <BilheteCriticSection
        legs={legs}
        stakeTotal={50}
        oddCombined={3.6}
        aiEnabled={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /criticar bilhete/i }),
    ).not.toBeInTheDocument();
  });

  it("clique → telemetria bilhete_critic_click + POST com as pernas", async () => {
    const mockFetch = okFetch();
    vi.stubGlobal("fetch", mockFetch);
    const { BilheteCriticSection } = await import(
      "@/components/bet-slip/bilhete-critic-panel"
    );
    render(
      <BilheteCriticSection legs={legs} stakeTotal={50} oddCombined={3.6} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /criticar bilhete/i }));
    });

    expect(mockTrack).toHaveBeenCalledWith("bilhete_critic_click", {
      leg_count: 2,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/bilhete/critic");
    const sent = JSON.parse(init.body as string) as {
      legs: Array<{ fixtureId?: number; home: string; odd: number }>;
      stakeTotal: number | null;
      oddCombined: number;
    };
    expect(sent.legs).toHaveLength(2);
    expect(sent.legs[0].home).toBe("HomeFC");
    expect(sent.legs[0].odd).toBe(2.0);
    expect(sent.oddCombined).toBe(3.6);
  });

  it("sucesso → renderiza painel + telemetria bilhete_critic_result com elapsed_ms", async () => {
    vi.stubGlobal("fetch", okFetch());
    const { BilheteCriticSection } = await import(
      "@/components/bet-slip/bilhete-critic-panel"
    );
    render(
      <BilheteCriticSection legs={legs} stakeTotal={50} oddCombined={3.6} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /criticar bilhete/i }));
    });

    expect(screen.getByText("Bilhete arriscado.")).toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith(
      "bilhete_critic_result",
      expect.objectContaining({
        elapsed_ms: expect.any(Number),
        status: "ok",
      }),
    );
  });

  it("enquanto carrega mostra o timer 'analisando'", async () => {
    // fetch que nunca resolve — estado loading persiste.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => undefined)),
    );
    const { BilheteCriticSection } = await import(
      "@/components/bet-slip/bilhete-critic-panel"
    );
    render(
      <BilheteCriticSection legs={legs} stakeTotal={50} oddCombined={3.6} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /criticar bilhete/i }));

    expect(screen.getByText(/analisando/i)).toBeInTheDocument();
  });

  it("erro → mensagem acionável com 'tentar de novo' + telemetria status=error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: "resposta da IA inválida" }),
      }),
    );
    const { BilheteCriticSection } = await import(
      "@/components/bet-slip/bilhete-critic-panel"
    );
    render(
      <BilheteCriticSection legs={legs} stakeTotal={50} oddCombined={3.6} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /criticar bilhete/i }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/ia inválida/i);
    expect(
      screen.getByRole("button", { name: /tentar de novo/i }),
    ).toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith(
      "bilhete_critic_result",
      expect.objectContaining({ status: "error" }),
    );
  });

  it("503 ai_disabled em runtime → botão some", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "IA desativada", ai_disabled: true }),
      }),
    );
    const { BilheteCriticSection } = await import(
      "@/components/bet-slip/bilhete-critic-panel"
    );
    render(
      <BilheteCriticSection legs={legs} stakeTotal={50} oddCombined={3.6} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /criticar bilhete/i }));
    });

    expect(
      screen.queryByRole("button", { name: /criticar bilhete/i }),
    ).not.toBeInTheDocument();
  });
});

// ── Integração — drawer e página /bilhete ───────────────────────────────────

describe("integração do botão", () => {
  it("BetSlipDrawer renderiza o botão 'Criticar bilhete'", async () => {
    const { BetSlipDrawer } = await import(
      "@/components/bet-slip/bet-slip-drawer"
    );
    render(
      <BetSlipDrawer
        legs={[makeLeg(1), makeLeg(2)]}
        oddCombined={3.6}
        stakeTotal={50}
        potentialReturn={180}
        conflicts={[]}
        removing={null}
        committing={false}
        onRemoveLeg={vi.fn()}
        onStakeChange={vi.fn()}
        onClose={vi.fn()}
        houses={[{ id: "h1", name: "Bet365" }]}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /criticar bilhete/i }),
    ).toBeInTheDocument();
  });

  it("BetSlipDrawer com aiEnabled=false NÃO renderiza o botão", async () => {
    const { BetSlipDrawer } = await import(
      "@/components/bet-slip/bet-slip-drawer"
    );
    render(
      <BetSlipDrawer
        legs={[makeLeg(1)]}
        oddCombined={2.0}
        stakeTotal={null}
        potentialReturn={null}
        conflicts={[]}
        removing={null}
        committing={false}
        onRemoveLeg={vi.fn()}
        onStakeChange={vi.fn()}
        onClose={vi.fn()}
        houses={[]}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        aiEnabled={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /criticar bilhete/i }),
    ).not.toBeInTheDocument();
  });

  it("página /bilhete (BetSlipPageClient) renderiza o botão", async () => {
    const { BetSlipPageClient } = await import(
      "@/app/(dashboard)/bilhete/_components/bet-slip-page-client"
    );
    render(
      <BetSlipPageClient
        initialSlip={makeSlip([makeLeg(1), makeLeg(2)])}
        houses={[{ id: "h1", name: "Bet365" }]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /criticar bilhete/i }),
    ).toBeInTheDocument();
  });
});
