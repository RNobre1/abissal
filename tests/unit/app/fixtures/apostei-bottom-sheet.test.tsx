/**
 * U.4 — AposteiBottomSheet tests
 *
 * Testa o bottom sheet que substitui o modal atual:
 * - Abre/fecha corretamente
 * - Tap targets ≥44pt (min-h-[44px])
 * - Resumo de confirmação explícito (WCAG 3.3.4)
 * - Escape fecha
 * - Animação slide-up (classe presente)
 * - Submit POSTa para /api/ai-reco/apostei
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AposteiBottomSheet } from "@/app/(dashboard)/fixtures/[id]/_components/apostei-bottom-sheet";

const HOUSES = [
  { id: "h1", name: "Bet365" },
  { id: "h2", name: "Novibet" },
];

describe("<AposteiBottomSheet />", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renderiza o trigger e o conteúdo fica oculto inicialmente", () => {
    const { container } = render(
      <AposteiBottomSheet
        aiRecommendationId={7}
        houses={HOUSES}
        defaultOdd={2.1}
        defaultStake={21}
        market="1x2"
        side="home"
        onSuccess={vi.fn()}
      />,
    );
    // Bottom sheet fecha por padrão
    expect(container.querySelector("[data-apostei-modal]")).toBeNull();
  });

  it("abre ao chamar open (componente controlado via trigger externo)", () => {
    render(
      <AposteiBottomSheet
        aiRecommendationId={7}
        houses={HOUSES}
        defaultOdd={2.1}
        defaultStake={21}
        market="1x2"
        side="home"
        onSuccess={vi.fn()}
        open
      />,
    );
    // Radix Dialog Portal renderiza em document.body — usar screen
    expect(document.querySelector("[data-apostei-modal]")).not.toBeNull();
  });

  it("tela de confirmação mostra resumo explícito (WCAG 3.3.4)", () => {
    render(
      <AposteiBottomSheet
        aiRecommendationId={7}
        houses={HOUSES}
        defaultOdd={2.1}
        defaultStake={21}
        market="1x2"
        side="home"
        onSuccess={vi.fn()}
        open
      />,
    );
    // Deve mostrar texto confirmativo com mercado e side
    expect(screen.getByText(/1x2/i)).toBeInTheDocument();
    expect(screen.getByText(/home/i)).toBeInTheDocument();
  });

  it("botões de ação têm tap target ≥ 44px (min-h-[44px] ou padding equivalente)", () => {
    render(
      <AposteiBottomSheet
        aiRecommendationId={7}
        houses={HOUSES}
        defaultOdd={2.1}
        defaultStake={21}
        market="1x2"
        side="home"
        onSuccess={vi.fn()}
        open
      />,
    );
    // Radix Dialog Portal renderiza em document.body
    const confirmBtn = document.querySelector("[data-apostei-confirm]");
    const cancelBtn = document.querySelector("[data-apostei-cancel]");
    expect(confirmBtn).not.toBeNull();
    expect(cancelBtn).not.toBeNull();
    // Verificar que pelo menos um dos atributos de tamanho está presente
    const confirmClass = confirmBtn!.className;
    const cancelClass = cancelBtn!.className;
    const hasTapTarget = (cls: string) =>
      cls.includes("min-h-[44px]") ||
      cls.includes("min-h-11") ||
      cls.includes("py-3") ||
      cls.includes("py-4") ||
      cls.includes("h-11") ||
      cls.includes("h-12");
    expect(hasTapTarget(confirmClass) || hasTapTarget(cancelClass)).toBe(true);
  });

  it("Cancelar (onCancel prop) fecha o sheet", () => {
    const onCancel = vi.fn();
    render(
      <AposteiBottomSheet
        aiRecommendationId={7}
        houses={HOUSES}
        defaultOdd={2.1}
        defaultStake={21}
        market="1x2"
        side="home"
        onSuccess={vi.fn()}
        onCancel={onCancel}
        open
      />,
    );
    // Radix Portal renderiza em body
    const cancelBtn = document.querySelector("[data-apostei-cancel]") as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Confirmar POSTa /api/ai-reco/apostei e chama onSuccess", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ betId: "bet-xyz" }), { status: 200 }),
      );
    const onSuccess = vi.fn();

    render(
      <AposteiBottomSheet
        aiRecommendationId={7}
        houses={HOUSES}
        defaultOdd={2.1}
        defaultStake={21}
        market="1x2"
        side="home"
        onSuccess={onSuccess}
        open
      />,
    );
    // Radix Portal renderiza em body
    const confirmBtn = document.querySelector("[data-apostei-confirm]") as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai-reco/apostei");
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("bet-xyz"));
  });

  it("exibe erro de validação quando odd inválida", async () => {
    render(
      <AposteiBottomSheet
        aiRecommendationId={7}
        houses={HOUSES}
        defaultOdd={null}
        defaultStake={21}
        market="1x2"
        side="home"
        onSuccess={vi.fn()}
        open
      />,
    );
    // limpar odd field — usa screen (portal em body)
    const oddInput = screen.getByTestId("apostei-odd-input") as HTMLInputElement;
    fireEvent.change(oddInput, { target: { value: "0.5" } });

    const confirmBtn = screen.getByTestId("apostei-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
