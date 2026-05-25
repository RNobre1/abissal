import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";

type State = {
  aiRows: unknown[];
  simRows: unknown[];
  calRows: unknown[];
  calError: { message: string } | null;
};
const state: State = { aiRows: [], simRows: [], calRows: [], calError: null };

function buildAiOrSimBuilder(which: "ai" | "sim") {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.order = () => b;
  b.limit = () =>
    Promise.resolve({
      data: which === "ai" ? state.aiRows : state.simRows,
      error: null,
    });
  return b;
}

function buildCalBuilder() {
  // Cadeia: .select(...).is("effective_until", null).order(...).limit(...)
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.is = () => b;
  b.order = () => b;
  b.limit = () =>
    Promise.resolve({
      data: state.calRows,
      error: state.calError,
    });
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      if (t === "ai_predictions") return buildAiOrSimBuilder("ai");
      if (t === "fixture_simulations") return buildAiOrSimBuilder("sim");
      if (t === "model_calibration") return buildCalBuilder();
      // ai_recommendations e league_parameters (Wave 5) — não testados aqui;
      // reusam buildCalBuilder pra devolver vazio com cadeia compatível.
      if (t === "ai_recommendations") return buildCalBuilder();
      if (t === "league_parameters") return buildCalBuilder();
      throw new Error("unexpected table " + t);
    },
  }),
}));

import CalibracaoPage from "@/app/(dashboard)/calibracao/page";

async function renderPage() {
  const el = await CalibracaoPage();
  return render(el);
}

beforeEach(() => {
  state.aiRows = [];
  state.simRows = [];
  state.calRows = [];
  state.calError = null;
});

afterEach(() => vi.useRealTimers());

describe("CalibracaoPage — curvas isotônicas ativas", () => {
  it("mostra fallback quando 0 curvas ativas", async () => {
    state.calRows = [];
    const { container } = await renderPage();
    const sec = container.querySelector('[data-section="sim-active-calibration"]');
    expect(sec).not.toBeNull();
    const text = (sec?.textContent ?? "").toLowerCase();
    expect(text).toContain("nenhuma curva isotônica");
    expect(text).toContain("fit-isotonic");
  });

  it("renderiza tabela com 1+ curva ativa", async () => {
    state.calRows = [
      {
        id: 1,
        metric: "1x2-home",
        model_version: "v2",
        n: 120,
        pairs: [[0.1, 0.08], [0.3, 0.27], [0.5, 0.49], [0.7, 0.73], [0.9, 0.91]],
        created_at: "2026-05-21T10:00:00Z",
      },
      {
        id: 2,
        metric: "over25",
        model_version: "v2",
        n: 95,
        pairs: [[0.2, 0.18], [0.4, 0.42], [0.6, 0.61]],
        created_at: "2026-05-21T10:00:00Z",
      },
    ];
    const { container } = await renderPage();
    const sec = container.querySelector('[data-section="sim-active-calibration"]');
    expect(sec).not.toBeNull();
    const rows = sec?.querySelectorAll("tbody tr") ?? [];
    expect(rows.length).toBe(2);
    const text = (sec?.textContent ?? "").toLowerCase();
    expect(text).toContain("1x2-home");
    expect(text).toContain("over25");
    expect(text).toContain("v2");
    expect(text).toContain("120");
    expect(text).toContain("95");
  });
});
