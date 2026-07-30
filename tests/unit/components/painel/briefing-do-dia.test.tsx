/**
 * F4 — card <BriefingDoDia /> no topo do /painel.
 *
 * Contrato:
 * - briefing FRESCO (date === hoje BRT) ⇒ renderiza texto + data + top 3
 *   oportunidades (a ação "+ bilhete" vive no OportunidadeIaCard reusado);
 * - briefing ausente ou stale (date ≠ hoje) ⇒ componente devolve null
 *   (sem placeholder feio);
 * - sem oportunidades ativas ⇒ o texto ainda aparece, sem a lista.
 *
 * O gating de quiet mode é da PÁGINA (mesmo branch das oportunidades) e é
 * testado em tests/integration/painel-destaques.test.tsx.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildBriefingValue, brtDateIso } from "@/lib/briefing/compose";

const settingsState: { value: unknown } = { value: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: settingsState.value === null ? null : { value: settingsState.value },
            error: null,
          }),
        }),
      }),
    }),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

const fetchTopsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-reco/reco-repository", () => ({
  fetchTopOpportunities: fetchTopsMock,
}));

// O card individual é Client Component com AddToSlipButton — vira marcador.
vi.mock("@/components/oportunidades/oportunidade-ia-card", () => ({
  OportunidadeIaCard: ({ reco }: { reco: { id: number; home_team: string } }) => (
    <li data-testid="oportunidade-card">{reco.home_team}</li>
  ),
}));

import { BriefingDoDia } from "@/components/painel/briefing-do-dia";

const TEXT =
  "Três oportunidades hoje, mas duas em ligas não-calibradas — historicamente o modelo rende menos nelas.";

function freshValue() {
  return buildBriefingValue({
    date: brtDateIso(),
    text: TEXT,
    model: "deepseek/deepseek-v3.2",
    nBets: 3,
    nSkips: 14,
  });
}

const TOPS = [
  { id: 1, fixture_id: 10, home_team: "Arsenal", away_team: "Chelsea" },
  { id: 2, fixture_id: 11, home_team: "Ajax", away_team: "PSV" },
  { id: 3, fixture_id: 12, home_team: "Porto", away_team: "Braga" },
];

beforeEach(() => {
  settingsState.value = null;
  fetchTopsMock.mockReset();
  fetchTopsMock.mockResolvedValue(TOPS);
});

describe("<BriefingDoDia />", () => {
  it("briefing fresco: renderiza texto, data e as top 3 oportunidades", async () => {
    settingsState.value = freshValue();
    render(await BriefingDoDia());

    expect(screen.getByText(TEXT)).toBeInTheDocument();
    // data BRT de hoje em dd/mm/yyyy
    const [y, m, d] = brtDateIso().split("-");
    expect(screen.getByText(`${d}/${m}/${y}`)).toBeInTheDocument();
    expect(screen.getAllByTestId("oportunidade-card")).toHaveLength(3);
    expect(fetchTopsMock).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it("briefing stale (date ≠ hoje) ⇒ null, sem placeholder", async () => {
    settingsState.value = { ...freshValue(), date: "2000-01-01" };
    expect(await BriefingDoDia()).toBeNull();
  });

  it("briefing ausente ⇒ null", async () => {
    settingsState.value = null;
    expect(await BriefingDoDia()).toBeNull();
  });

  it("value malformado ⇒ null (nunca lança)", async () => {
    settingsState.value = { garbage: true };
    expect(await BriefingDoDia()).toBeNull();
  });

  it("sem oportunidades ativas: texto aparece, lista não", async () => {
    settingsState.value = freshValue();
    fetchTopsMock.mockResolvedValue([]);
    render(await BriefingDoDia());

    expect(screen.getByText(TEXT)).toBeInTheDocument();
    expect(screen.queryAllByTestId("oportunidade-card")).toHaveLength(0);
  });

  it("fetchTopOpportunities lançando ⇒ degrada pro texto sem lista", async () => {
    settingsState.value = freshValue();
    fetchTopsMock.mockRejectedValue(new Error("boom"));
    render(await BriefingDoDia());

    expect(screen.getByText(TEXT)).toBeInTheDocument();
    expect(screen.queryAllByTestId("oportunidade-card")).toHaveLength(0);
  });
});
