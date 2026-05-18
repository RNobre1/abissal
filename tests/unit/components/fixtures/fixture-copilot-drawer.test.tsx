/**
 * Testes para <FixtureCopilotDrawer> — parse defensivo da resposta da API.
 *
 * Classe de bug corrigida: o componente fazia `res.json()` antes de checar
 * `res.ok`. Quando a plataforma matava o Worker e devolvia HTML (não-JSON),
 * o JSON.parse explodía e a mensagem de erro crua vazava na tela.
 *
 * Fix esperado: `res.text()` + JSON.parse dentro de try/catch; checa `res.ok`
 * e se o parsed é objeto (não array, não null); mensagem pt-BR amigável em
 * qualquer caso de falha — nunca lança.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FixtureCopilotDrawer } from "@/components/fixtures/fixture-copilot-drawer";

afterEach(() => vi.restoreAllMocks());

// ── helpers ──────────────────────────────────────────────────────────────────

function jsonOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlErrorResponse(status = 524): Response {
  return new Response("<html><body>Gateway Timeout</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

function openDrawerAndSend(question = "árbitro?") {
  // Clica no FAB para abrir o drawer.
  const fab = screen.getByRole("button", { name: /abrir copilot do jogo/i });
  fireEvent.click(fab);

  // Clica na sugestão que contém a palavra enviada, ou digita no input.
  // Como as sugestões são dinâmicas, usamos o input diretamente.
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: question } });

  const submitBtn = screen.getByRole("button", { name: /enviar/i });
  fireEvent.click(submitBtn);
}

// ── testes ───────────────────────────────────────────────────────────────────

describe("<FixtureCopilotDrawer> — parse defensivo", () => {
  it("resposta HTML (res.ok=false, não-JSON) → mensagem pt-BR amigável, sem throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlErrorResponse(524));

    render(
      <FixtureCopilotDrawer fixtureId={7} homeTeam="Aston Villa" awayTeam="Liverpool" />,
    );
    openDrawerAndSend("árbitro?");

    // Aguarda a mensagem de erro aparecer — nunca deve lançar nem exibir
    // texto cru de JSON.parse ("Unexpected token < ..." etc.)
    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert");
      expect(alerts.length).toBeGreaterThan(0);
    });

    const alert = screen.getByRole("alert");
    // Não deve exibir erro cru de JSON.parse
    expect(alert.textContent).not.toMatch(/unexpected token/i);
    expect(alert.textContent).not.toMatch(/JSON/i);
    // Deve ser mensagem amigável em pt-BR (não vazia)
    expect(alert.textContent!.length).toBeGreaterThan(5);
  });

  it("res.ok=false com body JSON de erro → exibe body.error ou fallback pt-BR", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "fixture not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <FixtureCopilotDrawer fixtureId={9999} homeTeam="A" awayTeam="B" />,
    );
    openDrawerAndSend("?");

    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert");
      expect(alerts.length).toBeGreaterThan(0);
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent!.length).toBeGreaterThan(0);
  });

  it("resposta é array (não-objeto) → mensagem amigável, sem throw", async () => {
    // Resposta malformada: array em vez de objeto.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonOkResponse([{ content: "ok" }]),
    );

    render(
      <FixtureCopilotDrawer fixtureId={7} homeTeam="Aston Villa" awayTeam="Liverpool" />,
    );
    openDrawerAndSend("?");

    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert");
      expect(alerts.length).toBeGreaterThan(0);
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent!.length).toBeGreaterThan(0);
  });

  it("resposta feliz (res.ok=true, objeto JSON com content) → exibe conteúdo na conversa", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonOkResponse({
        content: "O árbitro é o Mike Dean com média de 42 pontos.",
        meta: {
          model: "deepseek/deepseek-v3.2",
          latency_ms: 1200,
          hops: [],
          usage_total: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        },
      }),
    );

    render(
      <FixtureCopilotDrawer fixtureId={7} homeTeam="Aston Villa" awayTeam="Liverpool" />,
    );
    openDrawerAndSend("árbitro?");

    // A mensagem de sucesso deve aparecer na conversa.
    await waitFor(() => {
      expect(screen.queryByText(/Mike Dean/i)).not.toBeNull();
    });

    // Nenhum alerta de erro.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("body vazio (res.ok=false, text vazio) → mensagem amigável, sem throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 502 }),
    );

    render(
      <FixtureCopilotDrawer fixtureId={7} homeTeam="Aston Villa" awayTeam="Liverpool" />,
    );
    openDrawerAndSend("?");

    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert");
      expect(alerts.length).toBeGreaterThan(0);
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent!.length).toBeGreaterThan(0);
  });
});
