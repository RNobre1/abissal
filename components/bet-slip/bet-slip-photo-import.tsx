"use client";

/**
 * BetSlipPhotoImport — Wave N3 + N4 (telemetria)
 *
 * Botão "Importar foto" no header do drawer. Ao receber um arquivo:
 *  1. Envia para parseBetSlipPhoto (Server Action)
 *  2. Exibe UI de confirmação com edição inline das legs e badges de match
 *  3. Ao confirmar, chama addLegToSlip para cada leg e notifica via onLegsAdded
 *
 * Telemetria (Wave N4):
 *  - bilhete_foto_uploaded   — quando user seleciona arquivo
 *  - bilhete_foto_parsed_success — quando parseBetSlipPhoto retorna ok:true
 *  - bilhete_foto_legs_corrected — no click "Adicionar", conta legs editadas
 *  - bilhete_foto_committed  — após addLegToSlip com sucesso para todas as legs
 *  - bilhete_foto_failed     — em qualquer caminho de falha (stage + error_kind)
 */

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { parseBetSlipPhoto, type ParsedLegWithMatch } from "@/lib/bet-slip-ocr/parse-photo-action";
import { addLegToSlip } from "@/lib/bet-slip/actions";
import {
  CONFIDENCE_AUTO_LINK,
  type MatchedFixture,
} from "@/lib/bet-slip-ocr/match-fixture-types";
import { useTelemetry } from "@/lib/telemetry/use-telemetry";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EditableLeg {
  parsed: ParsedLegWithMatch["parsed"];
  match: ParsedLegWithMatch["match"];
  // User-edited fields
  odd_taken: string; // string para input editável
  fixtureOverride: MatchedFixture | null | "manual"; // null = use best; "manual" = sem fixture
}

interface BetSlipPhotoImportProps {
  onLegsAdded: () => void;
}

type ImportState =
  | "idle"
  | "uploading"
  | "confirming"
  | "saving"
  | "error";

// ── Component ─────────────────────────────────────────────────────────────────

