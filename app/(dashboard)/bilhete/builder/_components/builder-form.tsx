"use client";

/**
 * BuilderForm — Formulário manual de Bet Builder.
 *
 * Campos: casa, jogo (home/away fuzzy), odd combinada, stake, lista dinâmica de legs.
 * Suporta pré-preenchimento via `initialParams` (query params do Worker C).
 */

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBetBuilderAction, type CreateBetBuilderInput } from "../actions";
import type { MatchedFixture } from "@/lib/bet-slip-ocr/match-fixture-types";
import { createClient } from "@/lib/supabase/client";

interface HouseOption {
  id: string;
  name: string;
}

interface Leg {
  id: number;
  market: string;
  side: string;
}

export interface BuilderFormProps {
  houses: HouseOption[];
  /** Query params for pre-filling (passed from Server Component or tests) */
  initialParams?: URLSearchParams;
}

let _legCounter = 0;
function nextLegId() {
  return ++_legCounter;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseLegsParam(raw: string | null): Leg[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.market === "string" &&
          typeof item.side === "string",
      )
      .map((item) => ({
        id: nextLegId(),
        market: item.market,
        side: item.side,
      }));
  } catch {
    return [];
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BuilderForm({ houses, initialParams }: BuilderFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // --- form state ---
  const params = initialParams ?? new URLSearchParams();

  const [houseId, setHouseId] = useState(
    params.get("house") ?? houses[0]?.id ?? "",
  );
  const [homeTeam, setHomeTeam] = useState(params.get("home") ?? "");
  const [awayTeam, setAwayTeam] = useState(params.get("away") ?? "");
  const [oddCombined, setOddCombined] = useState(params.get("odd") ?? "");
  const [stake, setStake] = useState(params.get("stake") ?? "");
  const [thesis, setThesis] = useState("");

  // fixture search state
  const [fixtureId, setFixtureId] = useState<number | null>(
    params.get("fixture_id") ? Number(params.get("fixture_id")) : null,
  );
  const [candidates, setCandidates] = useState<MatchedFixture[]>([]);
  const [searching, setSearching] = useState(false);
  const [fixtureConfirmed, setFixtureConfirmed] = useState(
    params.get("fixture_id") != null,
  );

  // legs
  const parsedLegs = parseLegsParam(params.get("legs"));
  const [legs, setLegs] = useState<Leg[]>(
    parsedLegs.length > 0
      ? parsedLegs
      : [{ id: nextLegId(), market: "", side: "" }],
  );

  // ── Fixture fuzzy search ────────────────────────────────────────────────────

  const handleFixtureSearch = useCallback(async () => {
    if (!homeTeam.trim() || !awayTeam.trim()) return;
    setSearching(true);
    setFixtureConfirmed(false);
    setFixtureId(null);
    setCandidates([]);
    try {
      const supabase = createClient();
      // Call match_fixture_fuzzy RPC directly via browser client to avoid
      // importing match-fixture.ts (which pulls server.ts into client bundle).
      const { data } = await supabase.rpc("match_fixture_fuzzy", {
        p_home: homeTeam,
        p_away: awayTeam,
        p_kickoff: null,
      });
      const rows = (data ?? []) as Array<{
        id: number;
        home_team: string;
        away_team: string;
        league: string | null;
        country: string | null;
        kickoff_utc: string;
        confidence: number | string;
      }>;
      const mapped: MatchedFixture[] = rows.slice(0, 3).map((r) => ({
        fixture_id: Number(r.id),
        home_team: r.home_team,
        away_team: r.away_team,
        league: r.league,
        country: r.country,
        kickoff_utc: r.kickoff_utc,
        confidence: Number(r.confidence),
      }));
      setCandidates(mapped);
    } catch {
      // best-effort
    } finally {
      setSearching(false);
    }
  }, [homeTeam, awayTeam]);

  function handleConfirmFixture(candidate: MatchedFixture) {
    setFixtureId(candidate.fixture_id);
    setHomeTeam(candidate.home_team);
    setAwayTeam(candidate.away_team);
    setFixtureConfirmed(true);
    setCandidates([]);
  }

  function handleClearFixture() {
    setFixtureId(null);
    setFixtureConfirmed(false);
    setCandidates([]);
  }

  // ── Leg management ──────────────────────────────────────────────────────────

  function addLeg() {
    setLegs((prev) => [...prev, { id: nextLegId(), market: "", side: "" }]);
  }

  function removeLeg(id: number) {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  }

  function updateLeg(id: number, field: "market" | "side", value: string) {
    setLegs((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const input: CreateBetBuilderInput = {
      house_id: houseId,
      fixture_id: fixtureId,
      home_team: homeTeam,
      away_team: awayTeam,
      odd_combined: Number(oddCombined),
      stake: Number(stake),
      legs: legs.map(({ market, side }) => ({ market, side })),
      thesis: thesis || undefined,
    };

    startTransition(async () => {
      const result = await createBetBuilderAction(input);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      // redirect happens server-side on success; also push client-side as fallback
      router.push("/bets");
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* ── Casa ─────────────────────────────────────────────────────────── */}
      <label className="flex flex-col gap-1.5">
        <span className="label text-[var(--color-ink-muted)]">Casa</span>
        <select
          value={houseId}
          onChange={(e) => setHouseId(e.target.value)}
          disabled={pending}
          className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)] disabled:opacity-60"
        >
          {houses.length === 0 ? (
            <option value="">(nenhuma casa cadastrada)</option>
          ) : (
            houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))
          )}
        </select>
      </label>

      {/* ── Jogo (home + away + fuzzy search) ────────────────────────────── */}
      <fieldset className="card flex flex-col gap-3 p-4">
        <legend className="label mb-1 text-[var(--color-ink-muted)]">
          Jogo
        </legend>

        {fixtureConfirmed && fixtureId ? (
          <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-success)] bg-transparent px-3 py-2">
            <span className="font-semibold text-[var(--color-ink)]">
              {homeTeam} × {awayTeam}
            </span>
            <button
              type="button"
              onClick={handleClearFixture}
              className="label text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]"
            >
              trocar
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                value={homeTeam}
                onChange={(e) => setHomeTeam(e.target.value)}
                placeholder="Time da casa"
                aria-label="Time da casa"
                disabled={pending}
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60"
              />
              <span className="self-center text-[var(--color-ink-faint)]">×</span>
              <input
                type="text"
                value={awayTeam}
                onChange={(e) => setAwayTeam(e.target.value)}
                placeholder="Time visitante"
                aria-label="Time visitante"
                disabled={pending}
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60"
              />
            </div>

            <button
              type="button"
              onClick={handleFixtureSearch}
              disabled={pending || searching || !homeTeam.trim() || !awayTeam.trim()}
              className="label self-start rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-1.5 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {searching ? "buscando…" : "Buscar fixture"}
            </button>

            {/* Candidates */}
            {candidates.length > 0 && (
              <ul className="flex flex-col gap-1">
                {candidates.map((c) => (
                  <li key={c.fixture_id}>
                    <button
                      type="button"
                      onClick={() => handleConfirmFixture(c)}
                      className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2 text-left hover:border-[var(--color-vermelho)] hover:text-[var(--color-ink)]"
                    >
                      <span className="font-semibold">
                        {c.home_team} × {c.away_team}
                      </span>
                      {c.league && (
                        <span className="label ml-2 text-[var(--color-ink-faint)]">
                          {c.league}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setFixtureId(null);
                      setFixtureConfirmed(true);
                      setCandidates([]);
                    }}
                    className="label text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]"
                  >
                    registrar sem fixture
                  </button>
                </li>
              </ul>
            )}

            {!fixtureConfirmed && candidates.length === 0 && (homeTeam || awayTeam) && (
              <button
                type="button"
                onClick={() => {
                  setFixtureId(null);
                  setFixtureConfirmed(true);
                }}
                className="label self-start text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]"
              >
                Continuar sem vincular fixture
              </button>
            )}
          </>
        )}
      </fieldset>

      {/* ── Odd combinada ─────────────────────────────────────────────────── */}
      <label className="flex flex-col gap-1.5">
        <span className="label text-[var(--color-ink-muted)]">
          Odd combinada
        </span>
        <input
          type="number"
          min="1.02"
          step="0.01"
          inputMode="decimal"
          value={oddCombined}
          onChange={(e) => setOddCombined(e.target.value)}
          disabled={pending}
          placeholder="ex: 5.50"
          aria-label="Odd combinada"
          className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 tabular-nums text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60"
        />
      </label>

      {/* ── Stake ─────────────────────────────────────────────────────────── */}
      <label className="flex flex-col gap-1.5">
        <span className="label text-[var(--color-ink-muted)]">Stake (R$)</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          disabled={pending}
          placeholder="0,00"
          aria-label="Stake"
          className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 tabular-nums text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60"
        />
      </label>

      {/* ── Legs list ─────────────────────────────────────────────────────── */}
      <fieldset className="card flex flex-col gap-3 p-4">
        <legend className="label mb-1 text-[var(--color-ink-muted)]">
          Condições ({legs.length})
        </legend>

        {legs.map((leg, idx) => (
          <div
            key={leg.id}
            data-leg-id={leg.id}
            className="flex items-start gap-2"
          >
            <div className="flex flex-1 flex-col gap-1.5 sm:flex-row">
              <input
                type="text"
                value={leg.market}
                onChange={(e) => updateLeg(leg.id, "market", e.target.value)}
                placeholder="Mercado (ex: Mais 10.5)"
                aria-label={`Mercado da condição ${idx + 1}`}
                disabled={pending}
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60"
              />
              <input
                type="text"
                value={leg.side}
                onChange={(e) => updateLeg(leg.id, "side", e.target.value)}
                placeholder="Seleção (ex: Chutes no gol)"
                aria-label={`Seleção da condição ${idx + 1}`}
                disabled={pending}
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60"
              />
            </div>
            {legs.length > 1 && (
              <button
                type="button"
                onClick={() => removeLeg(leg.id)}
                disabled={pending}
                aria-label={`Remover condição ${idx + 1}`}
                className="label mt-2 shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-vermelho)] disabled:opacity-40"
              >
                × remover
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={addLeg}
          disabled={pending}
          className="label self-start rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] px-3 py-1.5 text-[var(--color-ink-muted)] hover:border-[var(--color-vermelho)] hover:text-[var(--color-ink)] disabled:opacity-40"
        >
          + adicionar condição
        </button>
      </fieldset>

      {/* ── Thesis (optional) ─────────────────────────────────────────────── */}
      <label className="flex flex-col gap-1.5">
        <span className="label text-[var(--color-ink-faint)]">
          Tese (opcional)
        </span>
        <textarea
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          disabled={pending}
          placeholder="Raciocínio por trás do bet builder…"
          rows={2}
          maxLength={1000}
          className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60 resize-y"
        />
      </label>

      {/* ── Potencial return preview ───────────────────────────────────────── */}
      {oddCombined && stake && Number(oddCombined) > 1.01 && Number(stake) > 0 ? (
        <div className="flex items-baseline justify-between">
          <span className="label text-[var(--color-ink-muted)]">
            Retorno potencial
          </span>
          <span className="num text-xl font-bold tabular-nums text-[var(--color-success)]">
            R$ {(Number(oddCombined) * Number(stake)).toFixed(2).replace(".", ",")}
          </span>
        </div>
      ) : null}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error ? (
        <p role="alert" className="label text-[var(--color-vermelho)]">
          {error}
        </p>
      ) : null}

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={pending || legs.length === 0}
          className="label rounded-[var(--radius)] border-2 border-[var(--color-vermelho)] px-4 py-3 font-semibold text-[var(--color-vermelho)] hover:bg-[var(--color-vermelho)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "salvando…" : "Salvar como Bet Builder"}
        </button>

        <Link
          href="/bilhete"
          className="label text-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
