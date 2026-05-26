"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { fmt } from "@/lib/format";
import { placeBetAction, type PlaceBetState } from "../actions";
import { useBetDraft, loadBetDraft, clearBetDraft, type BetDraft } from "@/hooks/use-bet-draft";

const initial: PlaceBetState = {};

type Sport = { id: string; name: string };
type Market = { id: string; name: string; sport_id?: string | null };

type Leg = {
  event_label: string;
  selection_label: string;
  odds: string;
  event_date: string;
  sport_id: string;
  market_id: string;
  league: string;
};

const emptyLeg = (): Leg => ({
  event_label: "",
  selection_label: "",
  odds: "",
  event_date: "",
  sport_id: "",
  market_id: "",
  league: "",
});

function parseBR(v: string): number {
  const cleaned = v.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function PlaceBetForm({
  houses,
  defaultPlacedAt,
  sports = [],
  markets = [],
  leagues = [],
}: {
  houses: { id: string; name: string }[];
  defaultPlacedAt: string;
  sports?: Sport[];
  markets?: Market[];
  leagues?: string[];
}) {
  const [state, action, pending] = useActionState(placeBetAction, initial);
  const [kind, setKind] = useState<"single" | "multiple">(
    (state.values?.kind as "single" | "multiple") ?? "single",
  );
  const [legs, setLegs] = useState<Leg[]>([emptyLeg()]);
  const [stake, setStake] = useState<string>(state.values?.total_stake ?? "");

  // ── Autosave draft ──────────────────────────────────────────────────────────
  // On first mount, restore from localStorage draft (if any and form is fresh).
  useEffect(() => {
    if (state.values) return; // form was already submitted with values — don't restore
    const saved = loadBetDraft();
    if (!saved) return;
    if (saved.kind === "single" || saved.kind === "multiple") {
      setKind(saved.kind as "single" | "multiple");
    }
    if (typeof saved.stake === "string") setStake(saved.stake);
    if (Array.isArray(saved.legs) && saved.legs.length > 0) {
      setLegs(saved.legs as Leg[]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  const currentDraft: BetDraft = { kind, stake, legs };
  useBetDraft(state.values ? null : currentDraft); // stop saving after successful submit
  // ───────────────────────────────────────────────────────────────────────────

  function changeKind(next: "single" | "multiple") {
    setKind(next);
    if (next === "single" && legs.length !== 1) {
      setLegs([legs[0] ?? emptyLeg()]);
    } else if (next === "multiple" && legs.length < 2) {
      setLegs([...legs, emptyLeg()].slice(0, Math.max(2, legs.length + 1)));
    }
  }

  function updateLeg(i: number, patch: Partial<Leg>) {
    setLegs((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addLeg() {
    setLegs((prev) => [...prev, emptyLeg()]);
    if (kind === "single") setKind("multiple");
  }

  function removeLeg(i: number) {
    setLegs((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      return next.length === 0 ? [emptyLeg()] : next;
    });
  }

  const totalOdds = useMemo(
    () =>
      legs.reduce((acc, leg) => {
        const o = parseBR(leg.odds);
        return Number.isFinite(o) && o > 0 ? acc * o : acc;
      }, 1),
    [legs],
  );

  const stakeNum = parseBR(stake);
  const expectedReturn =
    Number.isFinite(stakeNum) && stakeNum > 0 && totalOdds > 0
      ? stakeNum * totalOdds
      : 0;

  // leagues datalist id
  const leaguesListId = "leagues-datalist";

  return (
    <form action={action} className="card flex flex-col gap-6 p-6">
      <Field label="casa" htmlFor="house_id">
        <Select
          id="house_id"
          name="house_id"
          required
          defaultValue={state.values?.house_id ?? houses[0]?.id}
        >
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="tipo" htmlFor="kind">
        <Select
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => changeKind(e.target.value as "single" | "multiple")}
        >
          <option value="single">simples (1 leg)</option>
          <option value="multiple">múltipla (2+ legs)</option>
        </Select>
      </Field>

      <Field
        label="stake (BRL)"
        htmlFor="total_stake"
        hint="Quanto entra. Sempre positivo."
      >
        <Input
          id="total_stake"
          name="total_stake"
          mono
          inputMode="decimal"
          placeholder="0,00"
          required
          value={stake}
          onChange={(e) => setStake(e.target.value)}
        />
      </Field>

      <Field label="quando" htmlFor="placed_at">
        <Input
          id="placed_at"
          name="placed_at"
          type="datetime-local"
          mono
          required
          defaultValue={state.values?.placed_at ?? defaultPlacedAt}
        />
      </Field>

      {/* Leagues datalist for autocomplete */}
      {leagues.length > 0 && (
        <datalist id={leaguesListId}>
          {leagues.map((lg) => (
            <option key={lg} value={lg} />
          ))}
        </datalist>
      )}

      <section className="flex flex-col gap-4">
        <header className="flex items-baseline justify-between">
          <span className="label">
            {kind === "single" ? "seleção" : `seleções · ${legs.length}`}
          </span>
          {kind === "multiple" && (
            <button
              type="button"
              onClick={addLeg}
              className="label hover:text-[var(--color-vermelho)]"
            >
              + leg
            </button>
          )}
        </header>

        <ol className="flex flex-col gap-3">
          {legs.map((leg, i) => (
            <li
              key={i}
              className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-1)] p-4"
            >
              <div className="flex items-center justify-between">
                <span className="num text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                  leg {i + 1}
                </span>
                {kind === "multiple" && legs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLeg(i)}
                    className="label hover:text-[var(--color-warning)]"
                  >
                    remover
                  </button>
                )}
              </div>

              <Input
                name="event_label"
                placeholder="evento (ex.: Flamengo × Palmeiras)"
                required
                value={leg.event_label}
                onChange={(e) => updateLeg(i, { event_label: e.target.value })}
              />
              <Input
                name="selection_label"
                placeholder="seleção (ex.: vitória mandante)"
                required
                value={leg.selection_label}
                onChange={(e) =>
                  updateLeg(i, { selection_label: e.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  name="odds"
                  mono
                  inputMode="decimal"
                  placeholder="odd (ex.: 1,85)"
                  required
                  value={leg.odds}
                  onChange={(e) => updateLeg(i, { odds: e.target.value })}
                />
                <Input
                  name="event_date"
                  type="datetime-local"
                  mono
                  value={leg.event_date}
                  onChange={(e) => updateLeg(i, { event_date: e.target.value })}
                />
              </div>

              {/* Sport / Market / League row */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {sports.length > 0 && (
                  <Field label="esporte" htmlFor={`sport_id_${i}`}>
                    <Select
                      id={`sport_id_${i}`}
                      name="sport_id"
                      value={leg.sport_id}
                      onChange={(e) => {
                        updateLeg(i, { sport_id: e.target.value, market_id: "" });
                      }}
                    >
                      <option value="">— esporte —</option>
                      {sports.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                {markets.length > 0 && (
                  <Field label="mercado" htmlFor={`market_id_${i}`}>
                    <Select
                      id={`market_id_${i}`}
                      name="market_id"
                      value={leg.market_id}
                      onChange={(e) => updateLeg(i, { market_id: e.target.value })}
                    >
                      <option value="">— mercado —</option>
                      {markets
                        .filter(
                          (m) => !leg.sport_id || !m.sport_id || m.sport_id === leg.sport_id,
                        )
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </Select>
                  </Field>
                )}

                <Field label="liga" htmlFor={`league_${i}`}>
                  <Input
                    id={`league_${i}`}
                    name="league"
                    placeholder="ex.: Premier League"
                    list={leagues.length > 0 ? leaguesListId : undefined}
                    value={leg.league}
                    onChange={(e) => updateLeg(i, { league: e.target.value })}
                  />
                </Field>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Field
        label="nota (opcional)"
        htmlFor="note"
        hint="Por quê essa aposta. Daqui 3 meses vai esquecer."
      >
        <textarea
          id="note"
          name="note"
          rows={2}
          defaultValue={state.values?.note ?? ""}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-vermelho)]"
        />
      </Field>

      <section className="flex items-baseline justify-between border-t border-[var(--color-line-subtle)] pt-4">
        <div className="flex flex-col">
          <span className="label">odd combinada</span>
          <span className="num text-lg" style={{ color: "var(--color-ink-display)" }}>
            {totalOdds > 0 ? fmt.number(totalOdds) : "—"}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="label">retorno esperado</span>
          <span
            className="num text-lg"
            style={{ color: "var(--color-depth-hi)" }}
          >
            {expectedReturn > 0 ? fmt.currency(expectedReturn) : "—"}
          </span>
        </div>
      </section>

      {state.error && (
        <p
          role="alert"
          className="num text-sm"
          style={{ color: "var(--color-warning)" }}
        >
          {state.error}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <Button asChild variant="ghost">
          <Link href="/bets">cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "registrando…" : "registrar aposta"}
        </Button>
      </div>
    </form>
  );
}
