/**
 * Testes de integração para /calibracao (Server Component).
 *
 * Padrão: mock do Supabase admin em memória (espelha stats-page.test.tsx).
 * Valida:
 *   - Estado vazio → mensagem amigável "sem predições"
 *   - Com predições resolvidas → exibe taxa de acerto (winner %)
 *   - Com predições pendentes → exibe contagem de pendentes
 *   - Breakdown por modelo visível
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

// ── tipos mínimos de linha ────────────────────────────────────────────────────

interface PredRow {
  id: number;
  status: "pending" | "resolved" | "unresolvable";
  model: string | null;
  route: string;
  pred_confidence: number;
  correct_winner: boolean | null;
  correct_over_under: boolean | null;
}

interface SimRow {
  id: number;
  status: "pending" | "resolved" | "unsimulable" | "unresolvable";
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  correct_winner: boolean | null;
  correct_over_under: boolean | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
}

// ── estado do mock ────────────────────────────────────────────────────────────

type MockRows = PredRow[];
let mockRows: MockRows = [];
let mockSimRows: SimRow[] = [];

function buildAdminMock() {
  return {
    from: (table: string) => {
      if (table === "fixture_simulations") {
        return {
          select: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: mockSimRows, error: null }),
            }),
          }),
        };
      }
      expect(table).toBe("ai_predictions");
      return {
        select: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({ data: mockRows, error: null }),
          }),
        }),
      };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => buildAdminMock(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  },
}));

import CalibracaoPage from "@/app/(dashboard)/calibracao/page";

beforeEach(() => {
  mockRows = [];
  mockSimRows = [];
  vi.restoreAllMocks();
});

// ── testes ────────────────────────────────────────────────────────────────────

describe("CalibracaoPage", () => {
  it("sem predições → exibe mensagem de estado vazio amigável", async () => {
    mockRows = [];
    render(await CalibracaoPage());
    expect(screen.getByText(/sem predições/i)).toBeInTheDocument();
  });

  it("com predições resolvidas → exibe taxa de acerto (winner)", async () => {
    mockRows = [
      {
        id: 1,
        status: "resolved",
        model: "deepseek/deepseek-v3.2",
        route: "fixture-copilot",
        pred_confidence: 0.7,
        correct_winner: true,
        correct_over_under: true,
      },
      {
        id: 2,
        status: "resolved",
        model: "deepseek/deepseek-v3.2",
        route: "fixture-copilot",
        pred_confidence: 0.6,
        correct_winner: false,
        correct_over_under: true,
      },
    ];
    render(await CalibracaoPage());
    // 1/2 acertos → 50%; verifica label "acerto winner" e valor 50%
    expect(screen.getByText(/acerto winner/i)).toBeInTheDocument();
    // Há pelo menos um elemento com "50%" na página
    expect(screen.getAllByText(/50%/).length).toBeGreaterThan(0);
  });

  it("com predições pendentes → exibe contagem de pendentes", async () => {
    mockRows = [
      {
        id: 3,
        status: "pending",
        model: "deepseek/deepseek-v3.2",
        route: "fixture-copilot",
        pred_confidence: 0.8,
        correct_winner: null,
        correct_over_under: null,
      },
      {
        id: 4,
        status: "pending",
        model: null,
        route: "fixture-copilot",
        pred_confidence: 0.65,
        correct_winner: null,
        correct_over_under: null,
      },
    ];
    render(await CalibracaoPage());
    // Deve mostrar algum número de pendentes
    expect(screen.getByText(/pendente/i)).toBeInTheDocument();
  });

  it("breakdown por modelo visível quando há predições", async () => {
    mockRows = [
      {
        id: 5,
        status: "resolved",
        model: "deepseek/deepseek-v3.2",
        route: "fixture-copilot",
        pred_confidence: 0.75,
        correct_winner: true,
        correct_over_under: false,
      },
    ];
    render(await CalibracaoPage());
    // Deve exibir o nome do modelo ou abreviação
    expect(screen.getByText(/v3\.2|deepseek/i)).toBeInTheDocument();
  });
});

// ── seção simulação (Brier) ───────────────────────────────────────────────────

describe("CalibracaoPage — seção simulação (Brier)", () => {
  it("exibe a seção simulação separada do copilot hitRate quando há simulações resolvidas", async () => {
    mockRows = [];
    mockSimRows = [
      {
        id: 1,
        status: "resolved",
        // {0.5,0.3,0.2}, away venceu (0-2) → Brier multiclasse
        // = (0.5)²+(0.3)²+(0.2−1)² = 0.25+0.09+0.64 = 0.98
        p_home: 0.5,
        p_draw: 0.3,
        p_away: 0.2,
        p_over_25: 0.6,
        correct_winner: false,
        correct_over_under: false,
        actual_home_goals: 0,
        actual_away_goals: 2,
      },
    ];
    render(await CalibracaoPage());
    // Rótulo da seção simulação distinto do copilot
    expect(screen.getAllByText(/simulação/i).length).toBeGreaterThan(0);
    // Brier aparece (label "brier" em algum lugar)
    expect(screen.getAllByText(/brier/i).length).toBeGreaterThan(0);
    // Não conflaciona: o copilot continua mostrando seu estado vazio
    expect(screen.getByText(/sem predições/i)).toBeInTheDocument();
  });

  it("degrada graciosamente sem simulações resolvidas", async () => {
    mockRows = [];
    mockSimRows = [];
    render(await CalibracaoPage());
    // A seção simulação ainda renderiza com mensagem de vazio amigável
    expect(screen.getAllByText(/simulação/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/sem simulações/i)).toBeInTheDocument();
  });

  it("ignora simulações pending/unsimulable no cálculo do Brier", async () => {
    mockRows = [];
    mockSimRows = [
      {
        id: 1,
        status: "pending",
        p_home: 0.4,
        p_draw: 0.3,
        p_away: 0.3,
        p_over_25: 0.5,
        correct_winner: null,
        correct_over_under: null,
        actual_home_goals: null,
        actual_away_goals: null,
      },
      {
        id: 2,
        status: "unsimulable",
        p_home: null,
        p_draw: null,
        p_away: null,
        p_over_25: null,
        correct_winner: null,
        correct_over_under: null,
        actual_home_goals: null,
        actual_away_goals: null,
      },
    ];
    render(await CalibracaoPage());
    // Sem resolvidas → degradação graciosa, não quebra
    expect(screen.getByText(/sem simulações/i)).toBeInTheDocument();
  });
});