export function BetSlipPhotoImport({ onLegsAdded }: BetSlipPhotoImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>("idle");
  const [legs, setLegs] = useState<EditableLeg[]>([]);
  const [slipMeta, setSlipMeta] = useState<{
    stake_total: number | null;
    odd_combined: number | null;
    house_detected: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track which leg indices were edited during the confirmation step
  const editedLegsRef = useRef<Set<number>>(new Set());

  const track = useTelemetry();
  const router = useRouter();

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleButtonClick() {
    inputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be re-selected if needed
    e.target.value = "";
    // Reset edited legs tracking for fresh session
    editedLegsRef.current = new Set();

    setState("uploading");
    setError(null);

    const fd = new FormData();
    fd.append("image", file);

    // N4: bilhete_foto_uploaded — before Server Action call
    track("bilhete_foto_uploaded", {
      file_size_kb: Math.round(file.size / 1024),
      file_type: file.type,
    });

    const result = await parseBetSlipPhoto(fd);

    if (!result.ok) {
      setState("error");
      setError(result.error ?? "Erro desconhecido ao processar imagem.");
      // N4: bilhete_foto_failed — parse stage
      track("bilhete_foto_failed", {
        stage: "parse",
        error_kind: result.error ?? "unknown",
      });
      return;
    }

    // BB-C: Bet Builder detectado — redireciona para o form dedicado
    if (result.redirect_to) {
      track("bilhete_foto_bet_builder_detected", {
        redirect_to: result.redirect_to,
      });
      router.push(result.redirect_to);
      return;
    }

    if (!result.slip) {
      setState("error");
      setError("Erro desconhecido ao processar imagem.");
      track("bilhete_foto_failed", {
        stage: "parse",
        error_kind: "no_slip",
      });
      return;
    }

    const editableLegs: EditableLeg[] = result.slip.legs.map((leg) => ({
      parsed: leg.parsed,
      match: leg.match,
      odd_taken: String(leg.parsed.odd_taken),
      fixtureOverride: null,
    }));

    const legsAutoLinked = editableLegs.filter(
      (leg) => leg.match.best !== null && leg.match.best.confidence >= CONFIDENCE_AUTO_LINK,
    ).length;

    setLegs(editableLegs);
    setSlipMeta({
      stake_total: result.slip.stake_total,
      odd_combined: result.slip.odd_combined,
      house_detected: result.slip.house_detected,
    });
    setState("confirming");

    // N4: bilhete_foto_parsed_success
    track("bilhete_foto_parsed_success", {
      legs_count: editableLegs.length,
      house_detected: result.slip.house_detected ?? undefined,
      legs_auto_linked: legsAutoLinked,
      legs_manual_needed: editableLegs.length - legsAutoLinked,
    });
  }

  function handleOddChange(idx: number, value: string) {
    // Track this index as edited (for corrections_count at confirm time)
    editedLegsRef.current.add(idx);
    setLegs((prev) =>
      prev.map((leg, i) => (i === idx ? { ...leg, odd_taken: value } : leg)),
    );
  }

  function handleFixtureOverride(idx: number, fixture: MatchedFixture | null | "manual") {
    // Track this index as edited (fixture override = a correction)
    editedLegsRef.current.add(idx);
    setLegs((prev) =>
      prev.map((leg, i) =>
        i === idx ? { ...leg, fixtureOverride: fixture } : leg,
      ),
    );
  }

  async function handleConfirm() {
    setState("saving");

    const correctionsCount = editedLegsRef.current.size;
    // N4: bilhete_foto_legs_corrected — emitted once per session, at confirm time
    track("bilhete_foto_legs_corrected", { corrections_count: correctionsCount });

    let legsAdded = 0;
    for (const leg of legs) {
      const oddNum = Number.parseFloat(leg.odd_taken);
      if (!Number.isFinite(oddNum) || oddNum <= 0) continue;

      // Resolve fixture: override > best match > null (manual)
      const resolvedFixture =
        leg.fixtureOverride === "manual"
          ? null
          : leg.fixtureOverride !== null
            ? leg.fixtureOverride
            : leg.match.best;

      try {
        await addLegToSlip({
          fixture_id: resolvedFixture?.fixture_id ?? null,
          home_team: resolvedFixture?.home_team ?? leg.parsed.home,
          away_team: resolvedFixture?.away_team ?? leg.parsed.away,
          market: leg.parsed.market,
          side: leg.parsed.side,
          odd_taken: oddNum,
          league: resolvedFixture?.league ?? leg.parsed.league ?? null,
          kickoff_utc: resolvedFixture?.kickoff_utc ?? leg.parsed.kickoff_iso ?? null,
        });
        legsAdded++;
      } catch (err) {
        // N4: bilhete_foto_failed — commit stage
        track("bilhete_foto_failed", {
          stage: "commit",
          error_kind: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // N4: bilhete_foto_committed
    track("bilhete_foto_committed", { legs_added: legsAdded });

    setState("idle");
    setLegs([]);
    setSlipMeta(null);
    editedLegsRef.current = new Set();
    onLegsAdded();
  }

  function handleDiscard() {
    setState("idle");
    setLegs([]);
    setSlipMeta(null);
    setError(null);
    editedLegsRef.current = new Set();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function needsFixtureSelect(leg: EditableLeg): boolean {
    if (leg.fixtureOverride !== null) return false; // user already picked
    const best = leg.match.best;
    return best === null || best.confidence < CONFIDENCE_AUTO_LINK;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Hidden file input — sem `capture` pra deixar o mobile mostrar
          chooser nativo (câmera OU galeria); Pilot pediu acesso à galeria
          (print salvo) em 2026-05-27. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Trigger button — always visible */}
      <button
        type="button"
        aria-label="Importar foto"
        onClick={handleButtonClick}
        disabled={state === "uploading" || state === "saving"}
        className="label flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
      >
        <Camera size={14} aria-hidden="true" />
        <span>Importar foto</span>
      </button>

      {/* Error inline (state=error) — ancorado ACIMA da MobileBottomNav (z-50)
          via bottom-[calc(5rem+env(safe-area-inset-bottom))]. z-60 garante
          que cobre a nav, não fica atrás. */}
      {state === "error" && error ? (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-[60] flex flex-col gap-2 rounded-t-[var(--radius)] bg-[var(--color-surface-2)] p-4 shadow-lg lg:bottom-auto lg:inset-auto lg:right-4 lg:top-16 lg:w-80 lg:rounded-[var(--radius)]"
        >
          <p className="label text-[var(--color-warning)]">{error}</p>
          <button
            type="button"
            onClick={handleDiscard}
            className="label text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            Fechar
          </button>
        </div>
      ) : null}

      {/* Uploading spinner overlay — mesma regra de bottom + z-60 */}
      {state === "uploading" ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-[60] flex flex-col items-center gap-3 rounded-t-[var(--radius)] bg-[var(--color-surface-2)] p-6 shadow-lg lg:bottom-auto lg:inset-auto lg:right-4 lg:top-16 lg:w-80 lg:rounded-[var(--radius)]"
        >
          <span
            className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-vermelho)] border-t-transparent"
            aria-hidden="true"
          />
          <p className="label text-[var(--color-ink-muted)]">
            Analisando cupom...
          </p>
        </div>
      ) : null}

      {/* Confirmation panel — mesma regra */}
      {state === "confirming" || state === "saving" ? (
        <div
          role="dialog"
          aria-label="Confirmar legs do cupom"
          className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-[60] flex max-h-[70vh] flex-col overflow-y-auto rounded-t-[var(--radius)] bg-[var(--color-surface-2)] shadow-lg lg:bottom-auto lg:inset-auto lg:right-4 lg:top-16 lg:max-h-none lg:w-80 lg:rounded-[var(--radius)]"
        >
          {/* Header */}
          <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
            <span className="font-display text-base font-medium text-[var(--color-ink-display)]">
              Cupom importado
              {slipMeta?.house_detected
                ? ` · ${slipMeta.house_detected}`
                : ""}
            </span>
            <button
              type="button"
              aria-label="Descartar"
              onClick={handleDiscard}
              disabled={state === "saving"}
              className="label text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              ✕
            </button>
          </header>

          {/* Legs list */}
          <ul className="flex max-h-72 flex-col divide-y divide-[var(--color-line)] overflow-y-auto">
            {legs.map((leg, idx) => {
              const showSelect = needsFixtureSelect(leg);
              const isLinked =
                !showSelect &&
                (leg.fixtureOverride !== null
                  ? leg.fixtureOverride !== "manual"
                  : leg.match.best !== null);

              return (
                <li
                  key={idx}
                  className="flex flex-col gap-2 px-4 py-3"
                >
                  {/* Teams */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="label truncate font-semibold text-[var(--color-ink)]">
                        {leg.parsed.home} × {leg.parsed.away}
                      </div>
                      <div className="label text-[var(--color-ink-muted)]">
                        {leg.parsed.market} / {leg.parsed.side}
                      </div>
                      {leg.parsed.league ? (
                        <div className="label text-xs text-[var(--color-ink-faint)]">
                          {leg.parsed.league}
                        </div>
                      ) : null}
                    </div>
                    {/* Odd inline edit */}
                    <input
                      type="number"
                      min="1.01"
                      step="0.01"
                      value={leg.odd_taken}
                      onChange={(e) => handleOddChange(idx, e.target.value)}
                      disabled={state === "saving"}
                      aria-label="Odd"
                      className="label w-16 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-2 py-1 tabular-nums text-[var(--color-ink)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60"
                    />
                  </div>

                  {/* Match badge */}
                  {isLinked ? (
                    <span className="label inline-flex w-fit items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] px-2 py-0.5 text-xs text-[var(--color-success)]">
                      ✓ Vinculado
                    </span>
                  ) : null}

                  {/* Fixture selector quando não auto-linkado */}
                  {showSelect ? (
                    <div className="flex flex-col gap-1">
                      <span className="label text-xs text-[var(--color-warning)]">
                        ? Selecione fixture
                      </span>
                      <select
                        value={
                          leg.fixtureOverride === null
                            ? leg.match.best?.fixture_id ?? "__none"
                            : leg.fixtureOverride === "manual"
                              ? "__none"
                              : (leg.fixtureOverride as MatchedFixture).fixture_id
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "__none") {
                            handleFixtureOverride(idx, "manual");
                          } else {
                            const picked =
                              leg.match.candidates.find(
                                (c) => c.fixture_id === Number(val),
                              ) ?? null;
                            handleFixtureOverride(idx, picked);
                          }
                        }}
                        disabled={state === "saving"}
                        aria-label="Selecionar fixture"
                        className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-2 py-1 text-sm text-[var(--color-ink)] disabled:opacity-60"
                      >
                        {leg.match.candidates.map((c) => (
                          <option key={c.fixture_id} value={c.fixture_id}>
                            {c.home_team} × {c.away_team}
                            {` (${(c.confidence * 100).toFixed(0)}%)`}
                          </option>
                        ))}
                        <option value="__none">Manual / nenhum fixture</option>
                      </select>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {/* Footer */}
          <div className="flex flex-col gap-2 border-t border-[var(--color-line)] px-4 py-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={state === "saving" || legs.length === 0}
              className="label rounded-[var(--radius-sm)] border border-[var(--color-vermelho)] px-3 py-2 text-[var(--color-vermelho)] hover:bg-[var(--color-vermelho)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "saving"
                ? "Adicionando..."
                : `Adicionar ${legs.length} leg${legs.length !== 1 ? "s" : ""} ao bilhete`}
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={state === "saving"}
              className="label text-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)] disabled:opacity-60"
            >
              Descartar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
