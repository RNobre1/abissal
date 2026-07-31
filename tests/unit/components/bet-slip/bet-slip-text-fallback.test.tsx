/**
 * F6 — OCR que conversa quando falha: fallback de TEXTO LIVRE no
 * BetSlipPhotoImport.
 *
 * Cenários:
 *  1. falha de foto com error_kind de CONTEÚDO (unreadable, no-legs-found,
 *     invalid-json, gemini-error) → além da mensagem, aparece o fallback
 *     (textarea + "Montar do texto")
 *  2. falha de GATE (ai-disabled, no-session, invalid-mime, too-large) →
 *     fallback NÃO aparece
 *  3. link discreto "prefiro digitar" sempre acessível → abre a entrada de
 *     texto sem precisar de falha
 *  4. submit chama parseBetSlipText com o texto; sucesso → mesma tela de
 *     revisão de legs do fluxo de foto
 *  5. telemetria: bilhete_texto_submitted, bilhete_texto_parsed_success
 *     (com recovered_from_photo:true quando veio de falha de foto),
 *     bilhete_texto_failed
 *  6. falha do texto → mensagem acionável, textarea preserva o valor e dá
 *     pra editar e tentar de novo
 *  7. bet builder no modo texto → router.push(redirect_to)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ParsePhotoResult } from "@/lib/bet-slip-ocr/parse-photo-action";

// ── Module mocks ───────────────────────────────────────────────────────────────

const mockParseBetSlipPhoto = vi.fn<(fd: FormData) => Promise<ParsePhotoResult>>();
vi.mock("@/lib/bet-slip-ocr/parse-photo-action", () => ({
  parseBetSlipPhoto: (fd: FormData) => mockParseBetSlipPhoto(fd),
}));

const mockParseBetSlipText = vi.fn<(input: { text: string }) => Promise<ParsePhotoResult>>();
vi.mock("@/lib/bet-slip-ocr/parse-text-action", () => ({
  parseBetSlipText: (input: { text: string }) => mockParseBetSlipText(input),
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

const mockTrack = vi.fn();
vi.mock("@/lib/telemetry/use-telemetry", () => ({
  useTelemetry: () => mockTrack,
}));

import { BetSlipPhotoImport } from "@/components/bet-slip/bet-slip-photo-import";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TEXT_OK_RESULT: ParsePhotoResult = {
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
          kickoff_iso: "2026-07-30T22:00:00Z",
          builder_selections: null,
        },
        match: {
          best: {
            fixture_id: 999,
            home_team: "Flamengo",
            away_team: "Palmeiras",
            league: "Brasileirão Série A",
            country: "brazil",
            kickoff_utc: "2026-07-30T22:00:00Z",
            confidence: 0.95,
          },
          candidates: [],
        },
      },
    ],
    stake_total: 50,
    odd_combined: 2.1,
    house_detected: "superbet",
  },
};

const USER_TEXT = "Flamengo x Palmeiras, casa vence, odd 2.10, R$ 50";

function uploadPhotoFailure(errorKind: ParsePhotoResult["error_kind"], error = "falhou") {
  mockParseBetSlipPhoto.mockResolvedValueOnce({ ok: false, error, error_kind: errorKind });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array(10)], "cupom.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
}

function textForm() {
  return {
    textarea: screen.queryByLabelText("Descrição do bilhete"),
    submit: screen.queryByRole("button", { name: /montar do texto/i }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAddLegToSlip.mockResolvedValue({ slipId: 1, legId: 1 });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("BetSlipPhotoImport — fallback de texto na falha de foto", () => {
  const contentKinds = ["unreadable", "no-legs-found", "invalid-json", "gemini-error"] as const;

  for (const kind of contentKinds) {
    it(`falha de conteúdo '${kind}' → fallback aparece junto da mensagem de erro`, async () => {
      render(<BetSlipPhotoImport onLegsAdded={vi.fn()} />);
      uploadPhotoFailure(kind, "não deu pra ler");

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      expect(screen.getByText("não deu pra ler")).toBeInTheDocument();
      const { textarea, submit } = textForm();
      expect(textarea).toBeInTheDocument();
      expect(submit).toBeInTheDocument();
      expect(screen.getByText(/sem problema — descreve o bilhete aqui/i)).toBeInTheDocument();
    });
  }

  const gateKinds = ["no-session", "ai-disabled", "invalid-mime", "too-large"] as const;

  for (const kind of gateKinds) {
    it(`falha de gate '${kind}' → fallback NÃO aparece`, async () => {
      render(<BetSlipPhotoImport onLegsAdded={vi.fn()} />);
      uploadPhotoFailure(kind);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      const { textarea, submit } = textForm();
      expect(textarea).not.toBeInTheDocument();
      expect(submit).not.toBeInTheDocument();
    });
  }
});

describe("BetSlipPhotoImport — entrada direta 'prefiro digitar'", () => {
  it("link discreto visível sem falha; click abre a entrada de texto", () => {
    render(<BetSlipPhotoImport onLegsAdded={vi.fn()} />);

    const link = screen.getByRole("button", { name: /prefiro digitar/i });
    expect(textForm().textarea).not.toBeInTheDocument();

    fireEvent.click(link);

    expect(textForm().textarea).toBeInTheDocument();
    expect(textForm().submit).toBeInTheDocument();
  });
});

describe("BetSlipPhotoImport — submit do texto", () => {
  it("chama parseBetSlipText com o texto e, no sucesso, mostra a tela de revisão", async () => {
    mockParseBetSlipText.mockResolvedValueOnce(TEXT_OK_RESULT);
    render(<BetSlipPhotoImport onLegsAdded={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /prefiro digitar/i }));
    fireEvent.change(textForm().textarea!, { target: { value: USER_TEXT } });
    fireEvent.click(textForm().submit!);

    await waitFor(() => {
      expect(screen.getByText(/cupom importado/i)).toBeInTheDocument();
    });
    expect(mockParseBetSlipText).toHaveBeenCalledWith({ text: USER_TEXT });
    // mesma tela de revisão do fluxo de foto: leg + odd editável
    expect(screen.getByText("Flamengo × Palmeiras")).toBeInTheDocument();
    expect(screen.getByLabelText("Odd")).toBeInTheDocument();
  });

  it("telemetria: submitted + parsed_success com recovered_from_photo:true quando veio de falha de foto", async () => {
    mockParseBetSlipText.mockResolvedValueOnce(TEXT_OK_RESULT);
    render(<BetSlipPhotoImport onLegsAdded={vi.fn()} />);

    uploadPhotoFailure("unreadable");
    await waitFor(() => {
      expect(textForm().textarea).toBeInTheDocument();
    });

    fireEvent.change(textForm().textarea!, { target: { value: USER_TEXT } });
    fireEvent.click(textForm().submit!);

    await waitFor(() => {
      expect(screen.getByText(/cupom importado/i)).toBeInTheDocument();
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "bilhete_texto_submitted",
      expect.objectContaining({ recovered_from_photo: true }),
    );
    expect(mockTrack).toHaveBeenCalledWith(
      "bilhete_texto_parsed_success",
      expect.objectContaining({ recovered_from_photo: true, legs_count: 1 }),
    );
  });

  it("telemetria: recovered_from_photo:false quando veio do 'prefiro digitar'", async () => {
    mockParseBetSlipText.mockResolvedValueOnce(TEXT_OK_RESULT);
    render(<BetSlipPhotoImport onLegsAdded={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /prefiro digitar/i }));
    fireEvent.change(textForm().textarea!, { target: { value: USER_TEXT } });
    fireEvent.click(textForm().submit!);

    await waitFor(() => {
      expect(screen.getByText(/cupom importado/i)).toBeInTheDocument();
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "bilhete_texto_parsed_success",
      expect.objectContaining({ recovered_from_photo: false }),
    );
  });

  it("falha do texto → bilhete_texto_failed + mensagem acionável; textarea preserva o valor e dá pra tentar de novo", async () => {
    mockParseBetSlipText
      .mockResolvedValueOnce({
        ok: false,
        error: "Não identifiquei nenhuma seleção na descrição",
        error_kind: "no-legs-found",
      })
      .mockResolvedValueOnce(TEXT_OK_RESULT);
    render(<BetSlipPhotoImport onLegsAdded={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /prefiro digitar/i }));
    fireEvent.change(textForm().textarea!, { target: { value: "descrição vaga" } });
    fireEvent.click(textForm().submit!);

    await waitFor(() => {
      expect(screen.getByText(/não identifiquei nenhuma seleção/i)).toBeInTheDocument();
    });
    expect(mockTrack).toHaveBeenCalledWith(
      "bilhete_texto_failed",
      expect.objectContaining({ error_kind: "no-legs-found" }),
    );

    // valor preservado, edição + retry funcionam
    const textarea = textForm().textarea as HTMLTextAreaElement;
    expect(textarea.value).toBe("descrição vaga");
    fireEvent.change(textarea, { target: { value: USER_TEXT } });
    fireEvent.click(textForm().submit!);

    await waitFor(() => {
      expect(screen.getByText(/cupom importado/i)).toBeInTheDocument();
    });
  });

  it("bet builder no modo texto → router.push(redirect_to)", async () => {
    mockParseBetSlipText.mockResolvedValueOnce({
      ok: true,
      redirect_to: "/bilhete/builder?fixture_id=999",
    });
    render(<BetSlipPhotoImport onLegsAdded={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /prefiro digitar/i }));
    fireEvent.change(textForm().textarea!, { target: { value: USER_TEXT } });
    fireEvent.click(textForm().submit!);

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith("/bilhete/builder?fixture_id=999");
    });
  });
});
