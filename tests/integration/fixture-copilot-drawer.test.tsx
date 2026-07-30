import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * FixtureCopilotDrawer — FAB + drawer de chat do jogo.
 * Cobre: abre/fecha (ESC), guard de custo (zero fetch no mount), chips de
 * tool ✓/✗ visíveis, streaming SSE renderizado, kill switch 503, erro de
 * LLM sem tela branca, e telemetria copilot_open / copilot_message_sent.
 */

const trackSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telemetry/use-telemetry", () => ({
  useTelemetry: () => trackSpy,
}));

import { FixtureCopilotDrawer } from "@/components/fixtures/fixture-copilot-drawer";

function sse(events: Array<{ event: string; data: unknown }>): string {
  return events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function setup() {
  return render(
    <FixtureCopilotDrawer
      fixtureId={7}
      homeTeam="Aston Villa"
      awayTeam="Liverpool"
    />,
  );
}

function openDrawer() {
  fireEvent.click(screen.getByLabelText("Abrir copilot do jogo"));
}

function sendQuestion(text: string) {
  const input = screen.getByLabelText("Pergunta");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
}

beforeEach(() => {
  vi.restoreAllMocks();
  trackSpy.mockClear();
});

describe("FixtureCopilotDrawer", () => {
  it("não faz NENHUM fetch no mount (guard de custo)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    setup();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("FAB abre o drawer (telemetria copilot_open) e ESC fecha", () => {
    setup();
    openDrawer();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(trackSpy).toHaveBeenCalledWith(
      "copilot_open",
      expect.objectContaining({ fixture_id: 7 }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renderiza chip ✓ da tool e a resposta streamada; telemetria copilot_message_sent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        sse([
          {
            event: "hop",
            data: {
              tool: "get_referee",
              ok: true,
              result_summary: "get_referee: ok",
              took_ms: 3,
            },
          },
          { event: "delta", data: { text: "O árbitro é " } },
          { event: "delta", data: { text: "o Mike Dean." } },
          {
            event: "done",
            data: {
              meta: {
                model: "x",
                latency_ms: 12,
                hops: [],
                usage_total: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2,
                },
              },
            },
          },
        ]),
      ),
    );
    setup();
    openDrawer();
    sendQuestion("quem apita?");

    await waitFor(() =>
      expect(screen.getByText(/Mike Dean/)).toBeInTheDocument(),
    );
    expect(screen.getByText("get_referee")).toBeInTheDocument();
    expect(screen.getByText(/get_referee: ok/)).toBeInTheDocument();
    expect(trackSpy).toHaveBeenCalledWith(
      "copilot_message_sent",
      expect.objectContaining({ fixture_id: 7 }),
    );
  });

  it("descarta 'pensamento' pré-tool: delta que chega ANTES de um hop não fica na bolha final", async () => {
    // Em turnos mistos o upstream emite content antes dos tool_calls
    // ("vou consultar os splits...") — a bolha final deve conter só a
    // resposta pós-último-hop, senão o transcript sai embaralhado.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        sse([
          { event: "delta", data: { text: "Deixa eu consultar as odds... " } },
          {
            event: "hop",
            data: { tool: "get_odds", ok: true, result_summary: "get_odds: ok", took_ms: 2 },
          },
          { event: "delta", data: { text: "A odd do mandante é 1.87." } },
          {
            event: "done",
            data: {
              meta: {
                model: "x",
                latency_ms: 10,
                hops: [],
                usage_total: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              },
            },
          },
        ]),
      ),
    );
    setup();
    openDrawer();
    sendQuestion("qual a odd?");

    await waitFor(() =>
      expect(screen.getByText(/A odd do mandante é 1\.87\./)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Deixa eu consultar/)).not.toBeInTheDocument();
  });

  it("mostra chip ✗ quando a tool degrada com erro", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        sse([
          {
            event: "hop",
            data: {
              tool: "get_referee",
              ok: false,
              result_summary: "error: sem árbitro designado",
              took_ms: 2,
            },
          },
          { event: "delta", data: { text: "Sem árbitro definido ainda." } },
          {
            event: "done",
            data: {
              meta: {
                model: "x",
                latency_ms: 9,
                hops: [],
                usage_total: {
                  prompt_tokens: 0,
                  completion_tokens: 0,
                  total_tokens: 0,
                },
              },
            },
          },
        ]),
      ),
    );
    setup();
    openDrawer();
    sendQuestion("árbitro?");
    await waitFor(() =>
      expect(screen.getByText(/error: sem árbitro/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Sem árbitro definido/)).toBeInTheDocument();
  });

  it("kill switch OFF (503 ai_disabled) → mensagem clara, sem quebrar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "IA desativada globalmente", ai_disabled: true }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
    setup();
    openDrawer();
    sendQuestion("oi?");
    await waitFor(() =>
      expect(
        screen.getByText(/IA desativada nas configurações/),
      ).toBeInTheDocument(),
    );
  });

  it("evento SSE de erro do LLM → mensagem de erro no chat, nunca tela branca", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(sse([{ event: "error", data: { message: "OpenRouter 500" } }])),
    );
    setup();
    openDrawer();
    sendQuestion("oi?");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("OpenRouter 500");
    // drawer continua de pé
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("falha de rede → erro amigável", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    setup();
    openDrawer();
    sendQuestion("oi?");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
