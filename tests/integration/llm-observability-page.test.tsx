/**
 * Testes de integração para /llm-observability (Server Component, Wave 5).
 *
 * Cobre os 4 painéis: cost-volume, latency, prompt-versions, recent-logs.
 * Mock do Supabase admin em memória (mesmo padrão de calibracao-page.test.tsx).
 * Valida degradação graciosa quando a tabela `llm_request_logs` falha (B12).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";

// ── tipos mínimos espelhando as colunas escalares lidas ───────────────────────

interface LogRowLite {
  id: number;
  created_at: string;
  route: string;
  model: string;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error: string | null;
  cost_usd: number | null;
  prompt_version: string | null;
}

interface AiRecoRowLite {
  id: number;
  status: "pending" | "resolved" | "unresolvable";
  verdict: "bet" | "skip";
  prompt_version: string | null;
  pl_units: number | null;
  bet_won: boolean | null;
  units_final: number | null;
}

// ── estado mutável compartilhado entre tests ──────────────────────────────────

type Mode = "ok" | "logs-error" | "reco-error";

const state: {
  logs: LogRowLite[];
  recos: AiRecoRowLite[];
  mode: Mode;
} = {
  logs: [],
  recos: [],
  mode: "ok",
};

// Constrói um builder thenable que aceita encadeamento .select/.gte/.lt/
// .order/.limit/.eq/.is e resolve a Promise quando .limit() é chamado
// (ou via `await builder` direto, se a cadeia terminar antes).
function makeBuilder<T>(getRows: () => T[], failMsg: string | null) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.gte = () => builder;
  builder.lt = () => builder;
  builder.eq = () => builder;
  builder.order = () => builder;
  builder.is = () => builder;
  const resolve = () =>
    failMsg
      ? Promise.resolve({ data: null, error: { message: failMsg } })
      : Promise.resolve({ data: getRows(), error: null });
  builder.limit = () => ({
    then: (cb: (v: unknown) => unknown) => resolve().then(cb),
  });
  builder.then = (cb: (v: unknown) => unknown) => resolve().then(cb);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      if (t === "llm_request_logs") {
        return makeBuilder(
          () => state.logs,
          state.mode === "logs-error"
            ? "permission denied for table llm_request_logs"
            : null,
        );
      }
      if (t === "ai_recommendations") {
        return makeBuilder(
          () => state.recos,
          state.mode === "reco-error"
            ? "permission denied for table ai_recommendations"
            : null,
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

import LlmObservabilityPage from "@/app/(dashboard)/llm-observability/page";

beforeEach(() => {
  state.logs = [];
  state.recos = [];
  state.mode = "ok";
});

// ── helpers de fábrica ────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function makeLog(over: Partial<LogRowLite> = {}): LogRowLite {
  return {
    id: 1,
    created_at: nowIso(),
    route: "ai-reco",
    model: "deepseek/deepseek-r1",
    latency_ms: 250,
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    error: null,
    cost_usd: 0.0042,
    prompt_version: "prompt-v1.0",
    ...over,
  };
}

function makeReco(over: Partial<AiRecoRowLite> = {}): AiRecoRowLite {
  return {
    id: 1,
    status: "resolved",
    verdict: "bet",
    prompt_version: "prompt-v1.0",
    pl_units: 1.5,
    bet_won: true,
    units_final: 1.0,
    ...over,
  };
}

// ── testes ────────────────────────────────────────────────────────────────────

describe("LlmObservabilityPage — smoke", () => {
  it("renderiza sem crash mesmo sem dados", async () => {
    state.logs = [];
    state.recos = [];
    const tree = await LlmObservabilityPage();
    const { container } = render(tree);
    // Page title visible
    expect(container.textContent ?? "").toMatch(/observability|observabilidade/i);
  });

  it("inclui as 4 seções data-section esperadas", async () => {
    state.logs = [makeLog()];
    state.recos = [];
    const { container } = render(await LlmObservabilityPage());
    expect(container.querySelector('[data-section="cost-volume"]')).not.toBeNull();
    expect(container.querySelector('[data-section="latency"]')).not.toBeNull();
    expect(container.querySelector('[data-section="prompt-versions"]')).not.toBeNull();
    expect(container.querySelector('[data-section="recent-logs"]')).not.toBeNull();
  });
});

describe("LlmObservabilityPage — painel custo & volume", () => {
  it("mostra custo total e contagem (24h/7d/30d)", async () => {
    state.logs = [
      makeLog({ id: 1, cost_usd: 0.01 }),
      makeLog({ id: 2, cost_usd: 0.02 }),
      makeLog({ id: 3, cost_usd: 0.03 }),
    ];
    const { container } = render(await LlmObservabilityPage());
    const sec = container.querySelector('[data-section="cost-volume"]');
    expect(sec).not.toBeNull();
    const text = sec?.textContent ?? "";
    // Deve mostrar pelo menos o custo total somado em USD
    expect(text).toMatch(/0\.0[0-9]/); // 0.06 = $0.06
    expect(text).toMatch(/3/); // count = 3
  });

  it("inclui tabela por modelo (30d)", async () => {
    state.logs = [
      makeLog({ id: 1, model: "deepseek/deepseek-r1", cost_usd: 0.01 }),
      makeLog({ id: 2, model: "deepseek/deepseek-v3.2", cost_usd: 0.005 }),
      makeLog({ id: 3, model: "deepseek/deepseek-r1", cost_usd: 0.02 }),
    ];
    const { container } = render(await LlmObservabilityPage());
    const sec = container.querySelector('[data-section="cost-volume"]');
    const text = sec?.textContent ?? "";
    // Modelo abreviado: "deepseek/deepseek-r1" → "r1", "deepseek/deepseek-v3.2" → "v3.2"
    expect(text).toMatch(/r1/i);
    expect(text).toMatch(/v3\.2/i);
  });
});

describe("LlmObservabilityPage — latência", () => {
  it("computa p50/p90/p99 a partir de latency_ms", async () => {
    // 10 valores ordenados: 100..1000 (degrau de 100)
    state.logs = Array.from({ length: 10 }, (_, i) =>
      makeLog({ id: i + 1, latency_ms: 100 * (i + 1) }),
    );
    const { container } = render(await LlmObservabilityPage());
    const sec = container.querySelector('[data-section="latency"]');
    expect(sec).not.toBeNull();
    const text = sec?.textContent ?? "";
    // labels esperados
    expect(text).toMatch(/p50/i);
    expect(text).toMatch(/p90/i);
    expect(text).toMatch(/p99/i);
  });

  it("mostra error rate sobre o total", async () => {
    state.logs = [
      makeLog({ id: 1, error: null }),
      makeLog({ id: 2, error: "rate limit" }),
      makeLog({ id: 3, error: null }),
      makeLog({ id: 4, error: null }),
    ];
    const { container } = render(await LlmObservabilityPage());
    const sec = container.querySelector('[data-section="latency"]');
    const text = sec?.textContent ?? "";
    expect(text).toMatch(/error|erro/i);
    // 1/4 = 25%
    expect(text).toMatch(/25/);
  });
});

describe("LlmObservabilityPage — prompt versions", () => {
  it("agrupa por prompt_version com count e cost", async () => {
    state.logs = [
      makeLog({ id: 1, prompt_version: "prompt-v1.0", cost_usd: 0.01 }),
      makeLog({ id: 2, prompt_version: "prompt-v1.0", cost_usd: 0.01 }),
      makeLog({ id: 3, prompt_version: "prompt-v1.1", cost_usd: 0.02 }),
    ];
    state.recos = [
      makeReco({ id: 1, prompt_version: "prompt-v1.0", pl_units: 1.5, verdict: "bet" }),
      makeReco({ id: 2, prompt_version: "prompt-v1.1", pl_units: -1.0, verdict: "bet" }),
    ];
    const { container } = render(await LlmObservabilityPage());
    const sec = container.querySelector('[data-section="prompt-versions"]');
    expect(sec).not.toBeNull();
    const text = sec?.textContent ?? "";
    expect(text).toMatch(/prompt-v1\.0/);
    expect(text).toMatch(/prompt-v1\.1/);
  });

  it("degrada quando ai_recommendations indisponível (mostra só count/cost)", async () => {
    state.logs = [
      makeLog({ prompt_version: "prompt-v1.0", cost_usd: 0.01 }),
    ];
    state.mode = "reco-error";
    const { container } = render(await LlmObservabilityPage());
    const sec = container.querySelector('[data-section="prompt-versions"]');
    expect(sec).not.toBeNull();
    expect(sec?.textContent ?? "").toMatch(/prompt-v1\.0/);
  });
});

describe("LlmObservabilityPage — recent logs", () => {
  it("renderiza tabela com até 10 linhas (mais novas primeiro)", async () => {
    state.logs = Array.from({ length: 15 }, (_, i) =>
      makeLog({ id: 1000 + i, created_at: new Date(2026, 4, 24, 12, i).toISOString() }),
    );
    const { container } = render(await LlmObservabilityPage());
    const sec = container.querySelector('[data-section="recent-logs"]');
    expect(sec).not.toBeNull();
    const rows = sec?.querySelectorAll("tbody tr").length ?? 0;
    expect(rows).toBeGreaterThanOrEqual(1);
    expect(rows).toBeLessThanOrEqual(10);
  });

  it("mostra mensagem amigável quando 0 logs", async () => {
    state.logs = [];
    const { container } = render(await LlmObservabilityPage());
    const sec = container.querySelector('[data-section="recent-logs"]');
    expect(sec).not.toBeNull();
    const text = sec?.textContent ?? "";
    // Não deve quebrar; mostrar mensagem amigável
    expect(text).toMatch(/sem|nenhum|0/i);
  });
});

describe("LlmObservabilityPage — degradação graciosa (B12)", () => {
  it("renderiza mensagem de erro quando llm_request_logs falha", async () => {
    state.mode = "logs-error";
    const { container } = render(await LlmObservabilityPage());
    // Page não crasha; mostra mensagem amigável
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).toMatch(/falha|erro|indispon/i);
  });
});
