/**
 * OnDemandButton — request honesto + recuperação (Pacote B, itens 2/3).
 *
 * Contexto de produção: p95 real da análise = 153s, o botão prometia "~40s"
 * e o estado morria no re-mount — 49 cliques → 36 respostas na telemetria.
 *
 * Contrato:
 *  (a) copy honesta — sem promessa de "~40s"; timer decorrido real (mm:ss)
 *      e "pode levar de 1 a 3 minutos";
 *  (b) in-flight persistido em sessionStorage por fixture — re-mount mostra
 *      "processando" (busy) em vez de resetar pro CTA;
 *  (c) recuperação — fetch do POST falhou/abortou ⇒ polling do GET a cada
 *      ~10s por até ~4 min; reco apareceu ⇒ router.refresh() + telemetria;
 *  (d) telemetria existente preservada (ondemand_button_click,
 *      ondemand_response_received com elapsed_ms).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { OnDemandButton } from "@/app/(dashboard)/fixtures/[id]/_components/on-demand-button";

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const trackCalls: Array<[string, Record<string, unknown> | undefined]> = [];
vi.mock("@/lib/telemetry", () => ({
  useTelemetry:
    () =>
    (event: string, payload?: Record<string, unknown>) => {
      trackCalls.push([event, payload]);
    },
}));

const FIXTURE_ID = 42;
const STORAGE_KEY = `ai-reco-inflight:${FIXTURE_ID}`;

function renderButton() {
  return render(
    <OnDemandButton fixtureId={FIXTURE_ID} homeTeam="Flamengo" awayTeam="Fluminense" />,
  );
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-30T12:00:00Z"));
  trackCalls.length = 0;
  mockRefresh.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── (a) copy honesta ──────────────────────────────────────────────────────────

describe("OnDemandButton — copy honesta", () => {
  it("não promete '~40s' em nenhum estado", async () => {
    const neverResolves = new Promise<Response>(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(neverResolves));

    const { container } = renderButton();
    expect(container.textContent).not.toContain("40s");

    fireEvent.click(screen.getByRole("button"));
    await flush();
    expect(container.textContent).not.toContain("40s");
    expect(container.textContent).toContain("pode levar de 1 a 3 minutos");
  });

  it("mostra o tempo decorrido real (mm:ss) enquanto processa", async () => {
    const neverResolves = new Promise<Response>(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(neverResolves));

    const { container } = renderButton();
    fireEvent.click(screen.getByRole("button"));
    await flush();

    await flush(65_000); // 1min05s decorridos
    expect(container.textContent).toContain("1:05");
  });
});

// ── (d) telemetria + fluxo de sucesso ────────────────────────────────────────

describe("OnDemandButton — sucesso", () => {
  it("mantém os eventos de telemetria e limpa o sessionStorage no sucesso", async () => {
    let resolveFetch!: (r: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise((r) => (resolveFetch = r))),
    );

    renderButton();
    fireEvent.click(screen.getByRole("button"));
    await flush();

    expect(trackCalls.map(([e]) => e)).toContain("ondemand_button_click");
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

    await flush(30_000);
    resolveFetch({ ok: true, json: async () => ({ decision: { verdict: "bet" } }) });
    await flush();

    const received = trackCalls.find(([e]) => e === "ondemand_response_received");
    expect(received).toBeDefined();
    expect(received![1]).toMatchObject({ fixture_id: FIXTURE_ID });
    expect(typeof received![1]!.elapsed_ms).toBe("number");
    expect(received![1]!.elapsed_ms).toBeGreaterThanOrEqual(30_000);

    expect(mockRefresh).toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("erro HTTP do server (503) → mostra erro, sem polling, storage limpo", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "IA desativada",
    });
    vi.stubGlobal("fetch", mockFetch);

    renderButton();
    fireEvent.click(screen.getByRole("button"));
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("503");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    // Nenhum GET de polling deve acontecer depois
    await flush(30_000);
    const getCalls = mockFetch.mock.calls.filter(
      ([, init]) => !init || (init as RequestInit).method !== "POST",
    );
    expect(getCalls).toHaveLength(0);
  });
});

// ── (c) recuperação por polling ───────────────────────────────────────────────

describe("OnDemandButton — recuperação quando o fetch morre", () => {
  it("fetch falhou → polla o GET a cada ~10s e recupera quando a reco aparece", async () => {
    let getCount = 0;
    const mockFetch = vi.fn().mockImplementation(
      (input: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.reject(new TypeError("network error"));
        }
        // GET de status
        expect(String(input)).toContain(`fixtureId=${FIXTURE_ID}`);
        getCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({ exists: getCount >= 2, reco_id: 777 }),
        });
      },
    );
    vi.stubGlobal("fetch", mockFetch);

    renderButton();
    fireEvent.click(screen.getByRole("button"));
    await flush(); // POST rejeita → entra em polling (1º GET imediato: exists false)

    expect(getCount).toBe(1);
    expect(mockRefresh).not.toHaveBeenCalled();

    await flush(10_000); // 2º GET: exists true
    expect(getCount).toBe(2);
    expect(mockRefresh).toHaveBeenCalled();

    const received = trackCalls.find(([e]) => e === "ondemand_response_received");
    expect(received).toBeDefined();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    // polling parou
    await flush(30_000);
    expect(getCount).toBe(2);
  });

  it("desiste do polling após ~4 min e mostra erro acionável", async () => {
    const mockFetch = vi.fn().mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.reject(new TypeError("network error"));
      }
      return Promise.resolve({ ok: true, json: async () => ({ exists: false }) });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderButton();
    fireEvent.click(screen.getByRole("button"));
    await flush();

    await flush(4 * 60_000 + 11_000);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

// ── (b) estado persistido no re-mount ────────────────────────────────────────

describe("OnDemandButton — re-mount com análise in-flight", () => {
  it("re-mount mostra 'processando' e recupera via polling em vez de resetar", async () => {
    // Simula um clique feito 30s atrás noutra montagem do componente
    sessionStorage.setItem(STORAGE_KEY, String(Date.now() - 30_000));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ exists: true, reco_id: 777 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    renderButton();
    await flush();

    // Não resetou pro CTA: está busy e o 1º GET já recuperou a reco
    expect(mockFetch).toHaveBeenCalled();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit | undefined];
    expect(init?.method ?? "GET").not.toBe("POST");
    expect(mockRefresh).toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("entrada expirada (> 4 min) no sessionStorage é ignorada — CTA normal", async () => {
    sessionStorage.setItem(STORAGE_KEY, String(Date.now() - 5 * 60_000));
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    renderButton();
    await flush();

    expect(screen.getByRole("button")).not.toBeDisabled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
