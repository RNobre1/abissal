/**
 * TDD — BetSlipPhotoImport component
 *
 * Cenários:
 *  1. Renderiza botão "Importar foto"
 *  2. Click no botão → file input dispara
 *  3. Mock action → renderiza UI de confirmação após parseBetSlipPhoto resolve com sucesso
 *  4. Renderiza erro se action retorna ok:false
 *  5. Editar odd_taken inline → state local atualiza
 *  6. Click "Adicionar" → chama addLegToSlip (mock) N vezes, depois onLegsAdded
 *  7. Dropdown de fixture override aparece quando best === null OR confidence < 0.85
 *
 * Wave N4 — Telemetria (novos cenários):
 *  8.  bilhete_foto_uploaded — disparado ao selecionar arquivo, antes da Server Action
 *  9.  bilhete_foto_parsed_success — disparado quando parseBetSlipPhoto retorna ok:true
 *  10. bilhete_foto_legs_corrected — disparado no click "Adicionar" com corrections_count
 *  11. bilhete_foto_committed — disparado após addLegToSlip com sucesso para todas legs
 *  12. bilhete_foto_failed — disparado em qualquer caminho de falha
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ParsePhotoResult } from "@/lib/bet-slip-ocr/parse-photo-action";

// ── Module mocks ───────────────────────────────────────────────────────────────

const mockParseBetSlipPhoto = vi.fn<(fd: FormData) => Promise<ParsePhotoResult>>();
vi.mock("@/lib/bet-slip-ocr/parse-photo-action", () => ({
  parseBetSlipPhoto: (fd: FormData) => mockParseBetSlipPhoto(fd),
}));

const mockAddLegToSlip = vi.fn().mockResolvedValue({ slipId: 1, legId: 1 });
vi.mock("@/lib/bet-slip/actions", () => ({
  addLegToSlip: (...args: unknown[]) => mockAddLegToSlip(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush, refresh: vi.fn() }),
}));

// ── Telemetry mock (Wave N4) ───────────────────────────────────────────────────

const mockTrack = vi.fn();
vi.mock("@/lib/telemetry/use-telemetry", () => ({
  useTelemetry: () => mockTrack,
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PARSED_RESULT_OK: ParsePhotoResult = {
  ok: true,
  slip: {
    legs: [
      {
        parsed: {
          home: "Flamengo",
          away: "Palmeiras",
          market: "1X2",
          side: "Casa",
          odd_taken: 2.1,
          league: "Brasileirão Série A",
          kickoff_iso: "2026-05-26T22:00:00Z",
        },
        match: {
          best: {
            fixture_id: 999,
            home_team: "Flamengo",
            away_team: "Palmeiras",
            league: "Brasileirão Série A",
            country: "brazil",
            kickoff_utc: "2026-05-26T22:00:00Z",
            confidence: 0.95,
          },
          candidates: [
            {
              fixture_id: 999,
              home_team: "Flamengo",
              away_team: "Palmeiras",
              league: "Brasileirão Série A",
              country: "brazil",
              kickoff_utc: "2026-05-26T22:00:00Z",
              confidence: 0.95,
            },
          ],
        },
      },
    ],
    stake_total: 50,
    odd_combined: 2.1,
    house_detected: "superbet",
  },
};

const PARSED_RESULT_NO_MATCH: ParsePhotoResult = {
  ok: true,
  slip: {
    legs: [
      {
        parsed: {
          home: "TimeDesconhecido",
          away: "OutroTime",
          market: "1X2",
          side: "Casa",
          odd_taken: 1.8,
          league: null,
          kickoff_iso: null,
        },
        match: {
          best: null,
          candidates: [],
        },
      },
    ],
    stake_total: null,
    odd_combined: null,
    house_detected: null,
  },
};

const PARSED_RESULT_LOW_CONFIDENCE: ParsePhotoResult = {
  ok: true,
  slip: {
    legs: [
      {
        parsed: {
          home: "Arsenal",
          away: "Chelsea",
          market: "BTTS",
          side: "Sim",
          odd_taken: 1.7,
          league: "Premier League",
          kickoff_iso: "2026-05-27T20:00:00Z",
        },
        match: {
          best: {
            fixture_id: 888,
            home_team: "Arsenal FC",
            away_team: "Chelsea FC",
            league: "Premier League",
            country: "england",
            kickoff_utc: "2026-05-27T20:00:00Z",
            confidence: 0.6, // < 0.85 → deve mostrar dropdown
          },
          candidates: [
            {
              fixture_id: 888,
              home_team: "Arsenal FC",
              away_team: "Chelsea FC",
              league: "Premier League",
              country: "england",
              kickoff_utc: "2026-05-27T20:00:00Z",
              confidence: 0.6,
            },
          ],
        },
      },
    ],
    stake_total: null,
    odd_combined: 1.7,
    house_detected: "bet365",
  },
};

// ── Helper ─────────────────────────────────────────────────────────────────────

function makeImageFile(type = "image/jpeg", size = 1024): File {
  return new File([new Uint8Array(size)], "cupom.jpg", { type });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("BetSlipPhotoImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrack.mockReset();
  });

  async function renderComponent() {
    const { BetSlipPhotoImport } = await import(
      "@/components/bet-slip/bet-slip-photo-import"
    );
    const onLegsAdded = vi.fn();
    const utils = render(<BetSlipPhotoImport onLegsAdded={onLegsAdded} />);
    return { ...utils, onLegsAdded };
  }

  it("renderiza botão 'Importar foto'", async () => {
    await renderComponent();
    expect(
      screen.getByRole("button", { name: /importar foto/i }),
    ).toBeInTheDocument();
  });

  it("click no botão abre file input (click simulado)", async () => {
    await renderComponent();
    const btn = screen.getByRole("button", { name: /importar foto/i });
    const inputClickSpy = vi.fn();

    // Spy on the hidden input click
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (input) {
      input.click = inputClickSpy;
    }

    fireEvent.click(btn);
    expect(inputClickSpy).toHaveBeenCalled();
  });

  it("renderiza UI de confirmação após parseBetSlipPhoto resolve com sucesso", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_OK);

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeImageFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Flamengo/i)).toBeInTheDocument();
    });
    // Confirmation footer button
    expect(screen.getByRole("button", { name: /adicionar/i })).toBeInTheDocument();
  });

  it("renderiza erro se action retorna ok:false", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce({
      ok: false,
      error: "Não consegui ler o cupom. Tenta com uma foto mais clara.",
    });

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeImageFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Não consegui ler/i)).toBeInTheDocument();
    });
  });

  it("editar odd_taken inline → valor atualiza no campo", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_OK);

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeImageFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Flamengo/i)).toBeInTheDocument();
    });

    const oddInput = screen.getByDisplayValue("2.1");
    fireEvent.change(oddInput, { target: { value: "2.5" } });
    expect((oddInput as HTMLInputElement).value).toBe("2.5");
  });

  it("click 'Adicionar' → chama addLegToSlip N vezes, depois onLegsAdded", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_OK);
    mockAddLegToSlip.mockResolvedValue({ slipId: 1, legId: 1 });

    const { onLegsAdded } = await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeImageFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /adicionar/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /adicionar/i }));
    });

    await waitFor(() => {
      expect(mockAddLegToSlip).toHaveBeenCalledTimes(1);
      expect(onLegsAdded).toHaveBeenCalledOnce();
    });
  });

  it("dropdown de fixture override aparece quando best === null", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_NO_MATCH);

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeImageFile()] },
      });
    });

    await waitFor(() => {
      // Should show "Selecione fixture" badge/label
      expect(screen.getByText(/Selecione fixture/i)).toBeInTheDocument();
    });
  });

  it("dropdown de fixture override aparece quando confidence < 0.85", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_LOW_CONFIDENCE);

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeImageFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Selecione fixture/i)).toBeInTheDocument();
    });
  });

  // ── Wave N4: Telemetria ──────────────────────────────────────────────────────

  it("[N4] bilhete_foto_uploaded — dispara ao selecionar arquivo com payload correto", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_OK);

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile("image/jpeg", 2048);

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // Should fire BEFORE parseBetSlipPhoto resolves (synchronous first thing in handler)
    const uploadCalls = mockTrack.mock.calls.filter(
      (args) => (args as [string])[0] === "bilhete_foto_uploaded",
    );
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0][1]).toMatchObject({
      file_size_kb: expect.any(Number),
      file_type: "image/jpeg",
    });
  });

  it("[N4] bilhete_foto_parsed_success — dispara quando action retorna ok:true", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_OK);

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeImageFile()] } });
    });

    await waitFor(() => {
      expect(screen.getByText(/Flamengo/i)).toBeInTheDocument();
    });

    const parsedCalls = mockTrack.mock.calls.filter(
      (args) => (args as [string])[0] === "bilhete_foto_parsed_success",
    );
    expect(parsedCalls).toHaveLength(1);
    expect(parsedCalls[0][1]).toMatchObject({
      legs_count: 1,
      house_detected: "superbet",
      legs_auto_linked: expect.any(Number),
      legs_manual_needed: expect.any(Number),
    });
  });

  it("[N4] bilhete_foto_committed — dispara após addLegToSlip com legs_added correto", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_OK);
    mockAddLegToSlip.mockResolvedValue({ slipId: 1, legId: 1 });

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeImageFile()] } });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /adicionar/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /adicionar/i }));
    });

    await waitFor(() => {
      const committedCalls = mockTrack.mock.calls.filter(
        (args) => (args as [string])[0] === "bilhete_foto_committed",
      );
      expect(committedCalls).toHaveLength(1);
      expect(committedCalls[0][1]).toMatchObject({ legs_added: 1 });
    });
  });

  it("[N4] bilhete_foto_legs_corrected — dispara no click confirmar com corrections_count", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_OK);
    mockAddLegToSlip.mockResolvedValue({ slipId: 1, legId: 1 });

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeImageFile()] } });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("2.1")).toBeInTheDocument();
    });

    // Edit odd (counts as 1 correction)
    const oddInput = screen.getByDisplayValue("2.1");
    fireEvent.change(oddInput, { target: { value: "2.5" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /adicionar/i }));
    });

    await waitFor(() => {
      const correctedCalls = mockTrack.mock.calls.filter(
        (args) => (args as [string])[0] === "bilhete_foto_legs_corrected",
      );
      expect(correctedCalls).toHaveLength(1);
      expect(correctedCalls[0][1]).toMatchObject({ corrections_count: 1 });
    });
  });

  it("[N4] bilhete_foto_failed — dispara quando parseBetSlipPhoto retorna ok:false", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce({
      ok: false,
      error: "Não consegui ler o cupom.",
    });

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeImageFile()] } });
    });

    await waitFor(() => {
      expect(screen.getByText(/Não consegui ler/i)).toBeInTheDocument();
    });

    const failedCalls = mockTrack.mock.calls.filter(
      (args) => (args as [string])[0] === "bilhete_foto_failed",
    );
    expect(failedCalls).toHaveLength(1);
    expect(failedCalls[0][1]).toMatchObject({
      stage: "parse",
      error_kind: expect.any(String),
    });
  });

  // ── BB-C: Bet Builder redirect ───────────────────────────────────────────────

  it("[BB-C] redirect_to presente => router.push chamado, modal NAO abre", async () => {
    mockRouterPush.mockClear();

    mockParseBetSlipPhoto.mockResolvedValueOnce({
      ok: true,
      redirect_to: "/bilhete/builder?fixture_id=999&odd=50&stake=25&house=bet365&legs=%5B%5D",
    });

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeImageFile()] } });
    });

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith(
        expect.stringContaining("/bilhete/builder"),
      );
    });

    // Modal de confirmacao NAO deve aparecer
    expect(screen.queryByRole("dialog", { name: /confirmar legs/i })).toBeNull();
  });

  it("[BB-C] slip presente (sem redirect_to) => modal de confirmacao abre normalmente", async () => {
    mockParseBetSlipPhoto.mockResolvedValueOnce(PARSED_RESULT_OK);

    await renderComponent();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeImageFile()] } });
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /confirmar legs/i })).toBeInTheDocument();
    });
  });
});
