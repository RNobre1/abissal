/**
 * Testes de integração para a seção "IA Recommendations" em /calibracao (Wave 5).
 *
 * Painéis novos (data-section):
 *   - ai-reco-roi             ROI total + win rate + n bets
 *   - ai-reco-brier           Brier do prob_estimated vs resultado
 *   - ai-reco-by-league       Top 5 ligas por volume + P/L
 *   - ai-reco-by-confidence   alto/medio/baixo: count + P/L + WR
 *
 * Mock do Supabase admin em memória (mesmo padrão de calibracao-page.test.tsx).
 * Degradação graciosa: page deve continuar renderizando se ai_recommendations
 * estiver indisponível (lê outras tabelas).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";

interface AiRecoFullRow {
  id: number;
  league: string | null;
  status: "pending" | "resolved" | "unresolvable";
  verdict: "bet" | "skip";
  confidence: "alto" | "medio" | "baixo" | null;
  prob_estimated: number | null;
  prob_calibrated: number | null;
  units_final: number | null;
  bet_won: boolean | null;
  pl_units: number | null;
}

const state: {
  recos: AiRecoFullRow[];
  recoFail: boolean;
} = {
  recos: [],
  recoFail: false,
};

// Builder reutilizável: aceita encadeamento .select.eq.order.limit etc, e
// resolve a Promise no final.
function makeBuilder<T>(getRows: () => T[], failMsg: string | null) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.gte = () => builder;
  builder.lt = () => builder;
  builder.is = () => builder;
  builder.order = () => builder;
  const resolve = () =>
    failMsg
      ? Promise.resolve({ data: null, error: { message: failMsg } })
      : Promise.resolve({ data: getRows(), error: null });
  builder.limit = () => ({
    then: (cb: (v: unknown) => unknown) => resolve().then(cb),
  });
  // Permite `await builder` direto (sem .limit) — útil quando a página
  // termina a cadeia em .order. Não usa PromiseLike<T> para evitar drift
  // de tipos com onfulfilled/onrejected opcionais.
  builder.then = (cb: (v: unknown) => unknown) => resolve().then(cb);
  return builder;
}

// A página escopa o ROI realizado pelo usuário da sessão (as apostas são
// pessoais, as recomendações são compartilhadas). Sem este mock o
// `createClient` real chama `cookies()` fora do escopo de request.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "user-de-teste" } }, error: null }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      // Tabelas legacy retornam vazio (não interferem nesses testes)
      if (t === "ai_predictions") return makeBuilder(() => [], null);
      if (t === "fixture_simulations") return makeBuilder(() => [], null);
      if (t === "model_calibration") return makeBuilder(() => [], null);
      if (t === "league_parameters") return makeBuilder(() => [], null);
      if (t === "ai_recommendations") {
        return makeBuilder(
          () => state.recos,
          state.recoFail ? "permission denied" : null,
        );
      }
      throw new Error(`unexpected table: ${t}`);
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  },
}));

import CalibracaoPage from "@/app/(dashboard)/calibracao/page";

beforeEach(() => {
  state.recos = [];
  state.recoFail = false;
});

function makeReco(over: Partial<AiRecoFullRow> = {}): AiRecoFullRow {
  return {
    id: 1,
    league: "Premier League",
    status: "resolved",
    verdict: "bet",
    confidence: "alto",
    prob_estimated: 0.65,
    prob_calibrated: 0.62,
    units_final: 1.5,
    bet_won: true,
    pl_units: 1.5,
    ...over,
  };
}

describe("CalibracaoPage — seção IA Recommendations", () => {
  it("renderiza todas as 4 subseções data-section quando há recos", async () => {
    state.recos = [
      makeReco({ id: 1, bet_won: true, pl_units: 1.5 }),
      makeReco({ id: 2, bet_won: false, pl_units: -1.0 }),
    ];
    const { container } = render(await CalibracaoPage());
    expect(
      container.querySelector('[data-section="ai-reco-roi"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-section="ai-reco-brier"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-section="ai-reco-by-league"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-section="ai-reco-by-confidence"]'),
    ).not.toBeNull();
  });

  it("mostra ROI cumulativo total (P/L) e win rate", async () => {
    state.recos = [
      makeReco({ id: 1, bet_won: true, pl_units: 1.5, units_final: 1.0 }),
      makeReco({ id: 2, bet_won: true, pl_units: 0.95, units_final: 1.0 }),
      makeReco({ id: 3, bet_won: false, pl_units: -1.0, units_final: 1.0 }),
    ];
    const { container } = render(await CalibracaoPage());
    const sec = container.querySelector('[data-section="ai-reco-roi"]');
    expect(sec).not.toBeNull();
    const text = sec?.textContent ?? "";
    // P/L total = 1.5 + 0.95 - 1.0 = +1.45
    expect(text).toMatch(/\+?1\.45|\+?1,45/);
    // 2/3 → ~67%
    expect(text).toMatch(/67%|66%/);
  });

  it("ignora recos status='pending' no cálculo do ROI", async () => {
    state.recos = [
      makeReco({ id: 1, status: "pending", bet_won: null, pl_units: null }),
      makeReco({ id: 2, status: "resolved", bet_won: true, pl_units: 2.0 }),
    ];
    const { container } = render(await CalibracaoPage());
    const sec = container.querySelector('[data-section="ai-reco-roi"]');
    const text = sec?.textContent ?? "";
    // P/L = 2.0 (só o resolved)
    expect(text).toMatch(/\+?2\.00|\+?2,00/);
  });

  it("computa Brier do prob_estimated sobre resolved bets", async () => {
    // 2 recos resolvidas com prob_estimated=0.6:
    //   acertou (y=1): (0.6 - 1)^2 = 0.16
    //   errou (y=0):   (0.6 - 0)^2 = 0.36
    // média = 0.26
    state.recos = [
      makeReco({ id: 1, prob_estimated: 0.6, bet_won: true }),
      makeReco({ id: 2, prob_estimated: 0.6, bet_won: false }),
    ];
    const { container } = render(await CalibracaoPage());
    const sec = container.querySelector('[data-section="ai-reco-brier"]');
    expect(sec).not.toBeNull();
    const text = sec?.textContent ?? "";
    // Mostra "0.260" formatado
    expect(text).toMatch(/0\.26/);
  });

  it("agrupa por liga (top 5)", async () => {
    state.recos = [
      makeReco({ id: 1, league: "Premier League", pl_units: 1.0 }),
      makeReco({ id: 2, league: "Premier League", pl_units: -1.0 }),
      makeReco({ id: 3, league: "La Liga", pl_units: 2.0 }),
      makeReco({ id: 4, league: "Serie A", pl_units: 0.5 }),
    ];
    const { container } = render(await CalibracaoPage());
    const sec = container.querySelector('[data-section="ai-reco-by-league"]');
    expect(sec).not.toBeNull();
    const text = sec?.textContent ?? "";
    expect(text).toMatch(/Premier League/);
    expect(text).toMatch(/La Liga/);
    expect(text).toMatch(/Serie A/);
  });

  it("agrupa por confidence level (alto/medio/baixo)", async () => {
    state.recos = [
      makeReco({ id: 1, confidence: "alto", bet_won: true, pl_units: 1.5 }),
      makeReco({ id: 2, confidence: "alto", bet_won: true, pl_units: 1.0 }),
      makeReco({ id: 3, confidence: "medio", bet_won: false, pl_units: -1.0 }),
      makeReco({ id: 4, confidence: "baixo", bet_won: false, pl_units: -1.0 }),
    ];
    const { container } = render(await CalibracaoPage());
    const sec = container.querySelector('[data-section="ai-reco-by-confidence"]');
    expect(sec).not.toBeNull();
    const text = sec?.textContent ?? "";
    expect(text).toMatch(/alto/);
    expect(text).toMatch(/medio/);
    expect(text).toMatch(/baixo/);
    // alto: 2/2 = 100%
    expect(text).toMatch(/100%/);
  });

  it("mostra mensagem amigável quando ai_recommendations está vazio", async () => {
    state.recos = [];
    const { container } = render(await CalibracaoPage());
    const sec = container.querySelector('[data-section="ai-reco-roi"]');
    expect(sec).not.toBeNull();
    // Seção ainda existe, mas mostra mensagem vazia
    const text = sec?.textContent ?? "";
    expect(text.toLowerCase()).toMatch(/sem|nenhum|0/);
  });

  it("degrada graciosamente quando ai_recommendations falha", async () => {
    state.recoFail = true;
    const { container } = render(await CalibracaoPage());
    // A página inteira não pode quebrar — outras seções devem renderizar
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).toMatch(/calibração|simulação/);
    // E a seção IA Reco mostra uma mensagem amigável de falha
    const sec = container.querySelector('[data-section="ai-reco-roi"]');
    expect(sec).not.toBeNull();
  });
});
